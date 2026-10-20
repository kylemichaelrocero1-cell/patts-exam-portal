// sql/083: a paper is filed before it is marked, so a marking that runs
// out of time can never turn a submission away.
//
// PGlite does not enforce statement_timeout, so the timeout is stood in for
// by a marker that raises query_canceled — the error a statement timeout
// is. Checks that under 039 that error took the whole submission with it
// (nothing filed), and under 083 the paper and its working are filed with
// the marks pending; that an ordinary submission marks exactly as before,
// graded and practice; that any other marking error still leaves the paper
// filed; and that students can still call it.
//
//   npm run test:file-first
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
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '\n        ' + d : ''}`)); };

await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;`);
const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);
await x(setup.match(/ALTER TABLE public\.\w+\s+ENABLE ROW LEVEL SECURITY;/g).join('\n'));
await x(setup.match(/^(DROP POLICY IF EXISTS|CREATE POLICY)[\s\S]*?;/gm).filter(s => !/storage\./.test(s)).join('\n'));
await x(setup.match(/CREATE OR REPLACE FUNCTION public\.verify_exam_password[\s\S]*?END; \$\$;/)[0]);
await x(setup.match(/^(GRANT|REVOKE)[\s\S]*?;/gm).filter(g => /public\./.test(g) && !/storage|FUNCTION/.test(g)).join('\n'));

