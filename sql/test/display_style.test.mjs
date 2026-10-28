// sql/119: {\displaystyle …} around a typed answer is not part of it.
//
// Checks that wrapped right answers were wrong before 119 and are right
// after, in the database AND the dashboard (answerVerdict, markWorking,
// markAnswer); that wrong ones stay wrong; that the SQL and JS twins agree
// string for string; and that 119 applies twice.
// Look-alike problems only — never a real paper's items.
//
//   npm run test:display-style
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputeEngine } from '@cortex-js/compute-engine';
import { useEngine } from '../../src/lib/mathCheck.js';
import { markAnswer } from '../../src/lib/workedSolution.js';
import { markWorking, answerVerdict } from '../../src/lib/stepMarking.js';
import { normalizeMath, mathAnswersMatch, dropSpaces, unstyle } from '../../src/lib/mathNormalize.js';
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

// ── Look-alike keys ─────────────────────────────────────────────────────
const K_SECH = ["y'=12\\operatorname{sech}^2(4x)"];
const K_FRAC = ["y'=\\frac{3x}{x^2+7}"];
const K_LN = ["y'=\\frac{5}{x}"];

// What a wrapped line looks like as it reaches the marker.
const RIGHT = [
  ["y^{\\prime}={\\displaystyle12\\operatorname{\\mathrm{sech}}^2(4x)}", K_SECH, 'the whole right side wrapped'],
  ["y^{\\prime}={\\displaystyle3\\operatorname{\\mathrm{sech}}^2(4x)(4)}", ["y'=3\\operatorname{sech}^2(4x)(4)"], 'a rule line wrapped'],
  ["{\\displaystyle y^{\\prime}=\\frac{3x}{x^2+7}}", K_FRAC, 'the label inside the wrapper'],
  ["y^{\\prime}=\\frac{{\\displaystyle3x}}{x^2+7}", K_FRAC, 'only the numerator wrapped'],
  ["y^{\\prime}{\\displaystyle=\\frac{5}{x}}", K_LN, 'the wrapper opening before the ='],
  ["y^{\\prime}=\\displaystyle\\frac{5}{x}", K_LN, 'a bare \\displaystyle'],
  ["y^{\\prime}={\\textstyle\\frac{5}{x}}", K_LN, '\\textstyle'],
  ["y^{\\prime}={ \\displaystyle {\\displaystyle \\frac{5}{x}}}", K_LN, 'two wrappers, one in the other'],
];
const WRONG = [
  ["y^{\\prime}={\\displaystyle8\\operatorname{\\mathrm{sech}}^2(4x)}", K_SECH, 'a wrong number stays wrong'],
  ["y^{\\prime}={\\displaystyle\\frac{3x}{x^2+5}}", K_FRAC, 'a wrong denominator stays wrong'],
  ["{\\displaystyle\\frac{5}{x}}", K_LN, 'no label stays wrong'],
  ["y^{\\prime}={\\displaystyle\\frac{5}{x}", K_LN, 'an unclosed wrapper is not taken apart'],
];
const R = { mode: 'lines', steps: [
  { latex: 'y=3\\tanh(4x)', marks: 1 },
  { latex: "y'=3\\operatorname{sech}^2(4x)(4)", marks: 3 },
  { latex: "y'=12\\operatorname{sech}^2(4x)", marks: 5 }] };
const WRAPPED = ['y=3\\tanh\\left(4x\\right)', "y^{\\prime}={\\displaystyle3\\operatorname{\\mathrm{sech}}^2(4x)(4)}",
  "y^{\\prime}={\\displaystyle12\\operatorname{\\mathrm{sech}}^2(4x)}"];
const markDb = async lines => Number((await q(`SELECT public.mark_working($1::jsonb, $2::jsonb) m`, [JSON.stringify(lines), JSON.stringify(R)]))[0].m.marks);

console.log('\n=== before 119 ===');
{
  const before = [];
  for (const [a, acc] of RIGHT) before.push(await verdict(a, acc));
  const wrongBefore = before.filter(v => v !== null).length;
  ck(`wrapped right answers were marked wrong before 119 (${wrongBefore} of ${RIGHT.length})`, wrongBefore >= 6);
  const m = await markDb(WRAPPED);
  ck(`a wrapped full solution earned ${m} of 5 before 119`, m < 5);
}

