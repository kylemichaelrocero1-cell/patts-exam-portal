// sql/103: the public key reads no submitted answers (results,
// review_attempts), and cannot unlock a sitting, lower its count, or take
// out or rewrite a logged flag. Checks the student screens' own reads and
// writes still work, the dashboard still reads everything, and no function
// the public key calls reads the closed columns as the caller.
//
//   npm run test:anon-guard
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
const verdict = async (a, acc) => (await q(`SELECT public.working_verdict($1, $2::text[]) v`, [a, acc]))[0].v;

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
  '073_logic_proofs_line_by_line', '076_two_law_steps_and_equations',
  '081_hyperbolic_functions_as_typed', '083_file_before_marking',
  '097_plain_text_answers_and_regrouped_brackets',
  '094_removing_a_student_keeps_other_instructors_students', '095_writes_belong_to_the_papers_instructors',
  '101_a_factor_of_one_is_nothing']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}



const INS = 'd24df77e-309a-4ed8-988f-da3ee1c76408', STU = '11111111-1111-1111-1111-111111111111';
const asAnon = async (sql, params) => {
  try { await x('SET ROLE anon'); return { ok: true, rows: await q(sql, params) }; }
  catch (e) { return { ok: false, message: e.message }; }
  finally { await x('RESET ROLE'); }
};
const asStaff = async (sql, params) => {
  try { await x(`SET test.uid = '${INS}'; SET ROLE authenticated`); return { ok: true, rows: await q(sql, params) }; }
  catch (e) { return { ok: false, message: e.message }; }
  finally { await x(`RESET ROLE; RESET test.uid`); }
};
const GRADED = '7c2e9d41-5a3b-4c6f-8e10-2b9d4f6a8103', PRACTICE = '7c2e9d41-5a3b-4c6f-8e10-2b9d4f6a8104';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.users (id, full_name, section) VALUES ('${STU}','S One','T');
  INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,duration_minutes,allow_retakes,show_answers)
  VALUES ('${GRADED}','exam','Graded 103','T','${INS}',true,60,false,true), ('${PRACTICE}','exam','Practice 103','T','${INS}',true,60,true,true);
  INSERT INTO public.results (student_id, exam_id, assessment_id, score, total_items, answers_json, work_marks, work_total)
  VALUES ('${STU}','${GRADED}','${GRADED}',3,5,'{"q":{"lines":["y=1"],"marks":2}}',2,5);
  INSERT INTO public.review_attempts (student_id, assessment_id, attempt_no, answers_json, work_marks)
  VALUES ('${STU}','${PRACTICE}',1,'{"q":{"lines":["y=2"],"marks":1}}',1);`);

console.log('\n=== before 103: answers readable with the public key ===');
ck('results.answers_json readable before', (await asAnon(`SELECT answers_json FROM public.results`)).ok);

const M103 = fs.readFileSync(P + '/sql/103_answers_are_private_and_locks_hold.sql', 'utf8');
await x(M103); await x(M103);
ck('103 applies, twice', true);
{
  const v = (await q(M103.slice(M103.lastIndexOf('SELECT\n'))))[0];
  ck('103\'s VERIFY row is all true', Object.values(v).every(b => b === true), JSON.stringify(v));
}

console.log('\n=== answers are private ===');
for (const [t, sql] of [['results', 'SELECT answers_json FROM public.results'], ['review_attempts', 'SELECT answers_json FROM public.review_attempts'],
  ['results *', 'SELECT * FROM public.results'], ['results violation_logs', 'SELECT violation_logs FROM public.results']]) {
  const r = await asAnon(sql);
  ck(`public key: ${t} refused`, !r.ok && /permission denied/i.test(r.message), r.message);
}
{
  const home = await asAnon(`SELECT exam_id, score, total_items, points_earned, points_total, work_marks, work_total, submitted_at FROM public.results WHERE student_id = $1`, [STU]);
  ck('public key: the home tabs\' score columns still read', home.ok && home.rows.length === 1, home.message);
  const att = await asAnon(`SELECT assessment_id, attempt_no, score, total_items, points_earned, points_total, work_marks, work_total, submitted_at FROM public.review_attempts WHERE student_id = $1`, [STU]);
  ck('…and the attempts\'', att.ok && att.rows.length === 1, att.message);
  const filed = await asAnon(`SELECT student_id FROM public.results WHERE student_id = $1 AND exam_id = $2 LIMIT 1`, [STU, GRADED]);
  ck('…and the exam screen\'s "is it filed" check', filed.ok && filed.rows.length === 1, filed.message);
  const staff = await asStaff(`SELECT answers_json FROM public.results`);
  ck('the dashboard (signed in) still reads answers', staff.ok && staff.rows.length === 1, staff.message);
}
{
  // Every function the public key may call that reads these columns must be a
  // definer function — otherwise it would now fail for students.
  const bad = (await q(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND NOT p.prosecdef AND p.prosrc ~ '(results|review_attempts)'
      AND p.prosrc ~ '(answers_json|violation_logs)' AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname <> 'live_session_guard'`)).map(r => r.proname);
  ck('no function the public key calls reads them as the caller', bad.length === 0, bad.join(', '));
}

