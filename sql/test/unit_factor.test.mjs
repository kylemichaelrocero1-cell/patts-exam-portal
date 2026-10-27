// sql/101: a factor of one, (1), is nothing — the rule written out in full
// leaves one (d/dx ln x is (1/x)(1)), and a working line holding it was
// "not a step". Checks right answers were wrong before 101 and right after,
// in the database AND the dashboard; that \\ln(1), a +(1) term, (1) over a
// number and 2(1)3 are untouched; that every pair equal before is equal
// after; that the twins agree; and that 102 re-marks raise-only.
// Look-alike problems only — never a real paper's items.
//
//   npm run test:unit-factor
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputeEngine } from '@cortex-js/compute-engine';
import { useEngine } from '../../src/lib/mathCheck.js';
import { markAnswer } from '../../src/lib/workedSolution.js';
import { markWorking, answerVerdict } from '../../src/lib/stepMarking.js';
import { normalizeMath, unbracket, unbracketSigns, respell } from '../../src/lib/mathNormalize.js';
useEngine(new ComputeEngine());
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
  '097_plain_text_answers_and_regrouped_brackets']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}


const K_LOG = ["y'=x^{3x}(\\frac{3x}{x}+\\ln(x)\\cdot3)", "y'=x^{3x}(3\\ln(x)+3)"];
const K_COS = ["y'=7\\cos(7x)"];
const RIGHT = [
  ["y^{\\prime}=x^{3x}\\left(\\frac{3x}{x}\\left(1\\right)+\\ln x\\left(3\\right)\\right)", K_LOG, 'the rule written out with its (1)'],
  ["y^{\\prime}=7\\left(1\\right)\\cos\\left(7x\\right)", K_COS, '(1) after a number'],
  ["y^{\\prime}=\\left(1\\right)\\left(7\\right)\\cos\\left(7x\\right)", K_COS, '(1) first'],
  ["y^{\\prime}=7\\cos\\left(7x\\right)\\left(1\\right)", K_COS, '(1) last'],
  ["y^{\\prime}=7\\cdot1\\cdot\\cos\\left(7x\\right)", K_COS, '\\cdot 1 between factors'],
];
const WRONG = [
  ["y^{\\prime}=7\\left(1\\right)\\cos\\left(5x\\right)", K_COS, 'a wrong argument stays wrong'],
  ["y^{\\prime}=7\\cos\\left(7x\\right)+\\left(1\\right)", K_COS, 'a +(1) term is a term'],
  ["y^{\\prime}=\\frac{\\left(1\\right)}{7}\\cos\\left(7x\\right)", K_COS, '(1) over 7 is a seventh'],
  ["y^{\\prime}=7\\ln\\left(1\\right)\\cos\\left(7x\\right)", K_COS, '\\ln(1) is not dropped'],
  ["y^{\\prime}=2\\left(1\\right)3\\cos\\left(7x\\right)", ["y'=23\\cos(7x)"], '2(1)3 is not 23'],
  ["y^{\\prime}=7\\cdot12\\cos\\left(7x\\right)", K_COS, '\\cdot 12 is twelve'],
  ["y^{\\prime}=7\\cos\\left(7x\\right)\\cdot1/x", K_COS, '\\cdot 1/x is not dropped'],
  ["y'=x^{3x}(\\frac{3x}{x}\\cdot1+\\ln(x)\\cdot3)", ["y'=x^{3x}(\\frac{3x}{x}+\\ln(x)\\cdot3)"], 'a \\cdot 1 after a fraction is as before: a key may use it to mark its working line'],
  ["7\\left(1\\right)\\cos\\left(7x\\right)", K_COS, 'no label stays wrong'],
];

console.log('\n=== before 101 ===');
const before = [];
for (const [a, acc] of RIGHT) before.push(await verdict(a, acc));
ck(`all ${RIGHT.length} right answers were wrong before 101 (the \\cdot 1 one aside)`,
  before.filter(v => v !== null).length >= RIGHT.length - 1, JSON.stringify(before));
const PAIRS = [...RIGHT, ...WRONG].flatMap(([a, acc]) => acc.map(k => [a, k])).concat([
  ['3(2x)', '6x'], ['x(\\sin(x))', 'x\\sin(x)'], ['(4)(x^2)', '4x^2'], ['3(2^{x}\\ln(2))', '3\\cdot2^{x}\\cdot\\ln(2)'],
  ['\\ln(1)', '0'], ['x+(1)', 'x+1'], ['2(1)3', '2\\cdot3'], ['(1)^2', '1'], ['5(-x)(1)', '-5x'],
]);
const sameBoth = async (a, b) => (await q(`SELECT public.math_unbracket(public.normalize_math($1)) = public.math_unbracket(public.normalize_math($2)) e,
  public.math_unbracket_signs(public.normalize_math($1)) = public.math_unbracket_signs(public.normalize_math($2)) s`, [a, b]))[0];
