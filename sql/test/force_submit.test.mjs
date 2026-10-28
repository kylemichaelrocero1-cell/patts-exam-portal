// sql/120: Force Submit files a sitting and closes it in ONE step.
//
// Runs the migrations in the order they went live (through 115 and 118),
// then 116, 119 and 120 as they are to be run, as the roles a browser has.
// Checks that force_submit_sitting() files a graded paper and a practice
// one from what the sitting saved (picked answers, typed working, flags,
// time), closes the sitting, and does it once however often it is called;
// that a filing that fails leaves the sitting open with nothing changed —
// the failure that lost two sittings on 2026-10-28; that only the paper's
// instructors can call it; that a paper with check-in, and one in sets,
// file as the student's own Submit would.
// Look-alike problems only — never a real paper's items.
//
//   npm run test:force-submit
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
const OTH = 'c0ffee00-0000-4000-8000-000000000120';   // another instructor
const S1 = '11111111-1111-1111-1111-111111111111', S2 = '22222222-2222-2222-2222-222222222222';
const S3 = '33333333-3333-3333-3333-333333333333', S4 = '44444444-4444-4444-4444-444444444444';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph'), ('${OTH}','o@p.ph');
  INSERT INTO public.users (id, full_name, section, session_token) VALUES
    ('${S1}','One, Ana','Math 117 -1A', gen_random_uuid()::text), ('${S2}','Two, Ben','Math 117 -1A', gen_random_uuid()::text),
    ('${S3}','Three, Cy','Math 117 -1A', gen_random_uuid()::text), ('${S4}','Four, Di','Math 117 -1A', gen_random_uuid()::text);`);

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
  '097_plain_text_answers_and_regrouped_brackets', '101_a_factor_of_one_is_nothing',
  '103_answers_are_private_and_locks_hold', '104_deletes_wait_thirty_days_in_trash',
  '105_answers_with_units', '107_papers_without_sets', '110_duplicate_any_paper',
  '115_admit_students_from_the_live_monitor', '118_practice_papers_file_again'];
for (const f of MIG) {
  try { await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8')); }
  catch (e) { console.error(`could not apply ${f}: ${e.message}`); process.exit(1); }
}

console.log('=== 116, 119, 120 APPLY, EACH TWICE ===');
for (const f of ['116_papers_with_sets', '119_display_style_is_not_part_of_an_answer', '120_force_submit_in_one_step']) {
  const sql = fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8');
  let m = '';
  try { await x(sql); await x(sql); } catch (e) { await x('ROLLBACK').catch(() => {}); m = e.message; }
  ck(`${f} applies twice`, m === '', m);
  const verify = sql.slice(sql.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim();
  const [r] = await q(verify);
  ck(`${f}: VERIFY row all true`, Object.values(r).every(v => v === true), JSON.stringify(r));
}

// A graded quiz (two picked items and a full solution) and a practice paper.
const GRADED = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1201', PRACTICE = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1202';
const G1 = 'aaaaaaaa-0000-4000-8000-000000000001', G2 = 'aaaaaaaa-0000-4000-8000-000000000002', GW = 'aaaaaaaa-0000-4000-8000-000000000003';
const P1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const RUB = JSON.stringify({ mode: 'lines', steps: [
  { latex: 'y=3\\tanh(4x)', marks: 1 }, { latex: "y'=3\\operatorname{sech}^2(4x)(4)", marks: 3 },
  { latex: "y'=12\\operatorname{sech}^2(4x)", marks: 5 }] });
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id, is_open, duration_minutes, allow_retakes)
  VALUES ('${GRADED}','exam','Quiz','Math 117 -1A','${INS}',true,60,false),
         ('${PRACTICE}','exam','Assignment','Math 117 -1A','${INS}',true,30,true);
  INSERT INTO public.questions (id, exam_id, assessment_id, question_number, question_text, question_type, choices, correct_answer, marks, work_given, work_rubric) VALUES
    ('${G1}','${GRADED}','${GRADED}',1,'Look-alike one','multiple_choice','["a","b","c","d"]'::jsonb,2,1,NULL,NULL),
    ('${G2}','${GRADED}','${GRADED}',2,'Look-alike two','multiple_choice','["a","b","c","d"]'::jsonb,1,1,NULL,NULL),
    ('${P1}','${PRACTICE}','${PRACTICE}',1,'Look-alike practice','multiple_choice','["a","b","c","d"]'::jsonb,0,1,NULL,NULL);`);
await q(`INSERT INTO public.questions (id, exam_id, assessment_id, question_number, question_text, question_type, marks, work_given, work_rubric)
  VALUES ($1,$2,$2,3,'Differentiate y = 3 tanh(4x)','worked_solution',5,'y=3\\tanh(4x)',$3::jsonb)`, [GW, GRADED, RUB]);
