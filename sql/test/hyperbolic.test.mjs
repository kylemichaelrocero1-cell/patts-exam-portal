// sql/081: sinh, cosh, tanh, sech, csch and coth are read as typed.
//
// Checks that each spelling the maths field or a phone produces — letters
// (cosh), \operatorname{\mathrm{sech}}, cs\operatorname{\mathrm{ch}},
// arc\sinh, a bare argument (\cosh 7x) — was wrong before 081 and is right
// after, in the database AND the dashboard (answerVerdict, markWorking,
// markAnswer); that trig is still not hyperbolic and wrong answers stay
// wrong; that an item with no hyperbolic function in its key reads letters
// exactly as before (sinh may be sin h); that the SQL and JS twins agree on
// a broad list; that a whole hyperbolic sitting still marks quickly; and
// that 082 re-marks raise-only.
// Look-alike problems only — never a real paper's items.
//
//   npm run test:hyperbolic
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputeEngine } from '@cortex-js/compute-engine';
import { useEngine } from '../../src/lib/mathCheck.js';
import { markAnswer } from '../../src/lib/workedSolution.js';
import { markWorking, answerVerdict } from '../../src/lib/stepMarking.js';
import { respell, normalizeMath, hasHyperbolic, hyperbolicNames } from '../../src/lib/mathNormalize.js';
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

// ── Look-alike keys ─────────────────────────────────────────────────────
const K_SINH = ["y'=35\\cosh(7x)"];
const K_COSH = ["y'=10x^4\\sinh(x^5)"];
const K_TANH = ["y'=54\\operatorname{sech}^2(6x)", "y'=\\frac{54}{\\cosh^2(6x)}"];
const K_SECH = ["y'=-7\\operatorname{sech}(7x)\\tanh(7x)"];
const K_CSCH = ["y'=-5\\operatorname{csch}(5x)\\coth(5x)"];
const K_COTH = ["y'=-4\\operatorname{csch}^2(4x)"];
const K_ARSINH = ['y=\\operatorname{arsinh}(x^5)'];
const K_INV = ['y=\\sinh^{-1}(x^5)'];
const K_LIMIT = ["f'(x)=\\frac{\\sin(h)}{h}"];

const RIGHT = [
  ["y^{\\prime}=35cosh\\left(7x\\right)", K_SINH, 'cosh typed as letters'],
  ["y^{\\prime}=35cosh7x", K_SINH, 'cosh as letters, argument bare'],
  ["y^{\\prime}=35\\cosh 7x", K_SINH, '\\cosh with a bare argument'],
  ["y^{\\prime}=35\\cosh\\left(7x\\right)", K_SINH, 'the field\'s \\cosh, as written'],
  ["y^{\\prime}=10x^4sinh\\left(x^5\\right)", K_COSH, 'sinh as letters'],
  ["y^{\\prime}=10x^4\\sinh x^5", K_COSH, '\\sinh x^5'],
  ["y^{\\prime}=54\\operatorname{\\mathrm{sech}}^2\\left(6x\\right)", K_TANH, 'sech as the field writes it'],
  ["y^{\\prime}=54\\mathrm{sech}^2\\left(6x\\right)", K_TANH, '\\mathrm{sech}'],
  ["y^{\\prime}=54sech^2\\left(6x\\right)", K_TANH, 'sech as letters'],
  ["y^{\\prime}=54sech^26x", K_TANH, 'sech as letters, argument bare'],
  ["y^{\\prime}=54\\operatorname{\\mathrm{sech}}^2 6x", K_TANH, 'the field\'s sech, argument bare'],
  ["y^{\\prime}=-7\\operatorname{\\mathrm{sech}}\\left(7x\\right)\\tanh\\left(7x\\right)", K_SECH, 'sech and \\tanh together'],
  ["y^{\\prime}=-7sech\\left(7x\\right)tanh\\left(7x\\right)", K_SECH, 'sech and tanh both as letters'],
  ["y^{\\prime}=-7sech7xtanh7x", K_SECH, 'sech and tanh as letters, no brackets at all'],
  ["y^{\\prime}=-5cs\\operatorname{\\mathrm{ch}}\\left(5x\\right)\\coth\\left(5x\\right)", K_CSCH, 'csch as the field writes it'],
  ["y^{\\prime}=-5csch\\left(5x\\right)coth\\left(5x\\right)", K_CSCH, 'csch and coth as letters'],
  ["y^{\\prime}=-4csch^2\\left(4x\\right)", K_COTH, 'csch squared as letters'],
  ['y=arc\\sinh\\left(x^5\\right)', K_ARSINH, 'arc\\sinh, as the field writes arcsinh'],
  ['y=arcsinh\\left(x^5\\right)', K_ARSINH, 'arcsinh as letters'],
  ['y=arsinh\\left(x^5\\right)', K_ARSINH, 'arsinh as letters'],
  ['y=\\operatorname{\\mathrm{arsinh}}\\left(x^5\\right)', K_ARSINH, 'the field\'s arsinh'],
  ['y=sinh^{-1}\\left(x^5\\right)', K_INV, 'sinh^{-1} as letters'],
  ['y=\\sinh^{-1}x^5', K_INV, '\\sinh^{-1} with a bare argument'],
];
const WRONG = [
  ["y^{\\prime}=35cos\\left(7x\\right)", K_SINH, 'cos is not cosh'],
  ["y^{\\prime}=35\\cos\\left(7x\\right)", K_SINH, '\\cos is not \\cosh'],
  ["y^{\\prime}=35cosh\\left(5x\\right)", K_SINH, 'a wrong argument stays wrong'],
  ["y^{\\prime}=35sinh\\left(7x\\right)", K_SINH, 'sinh is not cosh'],
  ["y^{\\prime}=54sec^2\\left(6x\\right)", K_TANH, 'sec is not sech'],
  ["y^{\\prime}=54\\operatorname{\\mathrm{sech}}\\left(6x\\right)", K_TANH, 'sech not squared stays wrong'],
  ["y^{\\prime}=-5csc\\left(5x\\right)cot\\left(5x\\right)", K_CSCH, 'csc cot is not csch coth'],
  ['y=arcsin\\left(x^5\\right)', K_ARSINH, 'arcsin is not arsinh'],
  ['y=\\sinh^{-1}\\left(x^5\\right)', K_ARSINH, '\\sinh^{-1} is only taken where the key lists it'],
  ['35\\cosh\\left(7x\\right)', K_SINH, 'no label stays wrong'],
];

