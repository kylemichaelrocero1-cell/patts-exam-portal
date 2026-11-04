// sql/138: a paper's percentage on 0-base or 50-base. Runs the migrations as
// live (through 130) + 138 against real PostgreSQL (PGlite), as the roles a
// browser has:
//
//   * before 138 the student column list cannot be read: SQL goes first;
//   * after it a student reads every column the screens select, and cannot
//     change the base; the paper's instructor can, and only to 0 or 50;
//   * every existing paper stays on 0-base, and no stored mark moves;
//   * a copy of a paper keeps its base, through either copy function;
//   * 138 runs twice, and its VERIFY row is all true.
//
//   npm run test:grade-base
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
  '105_answers_with_units', '107_papers_without_sets', '110_duplicate_any_paper',
  '115_admit_students_from_the_live_monitor'];
for (const f of MIG) await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
for (const f of ['116_papers_with_sets', '119_display_style_is_not_part_of_an_answer', '120_force_submit_in_one_step', '123_quantity_answers_within_a_tolerance'])
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
const { isAnswerCorrect, acceptedSetOf } = await import(P + '/src/lib/answers.js');

await x(fs.readFileSync(`${P}/sql/130_either_answer_counts.sql`, 'utf8'));

const { ASSESSMENT_COLUMNS } = await import('../../src/lib/assessmentsCore.js');

// Look-alike people and papers, not the real ones.
const KAI = 'a0000000-0000-0000-0000-0000000000a1', BEA = 'b0000000-0000-0000-0000-0000000000b1';
const SRC = '5a000000-0000-0000-0000-000000000001';
await x(`INSERT INTO auth.users VALUES ('${KAI}','k@p.ph'),('${BEA}','b@p.ph');
  INSERT INTO public.instructors (id, email, full_name) VALUES ('${KAI}','k@p.ph','Kai'),('${BEA}','b@p.ph','Bea');
  INSERT INTO public.assessments (id, kind, title, target_section, instructor_id, is_open, duration_minutes)
    VALUES ('${SRC}','exam','Look-alike Quiz','AERO 101','${KAI}',false,60);
  INSERT INTO public.exams (id, title, target_section, instructor_id, is_open, duration_minutes)
    SELECT id, title, target_section, instructor_id, is_open, duration_minutes FROM public.assessments;
  INSERT INTO public.results (student_id, exam_id, assessment_id, score, total_items)
    VALUES ('${STU}','${SRC}','${SRC}',30,60);`);
const studentRead = `SELECT ${ASSESSMENT_COLUMNS} FROM public.assessments`;

console.log('\n=== before 138 ===');
{
  const r = await asAnon(studentRead);
  ck('the student column list cannot be read yet: SQL goes first', !r.ok && /grade_base/.test(r.message), r.message);
}

console.log('\n=== 138 applies ===');
const M = fs.readFileSync(`${P}/sql/138_grade_base_on_a_paper.sql`, 'utf8');
await x(M);
await x(M);
ck('138 applies, twice', true);
{
  const [v] = await q(M.slice(M.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim());
  ck("138's VERIFY row is all true", Object.values(v).every(b => b === true), JSON.stringify(v));
}
ck('an existing paper stays on 0-base',
   (await q(`SELECT grade_base g FROM public.assessments WHERE id=$1`, [SRC]))[0].g === 0);

console.log('\n=== who reads and who sets ===');
{
  const r = await asAnon(studentRead);
  ck('a student reads every column the screens select', r.ok, r.message);
  const u = await asAnon(`UPDATE public.assessments SET grade_base = 50 WHERE id='${SRC}'`);
  ck('a student cannot change it', !u.ok && /permission denied/i.test(u.message), u.message);
  const o = await asInstructor(`UPDATE public.assessments SET grade_base = 50 WHERE id='${SRC}' RETURNING grade_base`, [], KAI);
  ck('its instructor can set 50', o.ok && o.rows[0]?.grade_base === 50, o.message);
  const bad = await asInstructor(`UPDATE public.assessments SET grade_base = 25 WHERE id='${SRC}'`, [], KAI);
  ck('and nothing but 0 or 50', !bad.ok && /grade_base/.test(bad.message), bad.message);
  const made = await asInstructor(`INSERT INTO public.assessments (kind, title, target_section, instructor_id, is_open, duration_minutes, grade_base)
    VALUES ('exam','New on 50','AERO 101','${KAI}',false,60,50) RETURNING grade_base`, [], KAI);
  ck('a new paper can start on 50-base', made.ok && made.rows[0]?.grade_base === 50, made.message);
  const [r0] = await q(`SELECT score, total_items FROM public.results WHERE student_id=$1`, [STU]);
  ck('no stored mark moved', r0.score === 30 && r0.total_items === 60, JSON.stringify(r0));
}

console.log('\n=== a copy keeps its base ===');
{
  const a = await asInstructor(`SELECT public.duplicate_paper('${SRC}','Copy','AERO 102',NULL) AS id`, [], KAI);
  ck('duplicate_paper runs', a.ok, a.message);
  ck('and keeps 50-base', (await q(`SELECT grade_base g FROM public.assessments WHERE id=$1`, [a.rows[0].id]))[0].g === 50);
  const b = await asInstructor(`SELECT public.duplicate_assessment('${SRC}','Mock','AERO 103') AS id`, [], KAI);
  ck('duplicate_assessment runs', b.ok, b.message);
  ck('and keeps 50-base', (await q(`SELECT grade_base g FROM public.assessments WHERE id=$1`, [b.rows[0].id]))[0].g === 50);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
