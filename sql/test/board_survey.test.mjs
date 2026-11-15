// sql/149: the board exam survey. Runs the migration against real PostgreSQL
// (PGlite), as the roles a browser has: a student is `anon` with a session
// token, an instructor is `authenticated`.
//
//   npm run test:board-survey-sql
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const db = new PGlite();
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
process.on('unhandledRejection', e => { console.error('\nREJECTED:', e?.message || e); process.exit(1); });
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const as = role => async (sql, params, uid = '') => {
  try {
    await x(`SET test.uid = '${uid}'`);
    await x(`SET ROLE ${role}`);
    return { ok: true, rows: await q(sql, params) };
  } catch (e) {
    return { ok: false, message: e.message || String(e), code: e.code };
  } finally {
    await x(`RESET ROLE; SET test.uid = ''`);
  }
};
const asAnon = as('anon'), asAuthed = as('authenticated');

await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`);
const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.(instructors|users)\s*\([^;]*?\);/gs).join('\n'));

const M = fs.readFileSync(`${P}/sql/149_board_exam_survey.sql`, 'utf8');

console.log('\n=== order ===');
try { await x(M); ck('149 refuses to run before 020', false, 'it ran'); }
catch (e) { ck('149 refuses to run before 020', /Run sql\/020 first/.test(e.message), e.message); await x('ROLLBACK'); }
ck('and leaves nothing behind', (await q(`SELECT to_regclass('public.board_survey_responses') AS t`))[0].t === null);

// student_from_token exactly as 020 defines it.
const s020 = fs.readFileSync(`${P}/sql/020_exam_content_behind_the_gate.sql`, 'utf8');
await x(s020.match(/CREATE OR REPLACE FUNCTION public\.student_from_token[\s\S]*?\$\$;/)[0]);
await x(`GRANT EXECUTE ON FUNCTION public.student_from_token(uuid, text) TO anon, authenticated;`);

console.log('\n=== 149 applies ===');
await x(M);
await x(M);
ck('149 applies, twice', true);
{
  const [v] = await q(M.slice(M.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim());
  ck("149's VERIFY row is all true", Object.values(v).every(b => b === true), JSON.stringify(v));
}

const KAI = 'a0000000-0000-0000-0000-0000000000a1';            // an instructor
const STRANGER = 'a0000000-0000-0000-0000-0000000000b2';       // signed in, not an instructor
const ANA = '11111111-1111-1111-1111-111111111111', TANA = 'f0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1a';
const BEN = '22222222-2222-2222-2222-222222222222', TBEN = 'a0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1b';
await x(`INSERT INTO auth.users VALUES ('${KAI}','k@p.ph'), ('${STRANGER}','s@p.ph');
  INSERT INTO public.instructors (id, email, full_name) VALUES ('${KAI}','k@p.ph','Kai');
  INSERT INTO public.users (id, full_name, section, session_token) VALUES
    ('${ANA}','Look, Ana','Pre-Boards Test','${TANA}'),
    ('${BEN}','Alike, Ben','Pre-Boards Test','${TBEN}');`);

const SAVE = `SELECT public.save_my_board_survey($1, $2, $3, $4::jsonb, $5) AS done`;
const MINE = `SELECT public.my_board_survey($1, $2, $3) AS mine`;
const ALL = `SELECT * FROM public.board_survey_responses_for_faculty($1)`;
const A = (one = {}, text = {}) => JSON.stringify({ one, many: { topics_math: ['bearing'] }, text });

console.log('\n=== the table is closed ===');
{
  const r = await asAnon(`SELECT * FROM public.board_survey_responses`);
  ck('a student cannot read the table', !r.ok && /permission denied/i.test(r.message), r.message);
  const w = await asAnon(`INSERT INTO public.board_survey_responses (survey, student_id) VALUES ('nov2026', '${ANA}')`);
  ck('a student cannot write the table', !w.ok && /permission denied/i.test(w.message), w.message);
  const i = await asAuthed(`SELECT * FROM public.board_survey_responses`, [], KAI);
  ck('an instructor cannot read the table directly', !i.ok && /permission denied/i.test(i.message), i.message);
}

console.log('\n=== a student saves ===');
{
  const bad = await asAnon(SAVE, [ANA, 'not-the-token', 'nov2026', A(), false]);
  ck('the wrong token is refused as an expired session', !bad.ok && /session has expired/.test(bad.message), bad.message);
  const none = await asAnon(SAVE, [ANA, null, 'nov2026', A(), false]);
  ck('no token is refused', !none.ok && /session has expired/.test(none.message), none.message);

  const r = await asAnon(SAVE, [ANA, TANA, 'nov2026', A({ result: 'passed' }), false]);
  ck('a step saves', r.ok && r.rows[0].done === null, r.message);
  const r2 = await asAnon(SAVE, [ANA, TANA, 'nov2026', A({ result: 'passed', ready: 'ready' }), false]);
  ck('the next step replaces it', r2.ok, r2.message);
  ck('still one row for the student',
    (await q(`SELECT count(*)::int n FROM public.board_survey_responses WHERE student_id = $1`, [ANA]))[0].n === 1);

  const f = await asAnon(SAVE, [ANA, TANA, 'nov2026', A({ result: 'passed', ready: 'ready' }), true]);
  ck('Submit stamps it finished', f.ok && f.rows[0].done !== null, f.message);
  const e = await asAnon(SAVE, [ANA, TANA, 'nov2026', A({ result: 'passed', ready: 'very' }), false]);
  ck('a later edit keeps it finished', e.ok && e.rows[0].done !== null, e.message);

  const m = await asAnon(MINE, [ANA, TANA, 'nov2026']);
  ck('the student reads back their latest answers',
    m.ok && m.rows[0].mine?.answers?.one?.ready === 'very' && m.rows[0].mine.completed_at, JSON.stringify(m.rows?.[0]));
  const other = await asAnon(MINE, [BEN, TBEN, 'nov2026']);
  ck("another student reads nothing of theirs", other.ok && other.rows[0].mine === null, JSON.stringify(other.rows?.[0]));
  const spoof = await asAnon(MINE, [ANA, TBEN, 'nov2026']);
  ck("and cannot read theirs with their own token", !spoof.ok && /session has expired/.test(spoof.message), spoof.message);
  const later = await asAnon(MINE, [ANA, TANA, 'may2027']);
  ck('a different survey starts empty', later.ok && later.rows[0].mine === null);
}

console.log('\n=== what a save refuses ===');
{
  const arr = await asAnon(SAVE, [BEN, TBEN, 'nov2026', '[]', false]);
  ck('answers that are not an object', !arr.ok && /must be an object/.test(arr.message), arr.message);
  const big = await asAnon(SAVE, [BEN, TBEN, 'nov2026', JSON.stringify({ text: { message: 'x'.repeat(70000) } }), false]);
  ck('answers past 64 KB', !big.ok && /too long/.test(big.message), big.message);
  const id = await asAnon(SAVE, [BEN, TBEN, "nov'; drop", A(), false]);
  ck('a survey id that is not plain', !id.ok && /Unknown survey/.test(id.message), id.message);
  ck('none of those left a row',
    (await q(`SELECT count(*)::int n FROM public.board_survey_responses WHERE student_id = $1`, [BEN]))[0].n === 0);
}

console.log('\n=== instructors read them, names only when allowed ===');
{
  await asAnon(SAVE, [BEN, TBEN, 'nov2026', A({ show_name: 'yes', result: 'not_passed' }), true]);
  const s = await asAnon(ALL, ['nov2026']);
  ck('a student cannot read everyone’s answers', !s.ok && /permission denied/i.test(s.message), s.message);
  const n = await asAuthed(ALL, ['nov2026'], STRANGER);
  ck('a signed-in non-instructor is refused', !n.ok && /Only instructors/.test(n.message), n.message);

  const r = await asAuthed(ALL, ['nov2026'], KAI);
  ck('an instructor reads both responses', r.ok && r.rows.length === 2, r.message || r.rows.length);
  const ana = r.rows?.find(x => x.answers.one.result === 'passed');
  const ben = r.rows?.find(x => x.answers.one.result === 'not_passed');
  ck('no name or section without "show my name"', ana && ana.student_name === null && ana.section === null, JSON.stringify(ana));
  ck('name and section with it', ben && ben.student_name === 'Alike, Ben' && ben.section === 'Pre-Boards Test', JSON.stringify(ben));

  await asAnon(SAVE, [ANA, TANA, 'nov2026', A({ show_name: 'no', result: 'passed' }), false]);
  const r2 = await asAuthed(ALL, ['nov2026'], KAI);
  ck('"No, hide my name" hides it', r2.rows.find(x => x.answers.one.result === 'passed').student_name === null);
}

console.log('\n=== a deleted student ===');
{
  await x(`DELETE FROM public.users WHERE id = '${BEN}'`);
  const r = await asAuthed(ALL, ['nov2026'], KAI);
  const ben = r.rows.find(x => x.answers.one.result === 'not_passed');
  ck('their answers stay', !!ben);
  ck('without a name', ben && ben.student_name === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