const R = { mode: 'lines', steps: [
  { latex: 'y=9\\tanh(6x)', marks: 1 },
  { latex: "y'=9\\operatorname{sech}^2(6x)(6)", marks: 3, accept: ["y'=9(6\\operatorname{sech}^2(6x))"] },
  { latex: K_TANH[0], marks: 5, alone: 3, partial: 4, accept: K_TANH.slice(1) }] };
// A wrong sitting is the slow case: every line fails, so every line is
// respelt against every step. Eleven items of five wrong lines each, timed
// as one submission would mark them.
const timeWrongSittings = async () => {
  const wrong = ['y=9tanh\\left(5x\\right)', 'y^{\\prime}=9sech^2\\left(5x\\right)\\left(5\\right)', 'y^{\\prime}=9sech\\left(6x\\right)',
    'y^{\\prime}=45sech^2\\left(5x\\right)', 'y^{\\prime}=54\\operatorname{\\mathrm{sech}}\\left(6x\\right)\\tanh\\left(6x\\right)'];
  const t0 = performance.now();
  for (let k = 0; k < 11; k++) await q(`SELECT public.mark_working($1::jsonb, $2::jsonb) m`, [JSON.stringify(wrong), JSON.stringify(R)]);
  return performance.now() - t0;
};

console.log('\n=== before 081 ===');
const before = [];
for (const [a, acc] of RIGHT) before.push(await verdict(a, acc));
const wrongBefore = RIGHT.filter((_, k) => before[k] !== null).map(([, , why]) => why);
ck(`${wrongBefore.length} of these ${RIGHT.length} right answers were marked wrong before 081`, wrongBefore.length >= RIGHT.length - 2,
  `right already: ${RIGHT.filter((_, k) => before[k] === null).map(([, , why]) => why).join('; ')}`);
await timeWrongSittings();
const msBefore = await timeWrongSittings();
const limitBefore = await verdict("f'(x)=\\frac{sinh}{h}", K_LIMIT);
ck('before 081, the letters sinh on a limit item read as sin h', limitBefore === null, String(limitBefore));

console.log('\n=== 081 applies ===');
const M081 = fs.readFileSync(P + '/sql/081_hyperbolic_functions_as_typed.sql', 'utf8');
await x(M081); await x(M081);
ck('081 applies, twice', true);
{
  const v = (await q(M081.slice(M081.lastIndexOf('SELECT\n'))))[0];
  const { sittings_with_hyperbolic: n, ...flags } = v;
  ck('081\'s VERIFY row is all true, and counts sittings', Object.values(flags).every(b => b === true) && Number(n) === 0, JSON.stringify(v));
}
ck('math_respell(text) is still there, and reads as before', (await q(`SELECT public.math_respell('6cosh(3x)') r`))[0].r === respell('6cosh(3x)')
  && respell('6cosh(3x)') === '6\\cos(h)(3x)');

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

