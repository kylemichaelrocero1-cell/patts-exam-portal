// Runs the migrations as live (through 083, 094, 095, 105, 107, 110, 115)
// + 116 against real PostgreSQL (PGlite), as the roles a browser has. A
// paper whose questions carry set labels hands each student only the set
// they chose (and the items in every set), keeps them on it once they have
// started, and marks, totals and reviews that set alone; a paper without
// sets is unchanged.
//   npm run test:sets
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
const SQL116 = fs.readFileSync(`${P}/sql/116_papers_with_sets.sql`, 'utf8');
const verify116 = SQL116.slice(SQL116.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim();
const tryRun = async () => { try { await x(SQL116); return ''; } catch (e) { await x('ROLLBACK').catch(() => {}); return e.message; } };

console.log('=== 116 APPLIES, TWICE ===');
{ const m = await tryRun(); ck('116 applies', m === '', m); }
ck('…and again (idempotent)', (await tryRun()) === '');
{ const [r] = await q(verify116); ck('VERIFY: every column true', Object.values(r).every(v => v === true), JSON.stringify(r)); }

// A midterm: two concept items in every set, then a problem in each of Set A
// and Set B — one picked item and one typed quantity item per set.
const PAPER = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b40', PLAIN = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b41';
const C1 = 'cccccccc-0000-4000-8000-000000000001', C2 = 'cccccccc-0000-4000-8000-000000000002';
const AM = 'aaaaaaaa-0000-4000-8000-0000000000a1', AQ = 'aaaaaaaa-0000-4000-8000-0000000000a2';
const BM = 'bbbbbbbb-0000-4000-8000-0000000000b1', BQ = 'bbbbbbbb-0000-4000-8000-0000000000b2';
const rub = (v1, v2) => JSON.stringify({ mode: 'quantity', parts: [
  { key: 'a', value: v1, decimals: 2, units: ['m/s'], value_marks: 2, unit_marks: 2 },
  { key: 'b', value: v2, decimals: 4, units: [], value_marks: 4, unit_marks: 0 }] });
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id, is_open, duration_minutes, show_answers)
  VALUES ('${PAPER}','exam','Midterm with sets','Aeng 427 -3B, Aeng 427 -5B','${INS}',true,60,true),
         ('${PLAIN}','exam','Paper without sets','Aeng 427 -3B, Aeng 427 -5B','${INS}',true,60,true);
  INSERT INTO public.questions (id, exam_id, assessment_id, question_number, question_text, question_type, choices, correct_answer, marks, set_label, work_given, work_rubric) VALUES
    ('${C1}','${PAPER}','${PAPER}',1,'Concept one','multiple_choice','["a","b","c","d"]'::jsonb,1,1,NULL,NULL,NULL),
    ('${C2}','${PAPER}','${PAPER}',2,'Concept two','multiple_choice','["a","b","c","d"]'::jsonb,2,1,NULL,NULL,NULL),
    ('${AM}','${PAPER}','${PAPER}',3,'Set A picked','multiple_choice','["a","b","c","d"]'::jsonb,0,4,'A',NULL,NULL),
    ('${AQ}','${PAPER}','${PAPER}',4,'Set A typed','worked_solution',NULL,NULL,8,'A','a) Speed (2 decimal places)\nb) Ratio (4 decimal places)','${rub('187.42', '0.4821')}'::jsonb),
    ('${BM}','${PAPER}','${PAPER}',3,'Set B picked','multiple_choice','["a","b","c","d"]'::jsonb,3,4,'B',NULL,NULL),
    ('${BQ}','${PAPER}','${PAPER}',4,'Set B typed','worked_solution',NULL,NULL,8,'B','a) Speed (2 decimal places)\nb) Ratio (4 decimal places)','${rub('203.57', '0.7315')}'::jsonb),
    ('dddddddd-0000-4000-8000-000000000001','${PLAIN}','${PLAIN}',1,'Plain one','multiple_choice','["a","b"]'::jsonb,0,1,NULL,NULL,NULL),
    ('dddddddd-0000-4000-8000-000000000002','${PLAIN}','${PLAIN}',2,'Plain two','multiple_choice','["a","b"]'::jsonb,1,1,NULL,NULL,NULL);`);

const setsOf = async id => (await q(`SELECT set_labels FROM public.assessments WHERE id = $1`, [id]))[0].set_labels;
const fetchSet = (stu, tok, set, paper = PAPER) => asAnon(`SELECT id FROM public.get_exam_questions($1,$2,$3,NULL,$4)`, [paper, stu, tok, set]);
const ids = r => (r.rows || []).map(x => x.id).sort();
const submit = (stu, answers, paper = PAPER) => asAnon(`SELECT public.submit_assessment($1,$2,$3::jsonb,600,0,'[]'::jsonb) r`, [stu, paper, JSON.stringify(answers)]);
const saveWork = (stu, paper, work) => x(`INSERT INTO public.live_sessions (student_id, exam_id, student_name, status, work_answers_json)
  VALUES ('${stu}','${paper}','x','active','${JSON.stringify(work)}'::jsonb)
  ON CONFLICT DO NOTHING`);

console.log('\n=== A PAPER\'S SETS ===');
ck('the trigger lists the paper\'s sets', JSON.stringify(await setsOf(PAPER)) === '["A","B"]');
ck('a paper without sets lists none', JSON.stringify(await setsOf(PLAIN)) === '[]');
ck('a student can read a paper\'s sets', (await asAnon(`SELECT set_labels FROM public.assessments WHERE id = $1`, [PAPER])).ok);
await x(`UPDATE public.questions SET set_label = 'C' WHERE id = '${BM}'`);
ck('moving an item to another set updates the list', JSON.stringify(await setsOf(PAPER)) === '["A","B","C"]');
await x(`UPDATE public.questions SET set_label = 'B' WHERE id = '${BM}'`);
ck('…and back', JSON.stringify(await setsOf(PAPER)) === '["A","B"]');
ck('only A to Z is a set', !(await (async () => { try { await x(`UPDATE public.questions SET set_label = 'a1' WHERE id = '${BM}'`); return true; } catch { return false; } })()));

console.log('\n=== CHOOSING A SET ===');
ck('no set chosen: refused', /choose your set/i.test((await asAnon(`SELECT id FROM public.get_exam_questions($1,$2,$3)`, [PAPER, STU, TOK])).message || ''));
ck('a set the paper does not have: refused', /choose your set/i.test((await fetchSet(STU, TOK, 'C')).message || ''));
{
  const r = await fetchSet(STU, TOK, 'A');
  ck('Set A: the items in every set, and Set A\'s', JSON.stringify(ids(r)) === JSON.stringify([AM, AQ, C1, C2].sort()), r.message || JSON.stringify(ids(r)));
}
ck('the choice is recorded', (await q(`SELECT set_label FROM public.paper_set_choices WHERE student_id = $1`, [STU]))[0]?.set_label === 'A');
{
  const r = await fetchSet(STU, TOK, 'B');
  ck('before starting, a student may change their mind (Set B)', JSON.stringify(ids(r)) === JSON.stringify([BM, BQ, C1, C2].sort()), r.message);
}
await saveWork(STU, PAPER, { [BQ]: { lines: ['a) 203.57 m/s', 'b) 0.7315'] } });
ck('mid-sitting, another set is refused', /sitting Set B/i.test((await fetchSet(STU, TOK, 'A')).message || ''));
ck('…and their own set still opens', ids(await fetchSet(STU, TOK, 'B')).length === 4);
ck('a student cannot read the choices', !(await asAnon(`SELECT * FROM public.paper_set_choices`)).ok);
ck('the paper\'s instructor can', (await asInstructor(`SELECT set_label FROM public.paper_set_choices`, [], INS)).rows?.length === 1);
ck('another instructor sees none', (await asInstructor(`SELECT * FROM public.paper_set_choices`, [], OTH)).rows?.length === 0);

console.log('\n=== MARKED AND COUNTED BY SET ===');
{
  // Set B: both concepts right, B's picked item right; typed: value right, unit right, ratio right.
  const r = await submit(STU, { [C1]: 1, [C2]: 2, [BM]: 3, [AM]: 0 });
  ck('Paula (Set B) files', r.ok, r.message);
  const [res] = await q(`SELECT score, total_items, points_earned, points_total, work_marks, work_total, answers_json FROM public.results WHERE student_id = $1 AND exam_id = $2`, [STU, PAPER]);
  ck('picked items: out of the 3 in her set, not 4', res.total_items === 3 && res.score === 3, JSON.stringify(res));
  ck('picked points: out of 6 (1 + 1 + 4)', Number(res.points_total) === 6 && Number(res.points_earned) === 6);
  ck('a Set A answer she sent is not marked', !(AM in res.answers_json));
  ck('typed items: only Set B\'s, 8 of 8', Number(res.work_total) === 8 && Number(res.work_marks) === 8, `${res.work_marks}/${res.work_total}`);
  ck('…and Set A\'s typed item is not on her paper at all', !(AQ in res.answers_json));
}
{
  await fetchSet(ABS, TAB, 'A');
  await saveWork(ABS, PAPER, { [AQ]: { lines: ['a) 187.42 km/h', 'b) 0.482'] } });
  const r = await submit(ABS, { [C1]: 0, [AM]: 0 });
  const [res] = await q(`SELECT score, total_items, points_total, work_marks, work_total FROM public.results WHERE student_id = $1 AND exam_id = $2`, [ABS, PAPER]);
  ck('Arturo (Set A) files', r.ok, r.message);
  ck('out of Set A\'s items: 3 picked, 6 points, 8 typed', res.total_items === 3 && Number(res.points_total) === 6 && Number(res.work_total) === 8, JSON.stringify(res));
  ck('a wrong unit and too few decimals cost what they should (2 of 8)', Number(res.work_marks) === 2, String(res.work_marks));
}
ck('once filed, a one-attempt paper cannot be reopened in another set',
  await (async () => { await x(`UPDATE public.live_sessions SET status = 'finished' WHERE student_id = '${ABS}'`);
    return /sitting Set A/i.test((await fetchSet(ABS, TAB, 'B')).message || ''); })());

console.log('\n=== ANSWER REVIEW ===');
{
  const r = await asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3) r`, [STU, PAPER, TOK]);
  const shown = (r.rows?.[0]?.r || []).map(i => i.question_id).sort();
  ck('the review shows her set and the items in every set, nothing else', JSON.stringify(shown) === JSON.stringify([BM, BQ, C1, C2].sort()), r.message || JSON.stringify(shown));
}