const WORK = { [GW]: { lines: ['y=3\\tanh\\left(4x\\right)', "y^{\\prime}={\\displaystyle3\\operatorname{\\mathrm{sech}}^2(4x)(4)}", "y^{\\prime}=12\\operatorname{\\mathrm{sech}}^2\\left(4x\\right)"] } };
const sit = async (stu, paper, { answers = {}, work = null, status = 'active', mins = 20, flags = 0, log = [] } = {}) =>
  (await q(`INSERT INTO public.live_sessions (student_id, exam_id, assessment_id, student_name, status, answers_json, work_answers_json, violation_count, violation_log, created_at)
    VALUES ($1,$2,$2,'x',$3,$4::jsonb,$5::jsonb,$6,$7::jsonb, now() - make_interval(mins => $8))
    ON CONFLICT ON CONSTRAINT live_sessions_student_exam_key DO UPDATE SET status = EXCLUDED.status, answers_json = EXCLUDED.answers_json,
      created_at = EXCLUDED.created_at RETURNING id`,
    [stu, paper, status, JSON.stringify(answers), work ? JSON.stringify(work) : null, flags, JSON.stringify(log), mins]))[0].id;
const force = (id, uid = INS) => asInstructor(`SELECT public.force_submit_sitting($1) r`, [id], uid);
const statusOf = async id => (await q(`SELECT status FROM public.live_sessions WHERE id = $1`, [id]))[0]?.status;
const resultOf = async (stu, paper) => (await q(`SELECT * FROM public.results WHERE student_id = $1 AND exam_id = $2`, [stu, paper]));
const attemptsOf = async (stu, paper) => (await q(`SELECT * FROM public.review_attempts WHERE student_id = $1 AND assessment_id = $2 ORDER BY attempt_no`, [stu, paper]));

console.log('\n=== A GRADED PAPER ===');
const s1 = await sit(S1, GRADED, { answers: { [G1]: 2, [G2]: 3 }, work: WORK, mins: 90, flags: 2, log: ['[3:00:00 PM] Left the page — away 6 s', '[3:10:00 PM] Left the page — away 2 s'] });
{
  const r = await force(s1);
  const out = r.rows?.[0]?.r;
  ck('Force Submit files it', r.ok && out?.outcome === 'filed', r.message || JSON.stringify(out));
  const [row] = await resultOf(S1, GRADED);
  ck('…one result, the picked answers marked (1 of 2)', row && row.score === 1 && row.total_items === 2, JSON.stringify(row && { s: row.score, t: row.total_items }));
  ck('…the typed working filed and marked from the sitting (5 of 5, wrapped line and all)', Number(row?.answers_json?.[GW]?.marks) === 5 && Number(row?.work_marks) === 5,
    JSON.stringify(row?.answers_json?.[GW]));
  ck('…the flags kept, word for word', row?.tab_switches === 2 && JSON.stringify(row?.violation_logs) === JSON.stringify(['[3:00:00 PM] Left the page — away 6 s', '[3:10:00 PM] Left the page — away 2 s']));
  ck('…the time taken capped at the paper\'s 60 minutes', row?.time_taken_seconds === 3600, String(row?.time_taken_seconds));
  ck('…and the sitting is closed', (await statusOf(s1)) === 'finished');
  const again = await force(s1);
  ck('a second Force Submit (another dashboard) files nothing more', again.ok && again.rows[0].r.outcome === 'already' && (await resultOf(S1, GRADED)).length === 1, JSON.stringify(again));
}
ck('a sitting that is not there: said, not an error', (await force('99999999-9999-4999-8999-999999999999')).rows?.[0]?.r?.outcome === 'gone');

console.log('\n=== FILING FAILS: THE SITTING STAYS OPEN ===');
const s2 = await sit(S2, GRADED, { answers: { [G1]: 2 }, status: 'locked' });
await x(`CREATE FUNCTION public.test_refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'record "new" has no field "exam_id"'; END $$;
         CREATE TRIGGER test_refuse BEFORE INSERT ON public.results FOR EACH ROW EXECUTE FUNCTION public.test_refuse();`);
{
  const r = await force(s2);
  ck('the error comes back to the dashboard', !r.ok && /no field/.test(r.message), r.message);
  ck('…the sitting is still open, as it was (locked)', (await statusOf(s2)) === 'locked');
  ck('…nothing on file', (await resultOf(S2, GRADED)).length === 0);
}
await x(`DROP TRIGGER test_refuse ON public.results; DROP FUNCTION public.test_refuse();`);
{
  const r = await force(s2);
  ck('once the fault is gone, the same sitting files', r.ok && r.rows[0].r.outcome === 'filed' && (await resultOf(S2, GRADED)).length === 1, r.message);
}