console.log('\n=== a sitting\'s lock and flags hold ===');
const row = async (exam, status, count, log) => (await q(`INSERT INTO public.live_sessions (student_id, exam_id, assessment_id, student_name, status, violation_count, violation_log)
  VALUES ($1,$2,$2,'S One',$3,$4,$5::jsonb) RETURNING id`, [STU, exam, status, count, JSON.stringify(log)]))[0].id;
const get = async id => (await q(`SELECT status, violation_count, violation_log, student_id, answers_count FROM public.live_sessions WHERE id = $1`, [id]))[0];
const upd = (id, patch) => asAnon(`UPDATE public.live_sessions SET ${Object.keys(patch).map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...Object.values(patch)]);
const LOG = ['[10:00:00 AM] Left the exam page (iPhone · Safari)', '[10:05:00 AM] Clicked away from the browser (Windows · Chrome)'];
// The graded sitting is not on file for these, so delete its result first.
await x(`DELETE FROM public.results WHERE exam_id = '${GRADED}'`);
{
  const id = await row(GRADED, 'locked', 4, LOG);
  await upd(id, { status: 'active' });
  ck('public key: a locked sitting stays locked', (await get(id)).status === 'locked');
  await upd(id, { status: 'finished' });
  ck('…and cannot be marked finished to slip the lock', (await get(id)).status === 'locked');
  await upd(id, { violation_count: 0 });
  ck('the count does not go down', (await get(id)).violation_count === 4);
  await upd(id, { violation_log: JSON.stringify([]) });
  ck('the log is not emptied', (await get(id)).violation_log.length === 2);
  await upd(id, { violation_log: JSON.stringify(['[10:00:00 AM] nothing', LOG[1]]) });
  ck('a logged flag is not rewritten', (await get(id)).violation_log[0] === LOG[0]);
  await upd(id, { violation_log: JSON.stringify([`${LOG[0]} — away 48 s`, LOG[1], '[10:09:00 AM] new flag']), violation_count: 5 });
  const g = await get(id);
  ck('a duration added and a new flag appended: kept', g.violation_log.length === 3 && g.violation_log[0].endsWith('away 48 s') && g.violation_count === 5, JSON.stringify(g));
  await upd(id, { student_id: '22222222-2222-2222-2222-222222222222' });
  ck('the sitting stays the student\'s', (await get(id)).student_id === STU);
  await upd(id, { answers_count: 7 });
  ck('the exam screen\'s own saves still go through', (await get(id)).answers_count === 7);
  const staff = await asStaff(`UPDATE public.live_sessions SET status = 'active', violation_count = 0 WHERE id = $1`, [id]);
  ck('an instructor still unlocks and clears (the guard is the public key\'s only)', staff.ok && (await get(id)).status === 'active' && (await get(id)).violation_count === 0, staff.message);
  await x(`DELETE FROM public.live_sessions WHERE id = '${id}'`);
}
{
  const id = await row(GRADED, 'locked', 4, LOG);
  await x(`INSERT INTO public.results (student_id, exam_id, assessment_id, score, total_items) VALUES ('${STU}','${GRADED}','${GRADED}',0,0)`);
  await upd(id, { status: 'finished' });
  ck('a locked sitting whose paper is filed (time ran out) may show finished', (await get(id)).status === 'finished');
  await upd(id, { status: 'active' });
  ck('…but a graded paper on file is not reopened', (await get(id)).status === 'finished');
  await x(`DELETE FROM public.live_sessions WHERE id = '${id}'; DELETE FROM public.results WHERE exam_id = '${GRADED}'`);
}
{
  const id = await row(GRADED, 'finished', 2, LOG);
  await upd(id, { status: 'active' });
  ck('a graded sitting dismissed with nothing filed reopens, as the exam screen does', (await get(id)).status === 'active');
  await x(`DELETE FROM public.live_sessions WHERE id = '${id}'`);
}
{
  const id = await row(PRACTICE, 'finished', 3, LOG);
  await upd(id, { status: 'active', violation_count: 0, violation_log: '[]', answers_count: 0 });
  const g = await get(id);
  ck('a practice paper\'s new attempt starts clean (restartPatch)', g.status === 'active' && g.violation_count === 0 && g.violation_log.length === 0, JSON.stringify(g));
  await upd(id, { violation_count: 0, violation_log: '[]' });
  await upd(id, { violation_count: 1, violation_log: JSON.stringify([LOG[0]]) });
  await upd(id, { violation_count: 0, violation_log: '[]' });
  ck('…and mid-attempt its flags hold like any other', (await get(id)).violation_count === 1 && (await get(id)).violation_log.length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
