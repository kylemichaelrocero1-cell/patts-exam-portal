// Runs the migrations as live (through 083, then 094, 095, 107) + 115
// against real PostgreSQL (PGlite), as the roles a browser has: anon for a
// student, authenticated for an instructor. A paper with requires_admission
// on is handed over only to an entry its instructor let in — every entry,
// even mid-sitting — and is filed only for a student who was let in; a
// paper with it off behaves exactly as before.
//   npm run test:admission
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
    return { ok: false, message: e.message || String(e) };
  } finally {
    await x(`RESET ROLE; SET test.uid = ''`);
  }
};
const asAnon = as('anon'), asInstructor = as('authenticated');

await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`);
const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);
await x(setup.match(/ALTER TABLE public\.\w+\s+ENABLE ROW LEVEL SECURITY;/g).join('\n'));
await x(setup.match(/^(DROP POLICY IF EXISTS|CREATE POLICY)[\s\S]*?;/gm).filter(s => !/storage\./.test(s)).join('\n'));
await x(setup.match(/CREATE OR REPLACE FUNCTION public\.verify_exam_password[\s\S]*?END; \$\$;/)[0]);
await x(setup.match(/^(GRANT|REVOKE)[\s\S]*?;/gm).filter(g => /public\./.test(g) && !/storage|FUNCTION/.test(g)).join('\n'));
await x(`CREATE PUBLICATION supabase_realtime;`);

const INS = 'd24df77e-309a-4ed8-988f-da3ee1c76408';   // the paper's instructor
const OTH = 'c0ffee00-0000-4000-8000-000000000115';   // another instructor
const STU = '11111111-1111-1111-1111-111111111111', TOK = 'f0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1a';
const ABS = '22222222-2222-2222-2222-222222222222', TAB = 'a0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1b';   // the absent one
const EARLY = '33333333-3333-3333-3333-333333333333', TEA = 'b0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1c'; // sitting before the switch
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph'), ('${OTH}','o@p.ph');
  INSERT INTO public.users (id, full_name, section, session_token) VALUES
    ('${STU}','Present, Paula','Aeng 427 -3B','${TOK}'),
    ('${ABS}','Absent, Arturo','Aeng 427 -5B','${TAB}'),
    ('${EARLY}','Early, Ester','Aeng 427 -3B','${TEA}');`);

const MIG = ['001_assessments_and_lessons', '002_review_mode_and_server_scoring', '003_lock_answer_key',
  '012_five_option_items', '002b_grant_new_columns', '015_archive_assessments', '016_unlimited_choices',
  '017_shuffle_questions_switch', '018_multi_select_items', '019_exam_password_on_assessments',
  '020_exam_content_behind_the_gate', '021_revoke_direct_question_reads', '022_answer_review_needs_identity',
  '023_drop_unidentified_answer_review', '024_worked_solution_items', '025_points_per_item',
  '026_worked_answers_are_saved_and_scored', '027_score_worked_in_the_database',
  '028_worked_items_in_answer_review', '029_guarded_review_shows_worked_items',
  '030_primes_as_the_editor_writes_them', '031_any_function_name_is_a_subject',
  '032_a_label_is_part_of_the_answer', '033_a_minus_may_sit_on_the_numerator',
  '036_four_primes_and_brackets', '037_keyboard_leftovers', '038_any_arrow_is_to',
  '039_submit_files_the_working', '042_working_marked_line_by_line', '043_partial_working_earns_more',
  '045_brackets_that_change_nothing', '046_answers_typed_as_words',
  '050_answers_as_the_keyboard_spells_them', '053_marking_fast_again', '054_time_to_submit',
  '058_keyboard_spellings_fast', '061_minus_out_of_a_bracket', '066_times_between_numbers_and_zero_terms',
  '071_the_keyboards_e_is_e', '073_logic_proofs_line_by_line', '076_two_law_steps_and_equations',
  '081_hyperbolic_functions_as_typed', '083_file_before_marking',
  '094_removing_a_student_keeps_other_instructors_students', '095_writes_belong_to_the_papers_instructors',
  '107_papers_without_sets'];
for (const f of MIG) await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
const SQL115 = fs.readFileSync(`${P}/sql/115_admit_students_from_the_live_monitor.sql`, 'utf8');