const eqBefore = [];
for (const [a, b] of PAIRS) eqBefore.push(await sameBoth(a, b));

console.log('\n=== 101 applies ===');
const M101 = fs.readFileSync(P + '/sql/101_a_factor_of_one_is_nothing.sql', 'utf8');
await x(M101); await x(M101);
ck('101 applies, twice', true);
{
  const v = (await q(M101.slice(M101.lastIndexOf('SELECT\n'))))[0];
  const { sittings_with_a_factor_of_one: n, ...flags } = v;
  ck('101\'s VERIFY row is all true, and counts sittings', Object.values(flags).every(b => b === true) && Number(n) === 0, JSON.stringify(v));
}
console.log('\n=== right answers, as typed ===');
for (const [a, acc, why] of RIGHT) {
  const d = await verdict(a, acc), j = answerVerdict(a, acc);
  ck(`database: right — ${why}`, d === null, `${a} → ${d}`);
  ck(`dashboard: right — ${why}`, j === null, `${a} → ${j}`);
}
console.log('\n=== wrong answers stay wrong ===');
for (const [a, acc, why] of WRONG) {
  const d = await verdict(a, acc), j = answerVerdict(a, acc);
  ck(`database: wrong — ${why}`, d !== null, `${a} → ${d}`);
  ck(`dashboard: wrong — ${why}`, j !== null, `${a} → ${j}`);
}
console.log('\n=== nothing equal before is different now ===');
{
  let kept = 0; const lost = [];
  for (let k = 0; k < PAIRS.length; k++) {
    const now = await sameBoth(...PAIRS[k]);
    if ((!eqBefore[k].e || now.e) && (!eqBefore[k].s || now.s)) kept++; else lost.push(PAIRS[k].join(' ~ '));
  }
  ck(`all ${PAIRS.length} pairs equal before are equal after`, kept === PAIRS.length, lost.join('; '));
}
console.log('\n=== the twins agree ===');
{
  const CORPUS = [...RIGHT, ...WRONG].flatMap(([a, acc]) => [a, ...acc]).map(normalizeMath).concat([
    '(1)', '1', '(1)(1)', '((1))', 'x(1)(1)', '(1)x', '-(1)x', '=(1)', 'y=(1)', '{(1)}', '\\frac{(1)}{x}', '\\frac{x}{(1)}',
    '\\sqrt{(1)}', '\\sin(1)', '\\sin^2(1)', '\\log_3(1)', '\\log_{10}(1)', 'x^(1)', '(1)^x', 'x_(1)', "(1)'", '(1)!',
    '2(1)3', '2(1)x', 'x(1)3', '2.(1)', '(1).5', '3(1)', '(1)3', '3(-1)', '(-1)(1)', 'x(1)+(1)y', '(1)/2', '1/(1)',
    'x^{2x}(\\frac{2x}x(1)+\\ln(x)(2))', '5(-\\sin(x))(1)', '(1)(2^{x}\\ln(2))', '3(1)(2^{x})',
  ]);
  let u = 0, sg = 0;
  for (const s of CORPUS) {
    const r = (await q(`SELECT public.math_unbracket($1) u, public.math_unbracket_signs($1) s`, [s]))[0];
    if (r.u === unbracket(s)) u++; else console.log(`        unbracket differs: ${JSON.stringify(s)} sql ${JSON.stringify(r.u)} js ${JSON.stringify(unbracket(s))}`);
    if (r.s === unbracketSigns(s)) sg++; else console.log(`        signs differs: ${JSON.stringify(s)} sql ${JSON.stringify(r.s)} js ${JSON.stringify(unbracketSigns(s))}`);
  }
  ck(`math_unbracket and unbracket agree on all ${CORPUS.length}`, u === CORPUS.length, String(u));
  const RESPELL = [...RIGHT, ...WRONG].flatMap(([a, acc]) => [a, ...acc]).concat(['x\\cdot1', 'x\\cdot 1', 'x\\times1', '2x\\cdot1/x', '3\\cdot12',
    'x\\cdot1^2', 'x\\cdot1x', 'x\\cdot1.5', 'x\\cdot1_2', '\\frac{2x}{x}\\cdot1+\\ln(x)\\cdot2', '\\cdot1', 'sinh x\\cdot1']);
  let rs = 0, rh = 0;
  for (const t of RESPELL) {
    const r = (await q(`SELECT public.math_respell($1) a, public.math_respell($1, true) b`, [t]))[0];
    if (r.a === respell(t)) rs++; else console.log(`        respell differs: ${JSON.stringify(t)} sql ${JSON.stringify(r.a)} js ${JSON.stringify(respell(t))}`);
    if (r.b === respell(t, { hyperbolic: true })) rh++; else console.log(`        respell(hyp) differs: ${JSON.stringify(t)}`);
  }
  ck(`math_respell and respell agree on all ${RESPELL.length}, both readings`, rs === RESPELL.length && rh === RESPELL.length, `${rs}/${rh}`);
  ck(`math_unbracket_signs and unbracketSigns agree on all ${CORPUS.length}`, sg === CORPUS.length, String(sg));
}
console.log('\n=== a full solution ===');
const R = { mode: 'lines', steps: [
  { latex: 'y=x^{3x}', marks: 1 },
  { latex: "y'=x^{3x}(\\frac{3x}{x}+\\ln(x)\\cdot3)", marks: 3 },
  { latex: "y'=x^{3x}(3\\ln(x)+3)", marks: 5, alone: 3, partial: 4 }] };
