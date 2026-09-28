// sql/035: anon can no longer read users.session_token.
//
// What must still work afterwards is the whole student side of the app that
// touches users: the login lookup, the login writing a fresh token, and the
// second-login check (034). What must stop is the read. And an exam tab still
// running the OLD check must get a refusal it already ignores, not a crash.
//
//   npm run test:token-revoke
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const asAnon = async (sql, p) => { try { await x(`SET ROLE anon`); return { ok: true, rows: await q(sql, p) }; }
  catch (e) { return { ok: false, message: e.message }; } finally { await x(`RESET ROLE`); } };

// ── The schema and grants exactly as supabase_setup.sql makes them ─────
await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;`);
const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(setup.match(/ALTER TABLE public\.\w+\s+ENABLE ROW LEVEL SECURITY;/g).join('\n'));
await x(setup.match(/^(DROP POLICY IF EXISTS|CREATE POLICY)[\s\S]*?;/gm).filter(s => !/storage\./.test(s)).join('\n'));
await x(setup.match(/^(GRANT|REVOKE)[\s\S]*?;/gm).filter(g => /public\./.test(g) && !/storage|FUNCTION/.test(g)).join('\n'));
const A = '11111111-1111-1111-1111-11111111111a';
await x(`INSERT INTO public.users (id, full_name, section, student_email, student_code, session_token)
  VALUES ('${A}','Ana','MATH 117','ana@p.ph','S-001','tok-a');`);
await x(fs.readFileSync(P + '/sql/034_session_is_current.sql', 'utf8'));

// The exact reads and writes the app makes as anon.
const LOGIN_LOOKUP = `SELECT id, full_name, section, student_email, student_code FROM public.users
  WHERE student_email = 'ana@p.ph' AND student_code = 'S-001'`;
const OLD_LOGIN_LOOKUP = `SELECT id, full_name, section, student_email, student_code, session_token FROM public.users
  WHERE student_email = 'ana@p.ph' AND student_code = 'S-001'`;
const OLD_CLONE_GUARD = `SELECT session_token FROM public.users WHERE id = '${A}'`;

console.log('=== before 035: the hole ===');
ck('anon reads a student\'s token', (await asAnon(OLD_CLONE_GUARD)).rows?.[0]?.session_token === 'tok-a');

const MIG = fs.readFileSync(P + '/sql/035_session_tokens_are_not_readable.sql', 'utf8');
await x(MIG);
await x(MIG);
ck('035 applies, twice', true);

console.log('\n=== the read is gone ===');
{
  const r = await asAnon(OLD_CLONE_GUARD);
  ck('anon cannot read a token', !r.ok && /permission denied/.test(r.message), JSON.stringify(r));
  const w = await asAnon(`SELECT * FROM public.users`);
  ck('nor through select *', !w.ok);
  const f = await asAnon(`SELECT id FROM public.users WHERE session_token = 'tok-a'`);
  ck('nor by filtering on it, which would leak it a guess at a time', !f.ok, JSON.stringify(f));
}

console.log('\n=== what the app does as anon still works ===');
{
  const r = await asAnon(LOGIN_LOOKUP);
  ck('the login lookup finds the student', r.ok && r.rows.length === 1 && r.rows[0].full_name === 'Ana', JSON.stringify(r));
  const u = await asAnon(`UPDATE public.users SET session_token = 'tok-NEW' WHERE id = '${A}'`);
  ck('login writes a fresh token', u.ok, JSON.stringify(u));
  ck('and it landed', (await q(`SELECT session_token t FROM public.users WHERE id = '${A}'`))[0].t === 'tok-NEW');
  const cur = await asAnon(`SELECT public.session_is_current('${A}', 'tok-NEW') c`);
  const old = await asAnon(`SELECT public.session_is_current('${A}', 'tok-a') c`);
  ck('the second-login check sees the new token as current', cur.ok && cur.rows[0].c === true);
  ck('and the replaced one as not', old.ok && old.rows[0].c === false);
}

console.log('\n=== pages opened before the deploy ===');
{
  const r = await asAnon(OLD_CLONE_GUARD);
  ck('the OLD exam check gets a refusal, which it treats as nothing to report', !r.ok);
  const l = await asAnon(OLD_LOGIN_LOOKUP);
  ck('the OLD login lookup is refused — a reload fixes it (the documented cost)', !l.ok);
}

console.log('\n=== instructors are untouched ===');
{
  await x(`SET ROLE authenticated`);
  let ok = false;
  try { ok = (await q(`SELECT session_token FROM public.users WHERE id = '${A}'`)).length === 1; } finally { await x(`RESET ROLE`); }
  ck('authenticated keeps its grant (the dashboard)', ok);
}

console.log('\n=== its VERIFY block ===');
const v = (await q(MIG.slice(MIG.indexOf('SELECT has_column_privilege'), MIG.indexOf('-- false, true, true, false.'))))[0];
ck('reads false, true, true, false',
  v.anon_reads_token === false && v.anon_writes_token === true && v.login_lookup_still_works === true
  && v.anon_reads_whole_table === false, JSON.stringify(v));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