const INS = 'd24df77e-309a-4ed8-988f-da3ee1c76408';
const STU = '11111111-1111-1111-1111-111111111111';
const TOK = 'f0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1a';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.users (id, full_name, section, session_token)
  VALUES ('${STU}','S One','MATH 117','${TOK}');`);
for (const f of ['001_assessments_and_lessons', '002_review_mode_and_server_scoring',
  '003_lock_answer_key', '012_five_option_items', '002b_grant_new_columns',
  '015_archive_assessments', '016_unlimited_choices', '017_shuffle_questions_switch',
  '018_multi_select_items', '019_exam_password_on_assessments',
  '020_exam_content_behind_the_gate', '021_revoke_direct_question_reads',
  '022_answer_review_needs_identity', '023_drop_unidentified_answer_review',
  '024_worked_solution_items', '025_points_per_item',
  '026_worked_answers_are_saved_and_scored', '027_score_worked_in_the_database',
  '028_worked_items_in_answer_review', '029_guarded_review_shows_worked_items',
  '030_primes_as_the_editor_writes_them', '031_any_function_name_is_a_subject',
  '032_a_label_is_part_of_the_answer', '033_a_minus_may_sit_on_the_numerator',
  '036_four_primes_and_brackets', '037_keyboard_leftovers', '038_any_arrow_is_to',
  '039_submit_files_the_working', '042_working_marked_line_by_line',
  '043_partial_working_earns_more', '045_brackets_that_change_nothing',
  '046_answers_typed_as_words', '050_answers_as_the_keyboard_spells_them',
  '053_marking_fast_again', '058_keyboard_spellings_fast', '061_minus_out_of_a_bracket',
  '066_times_between_numbers_and_zero_terms', '071_the_keyboards_e_is_e',
  '073_logic_proofs_line_by_line', '076_two_law_steps_and_equations']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

await x(fs.readFileSync(P + '/sql/081_hyperbolic_functions_as_typed.sql', 'utf8'));

// A practice paper and a graded one, each one full solution worth 5.
const PRACTICE = '3d7a1c55-8e2b-4f90-a1c3-6b5e2d9f0a14', GRADED = '5e9b2d77-1f4c-4a83-b2d5-8c7f3e1a6b29';
const RUBRIC = { mode: 'lines', steps: [
  { latex: 'y=4x^3', marks: 1 },
  { latex: "y'=4(3x^2)", marks: 3 },
  { latex: "y'=12x^2", marks: 5, alone: 3, partial: 4 }] };
const RIGHT = ['y=4x^3', "y'=4(3x^2)", "y'=12x^2"];
for (const [id, retakes] of [[PRACTICE, true], [GRADED, false]]) {
  await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,duration_minutes,allow_retakes,show_answers)
           VALUES ('${id}','exam','P','MATH 117','${INS}',true,60,${retakes},true);`);
  await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text, question_type, choices, correct_answer, marks,
             work_given, work_variable, work_rubric)
           VALUES ($1,$1,1,'Differentiate.','worked_solution','[]'::jsonb,NULL,5,'y=4x^3','x',$2::jsonb)`, [id, JSON.stringify(RUBRIC)]);
}
const qid = async id => (await q(`SELECT id FROM public.questions WHERE exam_id = $1`, [id]))[0].id;
const sit = async (id, lines) => {
  await x(`DELETE FROM public.live_sessions WHERE student_id='${STU}'`);
  await q(`INSERT INTO public.live_sessions (student_id, exam_id, assessment_id, student_name, status, work_answers_json)
           VALUES ($1,$2,$2,'S One','active',$3::jsonb)`, [STU, id, JSON.stringify({ [await qid(id)]: { lines } })]);
  try {
    await x(`SET ROLE anon`);
    return { r: (await q(`SELECT public.submit_assessment($1,$2,'{}'::jsonb,60,0,'[]'::jsonb) AS r`, [STU, id]))[0].r };
  } catch (e) { return { error: e.message }; } finally { await x(`RESET ROLE`); }
};
const filed = async id => (await q(`SELECT work_marks, work_total, answers_json FROM public.review_attempts WHERE assessment_id = $1
                                    UNION ALL SELECT work_marks, work_total, answers_json FROM public.results WHERE assessment_id = $1`, [id]));
const clear = async () => x(`DELETE FROM public.review_attempts; DELETE FROM public.results;`);

// The marker, as it is, and a stand-in that runs out of time.
const realMarker = (await q(`SELECT pg_get_functiondef('public.score_worked_answers(uuid,uuid,integer)'::regprocedure) d`))[0].d;
const timesOut = `CREATE OR REPLACE FUNCTION public.score_worked_answers(p_student_id uuid, p_assessment_id uuid, p_attempt_no integer DEFAULT NULL)
  RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
    UPDATE public.results SET work_marks = 999 WHERE assessment_id = p_assessment_id;
    RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled';
  END $$;`;
const breaks = timesOut.replace(`USING ERRCODE = 'query_canceled'`, '');

console.log('\n=== under 039 ===');
await x(timesOut);
{
  const s = await sit(GRADED, RIGHT);
  ck('a marking that runs out of time took the submission with it', !!s.error && /timeout/.test(s.error) && (await filed(GRADED)).length === 0,
    JSON.stringify(s));
}
await x(realMarker); await clear();

console.log('\n=== 083 applies ===');
const M083 = fs.readFileSync(P + '/sql/083_file_before_marking.sql', 'utf8');
await x(M083); await x(M083);
ck('083 applies, twice', true);
{
  const v = (await q(M083.slice(M083.lastIndexOf('SELECT\n'))))[0];
  ck('083\'s VERIFY row is all true', Object.values(v).every(b => b === true), JSON.stringify(v));
}

console.log('\n=== an ordinary submission marks exactly as before ===');
for (const [id, kind] of [[GRADED, 'graded'], [PRACTICE, 'practice']]) {
  const s = await sit(id, RIGHT);
  const f = (await filed(id))[0];
  ck(`${kind}: filed and marked 5 of 5, returned to the student`, s.r && Number(s.r.work_marks) === 5 && Number(s.r.work_total) === 5
    && Number(f.work_marks) === 5, JSON.stringify(s));
}
{
  const s = await sit(PRACTICE, ['y=4x^3', "y'=4(3x)"]);
  ck('practice: partly right is still 1', s.r && Number(s.r.work_marks) === 1, JSON.stringify(s));
}
await clear();

console.log('\n=== a marking that runs out of time ===');
await x(timesOut);
for (const [id, kind] of [[GRADED, 'graded'], [PRACTICE, 'practice']]) {
  const s = await sit(id, RIGHT);
  const f = (await filed(id))[0];
  const lines = f && Object.values(f.answers_json || {}).find(v => v?.type === 'worked')?.lines;
  ck(`${kind}: the submission goes through`, !!s.r && !s.error, JSON.stringify(s));
  ck(`${kind}: the paper is filed with its working`, !!f && JSON.stringify(lines) === JSON.stringify(RIGHT), JSON.stringify(f));
  ck(`${kind}: the marks are pending, and the half-done marking is undone`, f && f.work_marks === null && f.work_total === null
    && s.r.work_marks === null && s.r.work_total === null, JSON.stringify(f));
}
await clear();

console.log('\n=== any other marking error ===');
await x(breaks);
{
  const s = await sit(GRADED, RIGHT);
  const f = (await filed(GRADED))[0];
  ck('the paper is still filed with its working, marks pending', !!s.r && f && f.work_marks === null
    && Object.values(f.answers_json || {}).some(v => v?.type === 'worked'), JSON.stringify(s));
}
await x(realMarker); await clear();

console.log('\n=== once filed, a second submit changes nothing ===');
{
  await sit(GRADED, RIGHT);
  const s = await sit(GRADED, ['y=4x^3']);
  ck('the first marks stand', Number((await filed(GRADED))[0].work_marks) === 5, JSON.stringify(s));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