const SIT = ['y=x^{3x}', "y^{\\prime}=x^{3x}\\left(\\frac{3x}{x}\\left(1\\right)+\\ln x\\left(3\\right)\\right)", "y^{\\prime}=x^{3x}\\left(3\\ln x+3\\right)"];
{
  const d = (await q(`SELECT public.mark_working($1::jsonb, $2::jsonb) m`, [JSON.stringify(SIT), JSON.stringify(R)]))[0].m;
  ck('database: the screenshot\'s solution is 5', Number(d.marks) === 5, JSON.stringify(d));
  ck('dashboard: the same', markWorking(SIT, R).marks === 5 && markAnswer(SIT, R).marks === 5);
}
console.log('\n=== 102 re-marks, raise-only ===');
{
  const M102 = fs.readFileSync(P + '/sql/102_remark_after_101.sql', 'utf8');
  const INS = 'd24df77e-309a-4ed8-988f-da3ee1c76408', STU = '11111111-1111-1111-1111-111111111111', STU2 = '22222222-2222-2222-2222-222222222222';
  const PAPER = '7c2e9d41-5a3b-4c6f-8e10-2b9d4f6a8101';
  await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
    INSERT INTO public.users (id, full_name, section) VALUES ('${STU}','S One','T'), ('${STU2}','S Two','T');
    INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,duration_minutes,allow_retakes,show_answers)
    VALUES ('${PAPER}','exam','P 101','T','${INS}',false,60,false,true);`);
  await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text, question_type, choices, correct_answer, marks, work_given, work_variable, work_rubric)
           VALUES ($1,$1,1,'Differentiate.','worked_solution','[]'::jsonb,NULL,5,'y=x^{3x}','x',$2::jsonb)`, [PAPER, JSON.stringify(R)]);
  const qid = (await q(`SELECT id FROM public.questions WHERE exam_id = $1`, [PAPER]))[0].id;
  const file = async (sid, lines, marks, reason = 'x') => q(`INSERT INTO public.results (student_id, exam_id, assessment_id, score, total_items, answers_json, work_marks, work_total, work_marked_at)
    VALUES ($1,$2,$2,0,0,$3::jsonb,$4,5,'2000-01-01')`, [sid, PAPER, JSON.stringify({ [qid]: { type: 'worked', lines, marks, of: 5, reason } }), marks]);
  await file(STU, SIT, 4);
  await file(STU2, ['y=x^{3x}', "y^{\\prime}=x^{3x}\\left(1\\right)"], 1);
  const left = async () => { const c = (await q(M102.slice(M102.lastIndexOf('SELECT\n'))))[0]; return Number(c.graded_left) + Number(c.practice_left); };
  ck('102 sees the two sittings with a (1)', (await left()) === 2, String(await left()));
  await x(M102);
  const m = Object.fromEntries((await q(`SELECT student_id, work_marks FROM public.results WHERE assessment_id = $1`, [PAPER])).map(r => [r.student_id, Number(r.work_marks)]));
  ck('…raises the right ones 4 → 5, leaves the other at 1, and nothing is left', m[STU] === 5 && m[STU2] === 1 && (await left()) === 0, JSON.stringify(m));
  await q(`UPDATE public.results SET work_marks = 9, work_marked_at = '2000-01-01',
           answers_json = jsonb_set(answers_json, ARRAY[$2, 'marks'], '9') WHERE student_id = $1`, [STU, qid]);
  let refused = '';
  try { await x(M102); } catch (e) { refused = e.message; await x('ROLLBACK'); }
  ck('a run where one would go down is refused, and changes nothing', /would go DOWN/i.test(refused)
    && Number((await q(`SELECT work_marks FROM public.results WHERE student_id = $1`, [STU]))[0].work_marks) === 9, refused);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