console.log('\n=== 119 applies ===');
const M119 = fs.readFileSync(P + '/sql/119_display_style_is_not_part_of_an_answer.sql', 'utf8');
await x(M119); await x(M119);
ck('119 applies, twice', true);
{
  const v = (await q(M119.slice(M119.lastIndexOf('SELECT public.math_unstyle'))))[0];
  ck('119\'s VERIFY row is all true', Object.values(v).every(b => b === true), JSON.stringify(v));
}

console.log('\n=== right answers, wrapped ===');
for (const [a, acc, why] of RIGHT) {
  const d = await verdict(a, acc), j = answerVerdict(a, acc);
  ck(`database: ${why}`, d === null, String(d));
  ck(`dashboard: ${why}`, j === null, String(j));
}
console.log('\n=== wrong answers stay wrong ===');
for (const [a, acc, why] of WRONG) {
  const d = await verdict(a, acc), j = answerVerdict(a, acc);
  ck(`database: ${why}`, d !== null, String(d));
  ck(`dashboard: ${why}`, j !== null, String(j));
}

console.log('\n=== a full solution, wrapped ===');
{
  const d = await markDb(WRAPPED);
  ck('database: 5 of 5', d === 5, String(d));
  ck('dashboard: 5 of 5', markWorking(WRAPPED, R).marks === 5 && markAnswer(WRAPPED, R).marks === 5,
    `${markWorking(WRAPPED, R).marks} / ${markAnswer(WRAPPED, R).marks}`);
}

console.log('\n=== the twins agree ===');
const CORPUS = [...RIGHT, ...WRONG].map(([a]) => a).concat([
  '\\displaystyle', '{\\displaystyle}', '{\\displaystyle x', 'x}', '\\textstyleless{x}', '{\\scriptstyle x}^2',
  '\\frac{\\displaystyle1}{x}', '{\\scriptscriptstyle\\frac{1}{2}}', 'y=x^2', 'f^{\\prime}\\left(x\\right)=6x',
  '\\lim_{h\\rightarrow0}\\frac{(x+h)^2-x^2}{h}', 'a\\,b\;c\\quad d', '^{x+1}', 'x^{}_{}', 'astyle{x}',
]);
let sameD = 0, sameN = 0, sameU = 0;
for (const s of CORPUS) {
  const r = (await q(`SELECT public.math_drop_spaces($1) d, public.normalize_math($1) n, public.math_unstyle($1) u`, [s]))[0];
  if (r.d === dropSpaces(s)) sameD++; else console.log(`        drop_spaces differs: ${JSON.stringify(s)}\n          sql ${JSON.stringify(r.d)}\n          js  ${JSON.stringify(dropSpaces(s))}`);
  if (r.n === normalizeMath(s)) sameN++; else console.log(`        normalize differs: ${JSON.stringify(s)}\n          sql ${JSON.stringify(r.n)}\n          js  ${JSON.stringify(normalizeMath(s))}`);
  if (r.u === unstyle(s)) sameU++; else console.log(`        unstyle differs: ${JSON.stringify(s)}\n          sql ${JSON.stringify(r.u)}\n          js  ${JSON.stringify(unstyle(s))}`);
}
ck(`math_drop_spaces and dropSpaces agree on all ${CORPUS.length}`, sameD === CORPUS.length, `${sameD}`);
ck(`normalize_math and normalizeMath agree on all ${CORPUS.length}`, sameN === CORPUS.length, `${sameN}`);
ck(`math_unstyle and unstyle agree on all ${CORPUS.length}`, sameU === CORPUS.length, `${sameU}`);
for (const [a, b] of [[RIGHT[0][0], K_SECH[0]], [WRONG[0][0], K_SECH[0]], [RIGHT[2][0], K_FRAC[0]]]) {
  const d = (await q(`SELECT public.math_answers_match($1, $2) m`, [a, b]))[0].m;
  ck(`math_answers_match agrees with mathAnswersMatch: ${a.slice(0, 40)}`, d === mathAnswersMatch(a, b), `${d} / ${mathAnswersMatch(a, b)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
