// sql/034: session_is_current(), the exam screen's second-login check,
// asked of the database instead of read out of the users table.
//
// A FALSE here throws a student out of an exam, so the cases that must NOT
// say false matter as much as the one that must. And it has to keep working
// after anon loses its read of users.session_token — the whole point is that
// the browser should not need that read.
//
//   npm run test:session-current
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
const current = async (id, tok) => {
  const r = await asAnon(`SELECT public.session_is_current($1::uuid, $2) AS c`, [id, tok]);
  return r.ok ? r.rows[0].c : `ERROR: ${r.message}`;
};

// ── The schema, as the other tests build it ────────────────────────────
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

const [A, B, C] = ['11111111-1111-1111-1111-11111111111a', '11111111-1111-1111-1111-11111111111b',
  '11111111-1111-1111-1111-11111111111c'];
await x(`INSERT INTO public.users (id, full_name, section, session_token) VALUES
  ('${A}','Ana','MATH 117','tok-a'), ('${B}','Ben','MATH 117',NULL), ('${C}','Cat','MATH 117','tok-c');`);

console.log('=== the hole this is the first step to closing ===');
{
  const r = await asAnon(`SELECT id, session_token FROM public.users`);
  ck('anon can read every student\'s token today', r.ok && r.rows.some(u => u.session_token === 'tok-a'));
}

const MIG = fs.readFileSync(P + '/sql/034_session_is_current.sql', 'utf8');
await x(MIG);
await x(MIG);
ck('034 applies, twice', true);

console.log('\n=== what it answers ===');
ck('the token on file: current', (await current(A, 'tok-a')) === true);
ck('another token (a second login happened): NOT current', (await current(A, 'tok-OLD')) === false);
ck('no token offered: current — cannot tell, so no', (await current(A, null)) === true);
ck('no token on the row: current', (await current(B, 'tok-a')) === true);
ck('no such student: current', (await current('99999999-9999-9999-9999-999999999999', 'tok-a')) === true);
ck('one student\'s token says nothing about another\'s', (await current(C, 'tok-a')) === false
  && (await current(C, 'tok-c')) === true);
ck('case and whitespace are not forgiven', (await current(A, 'TOK-A')) === false && (await current(A, 'tok-a ')) === false);

console.log('\n=== what it gives away ===');
const sig = await q(`SELECT data_type, security_type FROM information_schema.routines
  WHERE routine_schema='public' AND routine_name='session_is_current'`);
ck('a boolean and nothing else — the token never comes back', sig[0]?.data_type === 'boolean', JSON.stringify(sig));
ck('it runs as its owner, so it does not need anon to read tokens', sig[0]?.security_type === 'DEFINER');
ck('authenticated can call it too', (await (async () => {
  try { await x(`SET ROLE authenticated`); return (await q(`SELECT public.session_is_current($1::uuid,'tok-a') c`, [A]))[0].c; }
  finally { await x(`RESET ROLE`); } })()) === true);

console.log('\n=== and after anon loses its read of the tokens ===');
await x(`REVOKE SELECT ON public.users FROM anon;
         GRANT SELECT (id, full_name, section, student_email, student_code) ON public.users TO anon;`);
{
  const r = await asAnon(`SELECT session_token FROM public.users`);
  ck('anon can no longer read a token (the later migration, simulated)', !r.ok, JSON.stringify(r));
}
ck('the check still says current', (await current(A, 'tok-a')) === true);
ck('and still catches a second login', (await current(A, 'tok-OLD')) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
