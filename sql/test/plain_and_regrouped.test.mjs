// sql/097: answers typed in the plain-text box, a power typed in two goes,
// \log_{_2}, a function name nested deep in text boxes, and a product's
// brackets placed another way, are read as the same answer.
//
// Checks that each was wrong before 097 and is right after, in the database
// AND the dashboard (answerVerdict, markWorking, markAnswer); that wrong
// answers stay wrong (4e^4x, 3^{x}^{2}, \ln3(2x), \sin(x)^2); that every
// pair of lines the marker called equal before 097 it still calls equal;
// that the SQL and JS twins agree string for string on a broad list; that a
// whole sitting still marks quickly; and that 097 applies twice.
// Look-alike problems only — never a real paper's items.
//
//   npm run test:regroup
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputeEngine } from '@cortex-js/compute-engine';
import { useEngine } from '../../src/lib/mathCheck.js';
import { markAnswer } from '../../src/lib/workedSolution.js';
import { markWorking, answerVerdict } from '../../src/lib/stepMarking.js';
import { respell, normalizeMath, unbracket, unbracketSigns } from '../../src/lib/mathNormalize.js';
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
  '081_hyperbolic_functions_as_typed', '083_file_before_marking']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

// ── Look-alike keys ─────────────────────────────────────────────────────
const K_EXP = ["y'=5e^{3x}"];
const K_STEP = ['5e^{3x}'];
const K_FRAC = ["f'(x)=\\frac{3x}{x^2+7}"];
const K_STEPFRAC = ['\\frac{3x}{x^2+7}'];
const K_QUOT = ["y'=\\frac{2-\\ln(x)}{x^3}"];
const K_POW = ["y'=5\\cdot3^{2x}\\cdot\\ln(3)", "y'=5\\ln(3)\\cdot3^{2x}"];
const K_POW2 = ["g'(x)=4x\\ln(7)\\cdot7^{x^2}", "g'(x)=4x(7^{x^2})\\ln(7)"];
const K_ATAN = ['\\frac{1}{4+x^2}'];
const K_LOG = ['y=\\log_3(x^2+5)'];
const K_SECH = ["f'(x)=6\\operatorname{sech}^2(6x-1)"];
const K_TRIG = ["y'=2\\sin^2(x)"];

const RIGHT = [
  ['5e^(3x)', K_STEP, 'a power in round brackets (plain-text box)'],
  ["y' = 5e^(3x)", K_EXP, 'the same, with its label'],
  ["y' = 5 * e^(3x)", K_EXP, 'a star for times'],
  ['(3x)/(x^2 + 7)', K_STEPFRAC, 'a bracket over a bracket'],
  ["f'(x) = (3x) / (x^2 + 7)", K_FRAC, 'the same, spaced, with its label'],
  ["y' = (2 - ln(x))/x^3", K_QUOT, 'a bracket over a power, ln as letters'],
  ["y' = 5 * 3^(2x) * ln(3)", K_POW, 'ln as letters, every factor starred'],
  ["y^{\\prime}=5e^3^{x}", K_EXP, 'a power typed in two goes'],
  ['5e^{3}^{x}', K_STEP, 'the same, braced'],
  ['y=\\log_{_3}\\left(x^2+5\\right)', K_LOG, '\\log_{_3}'],
  ["f^{\\prime}\\left(x\\right)=\\operatorname{\\mathrm{6\\operatorname{\\mathrm{sech}}}}^2\\left(6x-1\\right)", K_SECH, 'the 6 inside the sech box'],
  ["y^{\\prime}=5\\left(3^{2x}\\ln(3)\\right)", K_POW, 'the number then a bracket'],
  ["y^{\\prime}=\\left(5\\right)\\left(3^{2x}\\ln(3)\\right)", K_POW, 'both in brackets'],
  ["y^{\\prime}=5\\cdot\\left(3^{2x}\\ln\\left(3\\right)\\right)", K_POW, 'a times sign then a bracket'],
  ["y^{\\prime}=5\\left(3^{2x}\\right)\\ln3", K_POW, 'the power alone in brackets, ln 3 bare'],
  ["g^{\\prime}\\left(x\\right)=4x\\left(7\\right)^{x^2}\\ln7", K_POW2, 'the base alone in brackets'],
  ['\\frac{1}{4+\\left(x\\right)^2}', K_ATAN, 'x in brackets, squared'],
];
const WRONG = [
  ["y^{\\prime}=5e^3x", K_EXP, '5e^3x: the x is not in the power'],
  ["y^{\\prime}=5e^(3)x", K_EXP, 'e^(3)x is e^3 times x'],
  ['y=3^{x}^{2}', ['y=3^{x^2}'], '3^{x}^{2} is not read as 3^{x^2}'],
  ["y^{\\prime}=\\ln3\\left(2x\\right)", ["y'=\\ln(3)\\cdot2x"], '\\ln3(2x): the 2x could be in the log'],
  ["y^{\\prime}=\\ln3\\left(2x\\right)", ["y'=\\ln 3\\cdot 2x"], '…also against \\ln 3\\cdot 2x'],
  ["g^{\\prime}\\left(x\\right)=4x\\ln7\\left(7^{x^2}\\right)", K_POW2.concat(["g'(x)=4x\\ln 7\\cdot7^{x^2}"]), '\\ln7(7^{x^2}): the same'],
  ["y^{\\prime}=\\sin\\left(x\\right)^2", K_TRIG, '\\sin(x)^2 is as before'],
  ["y^{\\prime}=5\\left(3^{2x}\\ln(3)\\right)", ["y'=5\\cdot3^{2x}"], 'a factor missing stays wrong'],
  ["y^{\\prime}=53^{2x}\\ln(3)", K_POW, '53^{2x} is fifty-three'],
  ['ln(x)/x', ['\\frac{\\ln(x)}{x}'], 'ln(x)/x is not turned into ln of a fraction'],
  ["y' = (2 + ln(x))/x^3", K_QUOT, 'a wrong sign stays wrong'],
  ['5e^(3x)', K_EXP, 'no label stays wrong'],
  ['f(x)=(3x)/(x^2 + 7)', K_FRAC, 'the wrong label stays wrong'],
];