// Two papers for both sections, with a password: one that will need admission, one that will not.
const PAPER = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b33', PLAIN = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b34';
const Q1 = 'aaaaaaaa-0000-4000-8000-000000000001', Q2 = 'aaaaaaaa-0000-4000-8000-000000000002';
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id, is_open, duration_minutes, exam_password, has_password)
  VALUES ('${PAPER}','exam','Midterm','Aeng 427 -3B, Aeng 427 -5B','${INS}',true,60,'BRAVO',true),
         ('${PLAIN}','exam','Quiz','Aeng 427 -3B, Aeng 427 -5B','${INS}',true,60,'BRAVO',true);
  INSERT INTO public.questions (id, exam_id, assessment_id, question_number, question_text, question_type, choices, correct_answer, marks) VALUES
    ('${Q1}','${PAPER}','${PAPER}',1,'Look-alike item one','multiple_choice','["a","b","c","d"]'::jsonb,2,1),
    ('${Q2}','${PLAIN}','${PLAIN}',1,'Look-alike item two','multiple_choice','["a","b","c","d"]'::jsonb,1,1);`);

// Ester started the midterm before 115 / before the switch went on.
await x(`INSERT INTO public.live_sessions (student_id, exam_id, student_name, status, created_at)
         VALUES ('${EARLY}','${PAPER}','Early, Ester','active', now() - interval '20 minutes')`);

console.log('=== 115 APPLIES, TWICE ===');
const tryRun = async () => { try { await x(SQL115); return ''; } catch (e) { await x('ROLLBACK').catch(() => {}); return e.message; } };
ck('115 applies', (await tryRun()) === '');
ck('…and again (idempotent)', (await tryRun()) === '');
{
  const verify = SQL115.slice(SQL115.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim();
  const [r] = await q(verify);
  ck('VERIFY: every column true', Object.values(r).every(v => v === true), JSON.stringify(r));
}

const unlock = (paper, stu, tok, pw = 'BRAVO') => asAnon(`SELECT public.unlock_assessment($1,$2,$3,$4) ok`, [paper, pw, stu, tok]);
const ask = (paper, stu, tok, entry) => asAnon(`SELECT public.request_admission($1,$2,$3,$4) s`, [paper, stu, tok, entry]);
const paperFor = (paper, stu, tok, entry) => entry === undefined
  ? asAnon(`SELECT id FROM public.get_exam_questions($1,$2,$3)`, [paper, stu, tok])
  : asAnon(`SELECT id FROM public.get_exam_questions($1,$2,$3,$4)`, [paper, stu, tok, entry]);
const decide = (req, allow, uid = INS) => asInstructor(`SELECT public.decide_admission($1,$2) s`, [req, allow], uid);
const requestOf = async (stu, entry) => (await q(`SELECT * FROM public.exam_admissions WHERE student_id = $1 AND entry = $2`, [stu, entry]))[0];
const E = n => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`;
const submit = (paper, stu, uid) => (uid ? asInstructor : asAnon)(
  `SELECT public.submit_assessment($1,$2,$3::jsonb,600,0,'[]'::jsonb) r`, [stu, paper, JSON.stringify({ [paper === PAPER ? Q1 : Q2]: 2 })], uid);

console.log('\n=== SWITCHED OFF: AS BEFORE ===');
ck('the gate still takes three arguments (an old screen)', (await (async () => { await unlock(PLAIN, STU, TOK); return paperFor(PLAIN, STU, TOK); })()).rows?.length === 1);
ck('…and four, an entry it does not need', (await paperFor(PLAIN, STU, TOK, E(99))).rows?.length === 1);
ck('asking reports not_required', (await ask(PLAIN, STU, TOK, E(98))).rows?.[0]?.s === 'not_required');

console.log('\n=== THE SWITCH ===');
ck('a student cannot turn it on', !(await asAnon(`UPDATE public.assessments SET requires_admission = true WHERE id = $1`, [PAPER])).ok
  || !(await q(`SELECT requires_admission FROM public.assessments WHERE id = $1`, [PAPER]))[0].requires_admission);
{
  const r = await asInstructor(`UPDATE public.assessments SET requires_admission = true WHERE id = $1 RETURNING requires_admission`, [PAPER], INS);
  ck('its instructor can', r.ok && r.rows[0]?.requires_admission === true, r.message);
  const [a] = await q(`SELECT admission_since FROM public.assessments WHERE id = $1`, [PAPER]);
  ck('…which stamps admission_since', !!a.admission_since && Date.now() - new Date(a.admission_since).getTime() < 60000);
}
ck('another instructor cannot switch it off', (await (async () => {
  await asInstructor(`UPDATE public.assessments SET requires_admission = false WHERE id = $1`, [PAPER], OTH);
  return (await q(`SELECT requires_admission FROM public.assessments WHERE id = $1`, [PAPER]))[0].requires_admission; })()) === true);