console.log('\n=== WHO MAY ===');
const s3 = await sit(S3, GRADED, { answers: { [G1]: 2 } });
{
  const r = await force(s3, OTH);
  ck('another instructor is refused', !r.ok && /instructors/.test(r.message), r.message);
  ck('…and the sitting is untouched', (await statusOf(s3)) === 'active' && (await resultOf(S3, GRADED)).length === 0);
  const a = await asAnon(`SELECT public.force_submit_sitting($1) r`, [s3]);
  ck('a student cannot call it', !a.ok && /permission denied/.test(a.message), a.message);
  const n = await asInstructor(`SELECT public.force_submit_sitting($1) r`, [s3], '');
  ck('nor anyone not signed in', !n.ok, n.message);
}

console.log('\n=== A PRACTICE PAPER: EACH SITTING AN ATTEMPT ===');
{
  const a = await sit(S4, PRACTICE, { answers: { [P1]: 0 }, mins: 10 });
  const r1 = await force(a);
  ck('attempt 1 filed', r1.ok && r1.rows[0].r.attempt_no === 1 && (await statusOf(a)) === 'finished', r1.message || JSON.stringify(r1.rows?.[0]));
  const b = await sit(S4, PRACTICE, { answers: { [P1]: 1 }, mins: 5 });
  const r2 = await force(b);
  const at = await attemptsOf(S4, PRACTICE);
  ck('a new sitting is attempt 2, marked on its own answers', r2.ok && at.length === 2 && at[0].score === 1 && at[1].score === 0, JSON.stringify(at.map(t => [t.attempt_no, t.score])));
  ck('time taken is the sitting\'s, not the paper\'s cap', at[1].time_taken_seconds >= 299 && at[1].time_taken_seconds <= 305, String(at[1].time_taken_seconds));
}

console.log('\n=== BLANKS ===');
{
  const S5 = '55555555-5555-5555-5555-555555555555';
  await x(`INSERT INTO public.users (id, full_name, section, session_token) VALUES ('${S5}','Five, Eve','Math 117 -1A','t5')`);
  const id = await sit(S5, GRADED, { answers: { [G1]: null, [G2]: [] } });
  const r = await force(id);
  const [row] = await resultOf(S5, GRADED);
  ck('a sitting with nothing picked still files, 0 of 2', r.ok && row?.score === 0 && row?.total_items === 2, r.message || JSON.stringify(row));
}

console.log('\n=== CHECK-IN ON, STUDENT NEVER LET IN ===');
{
  const S6 = '66666666-6666-6666-6666-666666666666';
  await x(`INSERT INTO public.users (id, full_name, section, session_token) VALUES ('${S6}','Six, Fe','Math 117 -1A','t6');
           UPDATE public.assessments SET requires_admission = true WHERE id = '${PRACTICE}';`);
  const id = await sit(S6, PRACTICE, { answers: { [P1]: 0 } });
  const r = await force(id);
  ck('the instructor files it all the same (the filing trigger, 115/118)', r.ok && r.rows[0].r.outcome === 'filed' && (await attemptsOf(S6, PRACTICE)).length === 1, r.message);
  await x(`UPDATE public.assessments SET requires_admission = false WHERE id = '${PRACTICE}'`);
}

console.log('\n=== A PAPER IN SETS ===');
{
  const SETS = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1203', S7 = '77777777-7777-7777-7777-777777777777';
  const C = 'cccccccc-0000-4000-8000-000000000001', A = 'cccccccc-0000-4000-8000-00000000000a', B = 'cccccccc-0000-4000-8000-00000000000b';
  await x(`INSERT INTO public.users (id, full_name, section, session_token) VALUES ('${S7}','Seven, Gil','Math 117 -1A','t7');
    INSERT INTO public.assessments (id, kind, title, target_section, instructor_id, is_open, duration_minutes) VALUES ('${SETS}','exam','Midterm','Math 117 -1A','${INS}',true,60);
    INSERT INTO public.questions (id, exam_id, assessment_id, question_number, question_text, question_type, choices, correct_answer, marks, set_label) VALUES
      ('${C}','${SETS}','${SETS}',1,'Every set','multiple_choice','["a","b"]'::jsonb,0,1,NULL),
      ('${A}','${SETS}','${SETS}',2,'Set A only','multiple_choice','["a","b"]'::jsonb,1,4,'A'),
      ('${B}','${SETS}','${SETS}',2,'Set B only','multiple_choice','["a","b"]'::jsonb,0,4,'B');
    INSERT INTO public.paper_set_choices (assessment_id, student_id, set_label) VALUES ('${SETS}','${S7}','B');`);
  const id = await sit(S7, SETS, { answers: { [C]: 0, [B]: 0 } });
  const r = await force(id);
  const [row] = await resultOf(S7, SETS);
  ck('marked on the student\'s set only: 2 of 2 items, 5 of 5 points', r.ok && row?.score === 2 && row?.total_items === 2 && Number(row?.points_earned) === 5 && Number(row?.points_total) === 5,
    r.message || JSON.stringify(row && [row.score, row.total_items, row.points_earned, row.points_total]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