console.log('\n=== an item with no hyperbolic function reads letters as before ===');
{
  const a = "f'(x)=\\frac{sinh}{h}";
  ck('database: sinh on a limit item is still sin h', (await verdict(a, K_LIMIT)) === null);
  ck('dashboard: the same', answerVerdict(a, K_LIMIT) === null);
  ck('hasHyperbolic sees any spelling, and only those', hasHyperbolic(K_TANH) && hasHyperbolic(['cs\\operatorname{\\mathrm{ch}}(x)'])
    && hasHyperbolic(['y=\\SINH(x)']) && !hasHyperbolic(K_LIMIT) && !hasHyperbolic([]) && !hasHyperbolic(null));
  const sqlHas = async a2 => (await q(`SELECT public.math_has_hyperbolic($1::text[]) h`, [a2]))[0].h;
  ck('math_has_hyperbolic agrees', (await sqlHas(K_TANH)) === true && (await sqlHas(K_LIMIT)) === false
    && (await sqlHas([])) === false && (await sqlHas(null)) === false);
}

console.log('\n=== the twins agree ===');
const CORPUS = [...RIGHT, ...WRONG].flatMap(([a, acc]) => [a, ...acc]).concat([
  '', 'x', 'sinh', 'cosh x', 'tanhx', 'coth(x)', 'sech', 'csch', 'xsinhx', 'sinh/h', '\\frac{sinh}{h}', 'cosec x',
  'arccosh x', 'arcosh(2x)', 'arctanh(x^2)', 'artanh x', 'arccoth x', 'arcsech x', 'arcsch x', 'arcsin x', 'arcsinh',
  'arc\\cosh(x)', 'arc\\tanh x', 'arc\\sin x', 'arc\\sech', '\\arcsinh(x)', '\\arsinh x', '\\operatorname{arcsinh}(x)',
  '\\operatorname{arsinh}(x)', '\\operatorname{\\mathrm{artanh}}(x^2)', '\\mathrm{sech}x', '\\text{sech}(x)',
  '\\operatorname{Sech}(x)', '\\operatorname{SECH}^2 x', 'cs\\operatorname{\\mathrm{ch}}', 'cs\\mathrm{ch}(x)',
  '\\sinh^2 3x', '\\cosh^{2}x', '\\tanh^{-1}3x^2', 'sinh^{-1}(x)', '\\sinh(\\cosh(x))', 'sinh(cosh(x))',
  '\\cos h', '\\cos hx', '\\arccos h', 'e^{x}sinh x', '\\exp(x)cosh(x)', '2\\cdot sinh(x)', 'sinh x.cosh x',
  '\\sinh\\left(x\\right)^2', '\\left(\\sinh x\\right)', 'cosech x', 'shx', 'chx', '\\mathrm{ch}(x)',
]);
let sameR = 0, sameRH = 0, sameN = 0;
for (const s of CORPUS) {
  const r = (await q(`SELECT public.math_respell($1) r, public.math_respell($1, true) h, public.normalize_math($1) n`, [s]))[0];
  if (r.r === respell(s)) sameR++; else console.log(`        respell differs: ${JSON.stringify(s)}\n          sql ${JSON.stringify(r.r)}\n          js  ${JSON.stringify(respell(s))}`);
  const jh = respell(s, { hyperbolic: true });
  if (r.h === jh) sameRH++; else console.log(`        respell(hyperbolic) differs: ${JSON.stringify(s)}\n          sql ${JSON.stringify(r.h)}\n          js  ${JSON.stringify(jh)}`);
  if (r.n === normalizeMath(s)) sameN++; else console.log(`        normalize differs: ${JSON.stringify(s)}\n          sql ${JSON.stringify(r.n)}\n          js  ${JSON.stringify(normalizeMath(s))}`);
}
ck(`math_respell(p) and respell(p) agree on all ${CORPUS.length} strings`, sameR === CORPUS.length, `${sameR}`);
ck(`math_respell(p, true) and respell(p, { hyperbolic }) agree on all ${CORPUS.length}`, sameRH === CORPUS.length, `${sameRH}`);
ck(`normalize_math and normalizeMath agree on all ${CORPUS.length}`, sameN === CORPUS.length, `${sameN}`);
ck('hyperbolicNames: what it does', hyperbolicNames('\\operatorname{\\mathrm{sech}}^2(x)') === '\\sech^2(x)'
  && hyperbolicNames('cs\\operatorname{\\mathrm{ch}}(x)') === '\\csch(x)' && hyperbolicNames('arc\\sinh(x)') === '\\arsinh(x)'
  && hyperbolicNames('\\sinh^{-1}(x)') === '\\sinh^{-1}(x)' && hyperbolicNames('\\sec(x)') === '\\sec(x)');
ck('respell without hyperbolic is byte-for-byte the old reading', respell('8sech^2(2x)') === '8\\sec(h^2)(2x)'
  && respell('\\cosh 3x') === '\\cosh 3x');

