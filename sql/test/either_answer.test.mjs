// sql/130: a one-answer question that more than one choice earns. Runs the
// migrations as live (through 116, 119, 120, 123) + 130 against real
// PostgreSQL (PGlite), as the roles a browser has. Picking the key or an
// accepted choice is right, picking anything else or two choices is not; a
// multi-answer item and a plain item mark exactly as before; the
// dashboard's isAnswerCorrect() agrees on every case; answer review sends
// also_correct only when it may; a copy of the paper keeps it; the column
// is for multiple_choice only and a student cannot read it.
//   npm run test:either-answer
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
const S130 = fs.readFileSync(`${P}/sql/130_either_answer_counts.sql`, 'utf8');
const run130 = async () => { try { await x(S130); return ''; } catch (e) { await x('ROLLBACK').catch(() => {}); return e.message; } };

console.log('=== 130 APPLIES, TWICE ===');
{ const m = await run130(); ck('130 applies', m === '', m); }
ck('…and again (idempotent)', (await run130()) === '');
{ const [r] = await q(S130.slice(S130.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim()); ck('VERIFY: every column true', Object.values(r).every(v => v === true), JSON.stringify(r)); }

const PAPER = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1130';
const EI = 'eeeeeeee-0000-4000-8000-000000000001', PL = 'eeeeeeee-0000-4000-8000-000000000002', MU = 'eeeeeeee-0000-4000-8000-000000000003';
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id, is_open, duration_minutes, show_answers)
  VALUES ('${PAPER}','exam','Either answer','Aeng 427 -3B, Aeng 427 -5B','${INS}',true,60,false);
  INSERT INTO public.questions (id, exam_id, assessment_id, question_number, question_text, question_type, choices, correct_answer, correct_answers, accepted_answers, marks) VALUES
    ('${EI}','${PAPER}','${PAPER}',1,'A or C counts','multiple_choice','["a","b","c","d"]'::jsonb,0,NULL,'[2]'::jsonb,2),
    ('${PL}','${PAPER}','${PAPER}',2,'Plain, B','multiple_choice','["a","b","c","d"]'::jsonb,1,NULL,NULL,1),
    ('${MU}','${PAPER}','${PAPER}',3,'Tick A and D','multi_select','["a","b","c","d"]'::jsonb,NULL,'[0,3]'::jsonb,NULL,1);`);
const items = Object.fromEntries((await q(`SELECT * FROM public.questions WHERE exam_id = $1`, [PAPER])).map(r => [r.id, r]));

console.log('\n=== MARKING ===');
const score = async answers => (await q(`SELECT * FROM public.score_answers($1, $2::jsonb, NULL)`, [PAPER, JSON.stringify(answers)]))[0];
const CASES = [
  [EI, 0, true, 'the key'], [EI, 2, true, 'the accepted choice'], [EI, 1, false, 'another choice'], [EI, 3, false, 'another choice'],
  [EI, [0, 2], false, 'both, as a set — one pick only'], [PL, 1, true, 'a plain item, its key'], [PL, 0, false, 'a plain item, wrong'],
  [MU, [0, 3], true, 'multi: every box'], [MU, [0], false, 'multi: one box short'], [MU, 0, false, 'multi: a single pick'],
];
let agree = 0;
for (const [id, pick, want, why] of CASES) {
  const r = await score({ [id]: pick });
  const sql = r.answers_json[id]?.is_correct === true;
  const js = isAnswerCorrect(items[id], pick) === true;
  ck(`${why}: ${want ? 'right' : 'wrong'}`, sql === want, JSON.stringify(r.answers_json[id]));
  if (sql === js) agree++;
}
ck(`the dashboard agrees on every case (${agree}/${CASES.length})`, agree === CASES.length);
{
  const r = await score({ [EI]: 2, [PL]: 1, [MU]: [0, 3] });
  ck('points: the accepted choice earns the item\'s full 2', Number(r.points_earned) === 4 && Number(r.points_total) === 4 && r.score === 3, JSON.stringify(r));
}
ck('acceptedSetOf: A and C for the either item, B for the plain one, A and D for the multi', JSON.stringify([acceptedSetOf(items[EI]), acceptedSetOf(items[PL]), acceptedSetOf(items[MU])]) === '[[0,2],[1],[0,3]]');

console.log('\n=== A WHOLE SITTING ===');
{
  const r = await asAnon(`SELECT public.submit_assessment($1,$2,$3::jsonb,600,0,'[]'::jsonb) r`, [STU, PAPER, JSON.stringify({ [EI]: 2, [PL]: 0 })]);
  const [row] = await q(`SELECT score, points_earned, answers_json FROM public.results WHERE student_id = $1 AND exam_id = $2`, [STU, PAPER]);
  ck('submitted, the accepted pick filed as right', r.ok && row.answers_json[EI].is_correct === true && row.answers_json[PL].is_correct === false && Number(row.points_earned) === 2, r.message || JSON.stringify(row));
}

console.log('\n=== ANSWER REVIEW ===');
const review = async () => (await asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3) r`, [STU, PAPER, TOK])).rows?.[0]?.r || [];
{
  await x(`UPDATE public.assessments SET show_answers = true WHERE id = '${PAPER}'`);
  const rows = await review();
  const ei = rows.find(r => r.question_id === EI), pl = rows.find(r => r.question_id === PL), mu = rows.find(r => r.question_id === MU);
  ck('the either item sends also_correct [2] with its key', JSON.stringify(ei?.also_correct) === '[2]' && ei?.correct === 0, JSON.stringify(ei));
  ck('a plain item sends none', pl?.also_correct === null || pl?.also_correct === undefined);
  ck('a multi item still sends correct_set, not also_correct', JSON.stringify(mu?.correct_set) === '[0,3]' && !mu?.also_correct);
  await x(`UPDATE public.assessments SET review_shows_key = false WHERE id = '${PAPER}'`).catch(() => {});
}

console.log('\n=== THE COLUMN ===');
ck('a student cannot read accepted_answers', !(await asAnon(`SELECT accepted_answers FROM public.questions LIMIT 1`)).ok);
const bad = async sql => { try { await x(sql); return false; } catch { return true; } };
ck('not on a multi-answer item', await bad(`UPDATE public.questions SET accepted_answers = '[1]' WHERE id = '${MU}'`));
ck('not empty', await bad(`UPDATE public.questions SET accepted_answers = '[]' WHERE id = '${PL}'`));
{
  await x(`INSERT INTO public.instructors (id, email, full_name) VALUES ('${INS}', 'i@p.ph', 'Instructor') ON CONFLICT DO NOTHING`).catch(e => console.log('  (instructors row:', e.message, ')'));
  const r = await asInstructor(`SELECT public.duplicate_paper($1, 'Copy', 'Aeng 427 -3B') id`, [PAPER], INS);
  const copy = r.ok ? (await q(`SELECT accepted_answers a FROM public.questions WHERE exam_id = $1 AND question_number = 1`, [r.rows[0].id]))[0] : null;
  ck('a copy of the paper keeps it', JSON.stringify(copy?.a) === '[2]', r.message || JSON.stringify(copy));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