console.log('\n=== before 097 ===');
const before = [];
for (const [a, acc] of RIGHT) before.push(await verdict(a, acc));
ck(`all ${RIGHT.length} right answers were marked wrong before 097`, before.every(v => v !== null),
  RIGHT.filter((_, k) => before[k] === null).map(([, , why]) => why).join('; '));

const R = { mode: 'lines', steps: [
  { latex: 'y=5\\cdot3^{2x}', marks: 1 },
  { latex: "y'=5(3^{2x})\\ln(3)(2)", marks: 3, accept: ["y'=5\\cdot3^{2x}\\cdot\\ln(3)\\cdot2"] },
  { latex: "y'=10\\ln(3)\\cdot3^{2x}", marks: 5, alone: 3, partial: 4, accept: ["y'=10\\cdot3^{2x}\\ln(3)"] }] };
const wrongLines = ['y=5\\cdot3^{3x}', 'y^{\\prime}=5\\left(3^{3x}\\ln(3)\\right)\\left(3\\right)', 'y^{\\prime}=15\\left(3^{3x}\\right)',
  'y^{\\prime}=15\\ln3\\left(3^{3x}\\right)', 'y^{\\prime}=5e^(3x)'];
const timeWrongSittings = async () => {
  const t0 = performance.now();
  for (let k = 0; k < 11; k++) await q(`SELECT public.mark_working($1::jsonb, $2::jsonb) m`, [JSON.stringify(wrongLines), JSON.stringify(R)]);
  return performance.now() - t0;
};
await timeWrongSittings();
const msBefore = await timeWrongSittings();

// Every pair the marker called equal before must stay equal.
const PAIRS_SRC = [...RIGHT, ...WRONG].flatMap(([a, acc]) => acc.map(k => [a, k])).concat([
  ['3(2x)', '6x'], ['x(\\sin(x))', 'x\\sin(x)'], ['(4)(x^2)', '4x^2'], ['2(3)', '2\\cdot3'],
  ['(x+1)^2', 'x+1^2'], ['\\sin(x)^2', '\\sin^2(x)'], ['3(2)^{x}', '3\\cdot2^{x}'], ['(x^2)3', '3x^2'],
]);
const eqBefore = [];
for (const [a, b] of PAIRS_SRC) {
  eqBefore.push((await q(`SELECT public.math_unbracket(public.normalize_math($1)) = public.math_unbracket(public.normalize_math($2)) e,
    public.math_unbracket_signs(public.normalize_math($1)) = public.math_unbracket_signs(public.normalize_math($2)) s`, [a, b]))[0]);
}