console.log('\n=== A PAPER WITHOUT SETS: AS BEFORE ===');
{
  const r = await asAnon(`SELECT id FROM public.get_exam_questions($1,$2,$3)`, [PLAIN, STU, TOK]);
  ck('three-argument call, every item', r.rows?.length === 2, r.message);
  ck('a set sent anyway changes nothing', (await fetchSet(STU, TOK, 'A', PLAIN)).rows?.length === 2);
  const s = await submit(STU, { 'dddddddd-0000-4000-8000-000000000001': 0 }, PLAIN);
  const [res] = await q(`SELECT score, total_items FROM public.results WHERE student_id = $1 AND exam_id = $2`, [STU, PLAIN]);
  ck('marked out of every item', s.ok && res.total_items === 2 && res.score === 1, JSON.stringify(res));
  ck('and no set is recorded for it', (await q(`SELECT count(*)::int n FROM public.paper_set_choices WHERE assessment_id = $1`, [PLAIN]))[0].n === 0);
}

console.log('\n=== CHECK-IN AND SETS TOGETHER ===');
{
  await x(`UPDATE public.assessments SET requires_admission = true WHERE id = '${PAPER}'`);
  const E1 = 'eeeeeeee-0000-4000-8000-000000000116';
  const r0 = await asAnon(`SELECT id FROM public.get_exam_questions($1,$2,$3,$4,$5)`, [PAPER, EARLY, TEA, E1, 'B']);
  ck('not let in: no paper, whatever the set', /not let you in/i.test(r0.message || ''));
  await asAnon(`SELECT public.request_admission($1,$2,$3,$4)`, [PAPER, EARLY, TEA, E1]);
  const req = (await q(`SELECT id FROM public.exam_admissions WHERE entry = $1`, [E1]))[0].id;
  await asInstructor(`SELECT public.decide_admission($1, true)`, [req], INS);
  const r1 = await asAnon(`SELECT id FROM public.get_exam_questions($1,$2,$3,$4,$5)`, [PAPER, EARLY, TEA, E1, 'B']);
  ck('let in, Set B: her set', JSON.stringify(ids(r1)) === JSON.stringify([BM, BQ, C1, C2].sort()), r1.message);
  await x(`UPDATE public.assessments SET requires_admission = false WHERE id = '${PAPER}'`);
}

