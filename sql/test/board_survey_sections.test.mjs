// sql/150: the board exam survey kept to chosen sections. Runs 149 and 150
// against real PostgreSQL (PGlite), as the roles a browser has: a student is
// `anon` with a session token, an instructor is `authenticated`.
//
//   npm run test:board-survey-sections
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
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.(instructors|users|section_instructors)\s*\([^;]*?\);/gs).join('\n'));
// Only the columns my_sections() reads.
await x(`CREATE TABLE public.assessments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), instructor_id uuid, target_section text);
  CREATE TABLE public.exams (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), instructor_id uuid, target_section text);`);

const s020 = fs.readFileSync(`${P}/sql/020_exam_content_behind_the_gate.sql`, 'utf8');
await x(s020.match(/CREATE OR REPLACE FUNCTION public\.student_from_token[\s\S]*?\$\$;/)[0]);
await x(`GRANT EXECUTE ON FUNCTION public.student_from_token(uuid, text) TO anon, authenticated;`);

const M149 = fs.readFileSync(`${P}/sql/149_board_exam_survey.sql`, 'utf8');
const M = fs.readFileSync(`${P}/sql/150_board_survey_for_chosen_sections.sql`, 'utf8');
const verify = async file => {
  const [v] = await q(file.slice(file.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim());
  return v;
};

console.log('\n=== order ===');
try { await x(M); ck('150 refuses to run before 149', false, 'it ran'); }
catch (e) { ck('150 refuses to run before 149', /Run sql\/149 first/.test(e.message), e.message); await x('ROLLBACK'); }
await x(M149);
try { await x(M); ck('150 refuses to run before 094', false, 'it ran'); }
catch (e) { ck('150 refuses to run before 094', /Run sql\/094 first/.test(e.message), e.message); await x('ROLLBACK'); }
ck('and leaves nothing behind', (await q(`SELECT to_regclass('public.board_survey_sections') AS t`))[0].t === null);

const s094 = fs.readFileSync(`${P}/sql/094_removing_a_student_keeps_other_instructors_students.sql`, 'utf8');
await x(s094.match(/CREATE OR REPLACE FUNCTION public\.my_sections\(\)[\s\S]*?\$\$;/)[0]);
await x(`REVOKE ALL ON FUNCTION public.my_sections() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.my_sections() TO authenticated;`);

console.log('\n=== 150 applies ===');
await x(M);
await x(M);
ck('150 applies, twice', true);
{
  const v = await verify(M);
  ck("150's VERIFY row is all true", Object.values(v).every(b => b === true), JSON.stringify(v));
  const v149 = await verify(M149);
  ck("149's VERIFY row is still all true", Object.values(v149).every(b => b === true), JSON.stringify(v149));
}

const KAI = 'a0000000-0000-0000-0000-0000000000a1';            // an instructor with a Pre-Boards class
const LEE = 'a0000000-0000-0000-0000-0000000000a2';            // a colleague
const STRANGER = 'a0000000-0000-0000-0000-0000000000b2';       // signed in, not an instructor
const ANA = '11111111-1111-1111-1111-111111111111', TANA = 'f0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1a';
const BEN = '22222222-2222-2222-2222-222222222222', TBEN = 'a0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1b';
const CY = '33333333-3333-3333-3333-333333333333', TCY = 'b0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1c';
const PRE = 'Pre-Boards Test';
await x(`INSERT INTO auth.users VALUES ('${KAI}','k@p.ph'), ('${LEE}','l@p.ph'), ('${STRANGER}','s@p.ph');
  INSERT INTO public.instructors (id, email, full_name) VALUES ('${KAI}','k@p.ph','Kai'), ('${LEE}','l@p.ph','Lee');
  INSERT INTO public.section_instructors (section_name, instructor_id, added_by) VALUES
    ('${PRE}','${KAI}','${KAI}'), ('MATH 101 -1','${KAI}','${KAI}'), ('AENG 999','${LEE}','${LEE}');
  INSERT INTO public.assessments (instructor_id, target_section) VALUES ('${KAI}', 'ESCI 1, ESCI 2');
  INSERT INTO public.users (id, full_name, section, session_token) VALUES
    ('${ANA}','Look, Ana','MATH 101 -1,  ${PRE} ','${TANA}'),
    ('${BEN}','Alike, Ben','MATH 101 -1','${TBEN}'),
    ('${CY}','Same, Cy','AENG 999','${TCY}');`);

const SAVE = `SELECT public.save_my_board_survey($1, $2, $3, $4::jsonb, $5) AS done`;
const MINE = `SELECT public.my_board_survey($1, $2, $3) AS mine`;
const FOR_ME = `SELECT public.board_survey_for_me($1, $2, $3) AS me`;
const AUD = `SELECT public.board_survey_audience($1) AS a`;
const SET = `SELECT public.set_board_survey_audience($1, $2, $3::text[]) AS a`;
const ALL = `SELECT * FROM public.board_survey_responses_for_faculty($1)`;
const A = (one = {}) => JSON.stringify({ one, many: {}, text: {} });
const saves = async (id, tok, survey = 'nov2026') => (await asAnon(SAVE, [id, tok, survey, A({ result: 'passed' }), false])).ok;
const forMe = async (id, tok) => (await asAnon(FOR_ME, [id, tok, 'nov2026'])).rows?.[0]?.me;

console.log('\n=== before anyone chooses: open to all, as before ===');
{
  ck('a student in any section can save', await saves(BEN, TBEN));
  const me = await forMe(BEN, TBEN);
  ck('and is told the survey is not kept to sections', me?.restricted === false && me?.may_answer === true, JSON.stringify(me));
  const m = await asAnon(MINE, [CY, TCY, 'nov2026']);
  ck('with nothing saved, the read-back is an object that says they may answer',
    m.ok && m.rows[0].mine?.answers === null && m.rows[0].mine?.may_answer === true, JSON.stringify(m.rows?.[0]));
  const a = await asAuthed(AUD, ['nov2026'], KAI);
  ck('an instructor sees: open to all, none chosen', a.ok && a.rows[0].a.open_to === 'all'
    && a.rows[0].a.mine.length === 0 && a.rows[0].a.others === 0, JSON.stringify(a.rows?.[0] || a.message));
}

console.log('\n=== who may choose ===');
{
  const s = await asAnon(SET, ['nov2026', 'sections', `{${PRE}}`]);
  ck('a student cannot choose', !s.ok && /permission denied/i.test(s.message), s.message);
  const r = await asAnon(AUD, ['nov2026']);
  ck('or see the choice', !r.ok && /permission denied/i.test(r.message), r.message);
  const n = await asAuthed(SET, ['nov2026', 'sections', `{${PRE}}`], STRANGER);
  ck('nor can a signed-in non-instructor', !n.ok && /Only instructors/.test(n.message), n.message);
  const t = await asAnon(`SELECT * FROM public.board_survey_sections`);
  ck('nobody reads the tables directly', !t.ok && /permission denied/i.test(t.message), t.message);
  const w = await asAuthed(`INSERT INTO public.board_survey_settings (survey, open_to) VALUES ('nov2026', 'sections')`, [], KAI);
  ck('or writes them', !w.ok && /permission denied/i.test(w.message), w.message);
  const rule = await asAnon(`SELECT public.board_survey_student_may_answer($1, 'nov2026')`, [BEN]);
  ck('the rule itself is not callable from a browser', !rule.ok && /permission denied/i.test(rule.message), rule.message);
}

console.log('\n=== what a choice refuses ===');
{
  const other = await asAuthed(SET, ['nov2026', 'sections', '{AENG 999}'], KAI);
  ck("a colleague's section", !other.ok && /only choose your own sections/.test(other.message), other.message);
  const none = await asAuthed(SET, ['nov2026', 'sections', '{}'], KAI);
  ck('no section at all', !none.ok && /at least one section/.test(none.message), none.message);
  const mode = await asAuthed(SET, ['nov2026', 'some', `{${PRE}}`], KAI);
  ck('a mode that is not all or sections', !mode.ok && /Choose who can answer/.test(mode.message), mode.message);
  const a = (await asAuthed(AUD, ['nov2026'], KAI)).rows[0].a;
  ck('none of those changed anything', a.open_to === 'all' && a.mine.length === 0, JSON.stringify(a));
}

console.log('\n=== kept to the Pre-Boards class ===');
{
  const r = await asAuthed(SET, ['nov2026', 'sections', `{" ${PRE} ","${PRE}"}`], KAI);
  ck('the instructor keeps it to their Pre-Boards section', r.ok && r.rows[0].a.open_to === 'sections'
    && JSON.stringify(r.rows[0].a.mine) === JSON.stringify([PRE]), JSON.stringify(r.rows?.[0] || r.message));

  ck('a student in it can save (even with spaces in their section list)', await saves(ANA, TANA));
  const ben = await asAnon(SAVE, [BEN, TBEN, 'nov2026', A({ result: 'passed' }), false]);
  ck('a student outside it cannot', !ben.ok && /only for the board review class/.test(ben.message), ben.message);
  ck('not even to finish', !(await asAnon(SAVE, [BEN, TBEN, 'nov2026', A(), true])).ok);

  const ana = await forMe(ANA, TANA);
  ck('the Pre-Boards student gets a Survey tab', ana?.restricted === true && ana?.may_answer === true, JSON.stringify(ana));
  const b = await forMe(BEN, TBEN);
  ck('the other student does not', b?.restricted === true && b?.may_answer === false, JSON.stringify(b));
  const spoof = await asAnon(FOR_ME, [ANA, TBEN, 'nov2026']);
  ck('the tab check needs their own session', !spoof.ok && /session has expired/.test(spoof.message), spoof.message);

  const m = await asAnon(MINE, [BEN, TBEN, 'nov2026']);
  ck('their read-back says they may not answer, and still holds what they saved before',
    m.ok && m.rows[0].mine.may_answer === false && m.rows[0].mine.answers?.one?.result === 'passed', JSON.stringify(m.rows?.[0]));

  const all = await asAuthed(ALL, ['nov2026'], KAI);
  ck('answers saved before the change still show to instructors', all.ok && all.rows.length === 2, all.message || all.rows.length);
  ck('another survey is not affected', await saves(BEN, TBEN, 'may2027'));
}

console.log('\n=== a colleague chooses too ===');
{
  const r = await asAuthed(SET, ['nov2026', 'sections', '{AENG 999}'], LEE);
  ck("a colleague adds their own section", r.ok, r.message);
  ck("which lets their student in", await saves(CY, TCY));
  ck("and leaves the first instructor's choice alone", await saves(ANA, TANA));
  const a = (await asAuthed(AUD, ['nov2026'], KAI)).rows[0].a;
  ck("the first instructor sees their own sections, and only a count of the colleague's",
    JSON.stringify(a.mine) === JSON.stringify([PRE]) && a.others === 1 && !JSON.stringify(a).includes('AENG'), JSON.stringify(a));
  const fromPaper = await asAuthed(SET, ['nov2026', 'sections', `{${PRE},ESCI 2}`], KAI);
  ck('a section held only through a paper counts as theirs', fromPaper.ok, fromPaper.message);
}

console.log('\n=== open to all again ===');
{
  const r = await asAuthed(SET, ['nov2026', 'all', `{${PRE}}`], KAI);
  ck('back to anyone with the link', r.ok && r.rows[0].a.open_to === 'all', r.message);
  ck('the student outside the class can save again', await saves(BEN, TBEN));
  const b = await forMe(BEN, TBEN);
  ck('and no one gets a tab without the link', b?.restricted === false && b?.may_answer === true, JSON.stringify(b));
  const a = (await asAuthed(AUD, ['nov2026'], KAI)).rows[0].a;
  ck('the chosen sections are remembered for next time', JSON.stringify(a.mine) === JSON.stringify([PRE]), JSON.stringify(a));
  const lee = await asAuthed(SET, ['nov2026', 'sections', '{}'], LEE);
  ck("a colleague may clear theirs and narrow it again while the first instructor's remain", lee.ok, lee.message);
  ck('so Pre-Boards is in', await saves(ANA, TANA));
  ck("and the colleague's student is out", !(await saves(CY, TCY)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