console.log('\n=== 097 applies ===');
const M097 = fs.readFileSync(P + '/sql/097_plain_text_answers_and_regrouped_brackets.sql', 'utf8');
await x(M097); await x(M097);
ck('097 applies, twice', true);
{
  const v = (await q(M097.slice(M097.lastIndexOf('SELECT\n'))))[0];
  const { sittings_typed_these_ways: n, ...flags } = v;
  ck('097\'s VERIFY row is all true, and counts sittings', Object.values(flags).every(b => b === true) && Number(n) === 0, JSON.stringify(v));
}
ck('math_respell(text) still reads with no hyperbolic names', (await q(`SELECT public.math_respell('6cosh(3x)') r`))[0].r === '6\\cos(h)(3x)');

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
  let kept = 0, lost = [];
  for (let k = 0; k < PAIRS_SRC.length; k++) {
    const [a, b] = PAIRS_SRC[k];
    const now = (await q(`SELECT public.math_unbracket(public.normalize_math($1)) = public.math_unbracket(public.normalize_math($2)) e,
      public.math_unbracket_signs(public.normalize_math($1)) = public.math_unbracket_signs(public.normalize_math($2)) s`, [a, b]))[0];
    if ((!eqBefore[k].e || now.e) && (!eqBefore[k].s || now.s)) kept++; else lost.push(`${a} ~ ${b}`);
  }
  ck(`all ${PAIRS_SRC.length} pairs equal before are equal after`, kept === PAIRS_SRC.length, lost.join('; '));
  ck('3(2)^{x} still keeps its bracket: not 32^{x}', unbracket(normalizeMath('3(2)^{x}')) === '3(2)^x');
  ck('(x^2)3 is not regrouped through its power', unbracket(normalizeMath('(x^2)3')) === '(x^2)3');
}

console.log('\n=== the twins agree ===');
const CORPUS = [...RIGHT, ...WRONG].flatMap(([a, acc]) => [a, ...acc]).concat([
  '', 'x', '^(', 'e^(', 'e^(x', 'e^()', 'e^(2x)^(3)', 'e^(e^(x))', '2^(x+1)', 'x^(1/x)', '(1/x)', '/', '/x', '(x)/', ')/(',
  '(a)/(b)/(c)', '(a)/b/c', '2(x+1)/x', '(x+1) / 2.5x^2', '(x+1)/ (x-1)', '\\sin (x)/x', '\\sin^{2}(x)/x', 'e^{x}(x-2)/x^3',
  'x(x+1)/2', '((x))/x', '(x)/(y)/(z)', '3 * 2^(3x) * ln(2)', 'e^x sin(x) + e^x cos(x)', 'x^x (ln(x) + 1)',
  'ln x', 'lnx', 'ln(x)', 'xln(x)', 'ln3(2x)', 'ln 3', 'log_2(x)', 'log x', 'logx^2', 'kiln', 'lnln x', '\\ln x', 'ln^2 x', 'al n',
  'e^4^{x}', 'e^{4}^{x}', 'e^4^{\\sin x}', 'e^x^{2}', 'e^{x}^{2}', '2^3^{x}', '2^{34}^{x}', 'x^2^3',
  '\\log_{_2}(x)', '\\log_{^2}x', 'x_{_1}', '{_}', '{^{2}}', '\\frac{_{3}}{x}', '{_\\alpha}',
  '\\text{\\mathrm{\\operatorname{\\textrm{\\mathit{x}}}}}', '\\operatorname{\\mathrm{4\\operatorname{\\mathrm{sech}}}}^2(x)',
]);
const UCORPUS = CORPUS.map(normalizeMath).concat([
  '3(2^{3x}\\ln(2))', '3(2^{3x})\\ln(2)', '3(2)^{3x}\\ln(2)', '(5)^x', '2(5)^x', '2.(5)^x', '2x(5)^{x^2}', '(x)^2', 'x(y)^2',
  '\\sin(x)^2', '\\sin^2(x)^2', 'a_(x)^2', 'a^(x)^2', "a'(x)^2", '/(x)^2', '(2x)^2', '(-x)^2', '(x^2)^3', '(12)^x', '(1.5)^x',
  '3(2x3)4', '3(x^2)4', '3(x_2)4', '(2.5x)7', '3(2.5x)', '3(2+x)', '3(-2x)', '3(2)', '3(2)(4)', '(3)(2x)', '3((2x))',
  '3(\\sin(2x))', '3(2\\sin(x))', '3(2)!', '3(2x)!', '3(2x)/4', '3(2x)^2', '3(2x)_1', "3(2x)'", '5(-3(2x))', '-(3(2x))',
  '\\ln3(2x)', '\\ln3(2)x', '\\ln5(5^{x})', '\\ln3(x)^2', '\\sin2(3x)', '\\ln^{2}3(2x)', '\\ln3.5(2x)', 'x\\ln(3)(2x)',
  '\\frac{1}{(x)^2}', '\\sqrt{(x)^2}', '5(3^{2x}\\ln(3))(2)', '(4)(3^{x^2}\\ln(3))(2x)', '4(3^{x^2}\\ln(3)(2x))',
]);
let sameR = 0, sameRH = 0, sameN = 0, sameU = 0, sameS = 0;
for (const s of CORPUS) {
  const r = (await q(`SELECT public.math_respell($1) r, public.math_respell($1, true) h, public.normalize_math($1) n`, [s]))[0];
  if (r.r === respell(s)) sameR++; else console.log(`        respell differs: ${JSON.stringify(s)}\n          sql ${JSON.stringify(r.r)}\n          js  ${JSON.stringify(respell(s))}`);
  const jh = respell(s, { hyperbolic: true });
  if (r.h === jh) sameRH++; else console.log(`        respell(hyperbolic) differs: ${JSON.stringify(s)}\n          sql ${JSON.stringify(r.h)}\n          js  ${JSON.stringify(jh)}`);
  if (r.n === normalizeMath(s)) sameN++; else console.log(`        normalize differs: ${JSON.stringify(s)}`);
}
for (const s of UCORPUS) {
  const r = (await q(`SELECT public.math_unbracket($1) u, public.math_unbracket_signs($1) s`, [s]))[0];
  if (r.u === unbracket(s)) sameU++; else console.log(`        unbracket differs: ${JSON.stringify(s)}\n          sql ${JSON.stringify(r.u)}\n          js  ${JSON.stringify(unbracket(s))}`);
  if (r.s === unbracketSigns(s)) sameS++; else console.log(`        unbracket_signs differs: ${JSON.stringify(s)}\n          sql ${JSON.stringify(r.s)}\n          js  ${JSON.stringify(unbracketSigns(s))}`);
}
ck(`math_respell(p) and respell(p) agree on all ${CORPUS.length} strings`, sameR === CORPUS.length, `${sameR}`);
ck(`math_respell(p, true) and respell(p, { hyperbolic }) agree on all ${CORPUS.length}`, sameRH === CORPUS.length, `${sameRH}`);
ck(`normalize_math and normalizeMath agree on all ${CORPUS.length}`, sameN === CORPUS.length, `${sameN}`);
ck(`math_unbracket and unbracket agree on all ${UCORPUS.length}`, sameU === UCORPUS.length, `${sameU}`);
ck(`math_unbracket_signs and unbracketSigns agree on all ${UCORPUS.length}`, sameS === UCORPUS.length, `${sameS}`);