console.log('\n=== PAULA: PASSWORD, WAIT, LET IN ===');
ck('cannot queue before the password', /password/i.test((await ask(PAPER, STU, TOK, E(1))).message || ''));
await unlock(PAPER, STU, TOK);
ck('the password alone does not hand over the paper', /not let you in/i.test((await paperFor(PAPER, STU, TOK)).message || ''));
ck('asking puts her on the monitor: waiting', (await ask(PAPER, STU, TOK, E(1))).rows?.[0]?.s === 'waiting');
ck('…still no paper while waiting', /not let you in/i.test((await paperFor(PAPER, STU, TOK, E(1))).message || ''));
ck('asking again is the same request, still waiting', (await ask(PAPER, STU, TOK, E(1))).rows?.[0]?.s === 'waiting'
  && (await q(`SELECT count(*)::int n FROM public.exam_admissions WHERE student_id = $1`, [STU]))[0].n === 1);
const reqP = (await requestOf(STU, E(1))).id;
ck('a student cannot read the requests', !(await asAnon(`SELECT * FROM public.exam_admissions`)).ok);
ck('a student cannot let themself in', !(await asAnon(`SELECT public.decide_admission($1, true)`, [reqP])).ok);
ck('a student cannot write a request', !(await asAnon(`UPDATE public.exam_admissions SET status = 'admitted'`)).ok);
ck('her instructor sees her waiting', (await asInstructor(`SELECT student_name, status FROM public.exam_admissions WHERE status = 'waiting'`, [], INS)).rows?.[0]?.student_name === 'Present, Paula');
ck('another instructor sees nothing', (await asInstructor(`SELECT * FROM public.exam_admissions`, [], OTH)).rows?.length === 0);
ck('…and cannot let her in', !(await decide(reqP, true, OTH)).ok);
ck('her instructor lets her in', (await decide(reqP, true)).rows?.[0]?.s === 'admitted');
ck('her screen sees admitted', (await ask(PAPER, STU, TOK, E(1))).rows?.[0]?.s === 'admitted');
ck('the paper comes to that entry', (await paperFor(PAPER, STU, TOK, E(1))).rows?.length === 1);
ck('…and again to it later in the same page (a re-fetch)', (await paperFor(PAPER, STU, TOK, E(1))).rows?.length === 1);
ck('…not to another entry of hers (a reload, another phone)', /not let you in/i.test((await paperFor(PAPER, STU, TOK, E(2))).message || ''));
ck('…not without an entry', /not let you in/i.test((await paperFor(PAPER, STU, TOK)).message || ''));
ck('a second decision changes nothing', (await decide(reqP, false)).rows?.[0]?.s === 'admitted');

console.log('\n=== MID-SITTING, SHE OPENS IT AGAIN ===');
await x(`INSERT INTO public.live_sessions (student_id, exam_id, student_name, status) VALUES ('${STU}','${PAPER}','Present, Paula','active')`);
ck('a new entry waits again, even mid-sitting', (await ask(PAPER, STU, TOK, E(2))).rows?.[0]?.s === 'waiting'
  && /not let you in/i.test((await paperFor(PAPER, STU, TOK, E(2))).message || ''));
ck('a third tab withdraws the second, so she shows once', (await ask(PAPER, STU, TOK, E(3))).rows?.[0]?.s === 'waiting'
  && (await ask(PAPER, STU, TOK, E(2))).rows?.[0]?.s === 'withdrawn'
  && (await q(`SELECT count(*)::int n FROM public.exam_admissions WHERE student_id = $1 AND status = 'waiting'`, [STU]))[0].n === 1);
ck('not allowed: her screen sees denied, and no paper', (await decide((await requestOf(STU, E(3))).id, false)).rows?.[0]?.s === 'denied'
  && (await ask(PAPER, STU, TOK, E(3))).rows?.[0]?.s === 'denied'
  && /not let you in/i.test((await paperFor(PAPER, STU, TOK, E(3))).message || ''));
ck('a withdrawn entry cannot be let in', (await decide((await requestOf(STU, E(2))).id, true)).rows?.[0]?.s === 'withdrawn'
  && /not let you in/i.test((await paperFor(PAPER, STU, TOK, E(2))).message || ''));

console.log('\n=== AN ADMISSION LEFT UNUSED LAPSES ===');
await ask(PAPER, STU, TOK, E(4)); await decide((await requestOf(STU, E(4))).id, true);
await x(`UPDATE public.exam_admissions SET decided_at = now() - interval '16 minutes' WHERE entry = '${E(4)}'`);
ck('after 15 minutes unused: expired, and no paper', (await ask(PAPER, STU, TOK, E(4))).rows?.[0]?.s === 'expired'
  && /not let you in/i.test((await paperFor(PAPER, STU, TOK, E(4))).message || ''));

console.log('\n=== ARTURO: ABSENT, WITH THE PASSWORD ===');
await unlock(PAPER, ABS, TAB);
ck('the password gets him only a place on the list', (await ask(PAPER, ABS, TAB, E(10))).rows?.[0]?.s === 'waiting'
  && /not let you in/i.test((await paperFor(PAPER, ABS, TAB, E(10))).message || ''));