console.log('\n=== a full solution ===');
const SITTINGS = [
  [['y=9tanh\\left(6x\\right)', 'y^{\\prime}=9sech^2\\left(6x\\right)\\left(6\\right)', 'y^{\\prime}=54sech^2\\left(6x\\right)'], 5, 'every line in letters'],
  [['y=9\\tanh\\left(6x\\right)', 'y^{\\prime}=9\\operatorname{\\mathrm{sech}}^2\\left(6x\\right)\\cdot6', 'y^{\\prime}=54\\operatorname{\\mathrm{sech}}^2\\left(6x\\right)'], 5, 'as the field writes it'],
  [['y=9\\tanh 6x', 'y^{\\prime}=9\\left(6sech^26x\\right)', 'y^{\\prime}=54sech^26x'], 5, 'bare arguments, mixed spellings'],
  [['y=9tanh\\left(6x\\right)', 'y^{\\prime}=9sec^2\\left(6x\\right)\\left(6\\right)', 'y^{\\prime}=54sec^2\\left(6x\\right)'], 1, 'sec for sech earns only the given line'],
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
  ck(`eleven wrong hyperbolic solutions: ${Math.round(ms)} ms, ${Math.round(msBefore)} ms before 081 (PGlite)`,
    ms < 5000 && ms < msBefore * 2);
}

console.log('\n=== 082 re-marks, raise-only ===');
{
  const M082 = fs.readFileSync(P + '/sql/082_remark_in_batches_after_081.sql', 'utf8');
  const PAPER = '7c2e9d41-5a3b-4c6f-8e10-2b9d4f6a8c13';
  await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,duration_minutes,allow_retakes,show_answers)
           VALUES ('${PAPER}','exam','P 81','MATH 117','${INS}',true,60,true,true);`);
  await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text, question_type, choices, correct_answer, marks,
             work_given, work_variable, work_rubric)
           VALUES ($1,$1,1,'Differentiate, showing your working.','worked_solution','[]'::jsonb,NULL,5,'y=9\\tanh(6x)','x',$2::jsonb)`,
    [PAPER, JSON.stringify(R)]);
  const qid = (await q(`SELECT id FROM public.questions WHERE exam_id = $1`, [PAPER]))[0].id;
  const sit = async lines => {
    await x(`DELETE FROM public.live_sessions WHERE student_id='${STU}'`);
    await q(`INSERT INTO public.live_sessions (student_id, exam_id, assessment_id, student_name, status, work_answers_json)
             VALUES ($1,$2,$2,'S One','active',$3::jsonb)`, [STU, PAPER, JSON.stringify({ [qid]: { lines } })]);
    return (await q(`SELECT public.submit_assessment($1,$2,'{}'::jsonb,60,0,'[]'::jsonb) AS r`, [STU, PAPER]))[0].r;
  };
  const withHyp = (await sit(SITTINGS[0][0])).attempt_no;
  const without = (await sit(['y=x^2'])).attempt_no;
  ck('a sitting submitted after 081 is marked under it', Number((await q(`SELECT work_marks FROM public.review_attempts WHERE attempt_no = $1 AND assessment_id = $2`,
    [withHyp, PAPER]))[0].work_marks) === 5);
  // As they stood before 081: marked 0, before it went live.
  await q(`UPDATE public.review_attempts SET work_marks = 0, work_marked_at = '2000-01-01' WHERE assessment_id = $1`, [PAPER]);
  const left = async () => { const c = (await q(M082.slice(M082.lastIndexOf('SELECT\n'))))[0]; return Number(c.graded_left) + Number(c.practice_left); };
  ck('082 has only the sitting with a hyperbolic function to re-mark', (await left()) === 1, String(await left()));
  await x(M082);
  const marks = Object.fromEntries((await q(`SELECT attempt_no, work_marks FROM public.review_attempts WHERE assessment_id = $1`, [PAPER]))
    .map(r => [r.attempt_no, Number(r.work_marks)]));
  ck('…raises it to 5, and leaves the other alone', marks[withHyp] === 5 && marks[without] === 0 && (await left()) === 0, JSON.stringify(marks));
  // Raise-only: a run in which one would go down changes nothing.
  await q(`UPDATE public.review_attempts SET work_marks = 9, work_marked_at = '2000-01-01' WHERE assessment_id = $1 AND attempt_no = $2`, [PAPER, withHyp]);
  let refused = '';
  try { await x(M082); } catch (e) { refused = e.message; await x('ROLLBACK'); }
  ck('if one would go down, the run is refused', /would go DOWN/i.test(refused), refused);
  ck('…and nothing in it is changed', Number((await q(`SELECT work_marks FROM public.review_attempts WHERE assessment_id = $1 AND attempt_no = $2`,
    [PAPER, withHyp]))[0].work_marks) === 9);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