console.log('\n=== a full solution ===');
const SITTINGS = [
  [['y=5\\cdot3^{2x}', 'y^{\\prime}=5\\left(3^{2x}\\ln(3)\\right)\\left(2\\right)', 'y^{\\prime}=10\\ln(3)\\cdot3^{2x}'], 5, 'the rule line bracketed another way'],
  [['y = 5 * 3^(2x)', "y' = 5 * 3^(2x) * ln(3) * 2", "y' = 10 * 3^(2x) * ln(3)"], 5, 'every line in the plain-text box'],
  [['y=5\\cdot3^2^{x}', 'y^{\\prime}=5\\cdot3^2^{x}\\cdot\\ln(3)\\cdot2', 'y^{\\prime}=10\\ln(3)\\cdot3^2^{x}'], 5, 'every power typed in two goes'],
  [['y=5\\cdot3^{2x}', 'y^{\\prime}=10\\ln(3)\\cdot3^{2x}'], 4, 'the rule line left out is still 4'],
  [['y=5\\cdot3^{2x}', 'y^{\\prime}=10\\ln3\\left(3^{2x}\\right)'], 1, 'ln3(…) at the end is still not read'],
];
for (const [lines, want, why] of SITTINGS) {
  const d = (await q(`SELECT public.mark_working($1::jsonb, $2::jsonb) m`, [JSON.stringify(lines), JSON.stringify(R)]))[0].m;
  ck(`database: ${why} — ${want}`, Number(d.marks) === want, JSON.stringify(d));
  ck(`dashboard: ${why} — ${want}`, markWorking(lines, R).marks === want && markAnswer(lines, R).marks === want,
    `${markWorking(lines, R).marks} / ${markAnswer(lines, R).marks}`);
}

console.log('\n=== still fast ===');
{
  const ms = await timeWrongSittings();
  ck(`eleven wrong solutions: ${Math.round(ms)} ms, ${Math.round(msBefore)} ms before 097 (PGlite)`,
    ms < 5000 && ms < msBefore * 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