console.log('\n=== DUPLICATE KEEPS THE SETS ===');
{
  await x(`INSERT INTO public.instructors (id, email, full_name) VALUES ('${INS}','i@p.ph','Kyle') ON CONFLICT DO NOTHING`);
  const r = await asInstructor(`SELECT public.duplicate_paper($1, 'Midterm copy', 'Aeng 427 -3B', NULL) AS id`, [PAPER], INS);
  const copy = r.rows?.[0]?.id;
  ck('the copy has Set A and Set B', !!copy && JSON.stringify(await setsOf(copy)) === '["A","B"]', r.message || String(copy));
}

console.log('\n=== UNITS WITH SUPERSCRIPTS (database and dashboard agree) ===');
{
  const { quantityUnitKey } = await import('../../src/lib/quantityAnswer.js');
  const cases = ['kg/m³', 'kg/m^3', 'kg/m3', 'kg/m', 'lb/ft²', 'lb/ft^2', 'N/m²', 'ft·lb/(lb·°R)', 'm/s', 'Pa'];
  let same = 0;
  for (const c of cases) if ((await q(`SELECT public.quantity_unit_key($1) k`, [c]))[0].k === quantityUnitKey(c)) same++;
  ck(`the twins agree on every spelling (${same}/${cases.length})`, same === cases.length);
  ck('kg/m³ is kg/m^3, and not kg/m', quantityUnitKey('kg/m³') === quantityUnitKey('kg/m^3') && quantityUnitKey('kg/m³') !== quantityUnitKey('kg/m'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