ck('his entry is no good with another session token', /expired/i.test((await ask(PAPER, ABS, 'stolen', E(10))).message || ''));
ck('Paula\'s admitted entry is no good to him', /not let you in/i.test((await paperFor(PAPER, ABS, TAB, E(1))).message || ''));
ck('he cannot file the paper without being let in', /not let you in/i.test((await submit(PAPER, ABS)).message || ''));
ck('…and nothing was filed', (await q(`SELECT count(*)::int n FROM public.results WHERE student_id = $1`, [ABS]))[0].n === 0);

console.log('\n=== FILING ===');
{
  const r = await submit(PAPER, STU);
  ck('Paula, let in, files her paper', r.ok, r.message);
  ck('…one result', (await q(`SELECT count(*)::int n FROM public.results WHERE student_id = $1 AND exam_id = $2`, [STU, PAPER]))[0].n === 1);
}
{
  const r = await submit(PAPER, EARLY);
  ck('Ester, sitting since before the switch, files hers', r.ok, r.message);
}
{
  const r = await submit(PAPER, ABS, INS);
  ck('the instructor can force-submit a student who was never let in', r.ok, r.message);
}
{
  const r = await submit(PLAIN, ABS);
  ck('a paper with the switch off files as before', r.ok, r.message);
}

console.log('\n=== SWITCHED OFF AGAIN ===');
await asInstructor(`UPDATE public.assessments SET requires_admission = false WHERE id = $1`, [PAPER], INS);
await x(`DELETE FROM public.live_sessions WHERE student_id = '${STU}'`);
ck('the paper comes without asking', (await paperFor(PAPER, STU, TOK)).rows?.length === 1);
ck('and asking says not_required', (await ask(PAPER, STU, TOK, E(20))).rows?.[0]?.s === 'not_required');
{
  const before = (await q(`SELECT admission_since FROM public.assessments WHERE id = $1`, [PAPER]))[0].admission_since;
  await new Promise(r => setTimeout(r, 20));
  await asInstructor(`UPDATE public.assessments SET requires_admission = true WHERE id = $1`, [PAPER], INS);
  const after = (await q(`SELECT admission_since FROM public.assessments WHERE id = $1`, [PAPER]))[0].admission_since;
  ck('switching it back on stamps a new admission_since', new Date(after) > new Date(before));
  await asInstructor(`UPDATE public.assessments SET admission_since = '2000-01-01' WHERE id = $1`, [PAPER], INS);
  ck('…which an instructor cannot backdate', new Date((await q(`SELECT admission_since FROM public.assessments WHERE id = $1`, [PAPER]))[0].admission_since).getTime() === new Date(after).getTime());
}

console.log('\n=== PAPERS WITH RETAKES (filed in review_attempts, which has no exam_id) ===');
{
  const PRAC = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b35', QP = 'aaaaaaaa-0000-4000-8000-000000000003';
  await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id, is_open, duration_minutes, allow_retakes)
           VALUES ('${PRAC}','exam','Practice','Aeng 427 -3B, Aeng 427 -5B','${INS}',true,60,true);
           INSERT INTO public.questions (id, exam_id, assessment_id, question_number, question_text, question_type, choices, correct_answer, marks)
           VALUES ('${QP}','${PRAC}','${PRAC}',1,'Look-alike practice item','multiple_choice','["a","b"]'::jsonb,0,1);`);
  const file = () => asAnon(`SELECT public.submit_assessment($1,$2,$3::jsonb,60,0,'[]'::jsonb) r`, [ABS, PRAC, JSON.stringify({ [QP]: 0 })]);
  const r1 = await file();
  ck('a practice paper with the switch off files its attempt', r1.ok, r1.message);
  await asInstructor(`UPDATE public.assessments SET requires_admission = true WHERE id = $1`, [PRAC], INS);
  const r2 = await file();
  ck('switched on, an attempt from a student never let in is refused — by the check, not a crash',
    !r2.ok && /not let you in/i.test(r2.message || ''), r2.message);
  const r3 = await asInstructor(`SELECT public.submit_assessment($1,$2,$3::jsonb,60,0,'[]'::jsonb) r`, [ABS, PRAC, JSON.stringify({ [QP]: 0 })], INS);
  ck('…and the instructor can still force-submit it', r3.ok, r3.message);
  ck('two attempts on file', (await q(`SELECT count(*)::int n FROM public.review_attempts WHERE assessment_id = $1`, [PRAC]))[0].n === 2);
  const s118 = fs.readFileSync(`${P}/sql/118_practice_papers_file_again.sql`, 'utf8');
  await x(s118); await x(s118);
  const [v] = await q(s118.slice(s118.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim());
  ck('118 applies, twice, and its VERIFY is true', v.reads_either_table === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
