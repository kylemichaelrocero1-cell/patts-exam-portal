// sql/050: an answer typed the way a phone keyboard spells it is the same
// answer — function names as plain letters (7sin(7x)), a line in \text{},
// the label inside a superscript, \operatorname{cosec}, a full stop for a
// times sign, \cdot-, \cos x beside \cos(x), a bracket filling a whole root
// or numerator, a bracket left open — and normalize_math() no longer
// strips a first and last bracket that are not a pair.
//
// Checks that each was wrong before 050 and is right after, in the database
// AND the dashboard (markAnswer, markWorking); that wrong answers, missing
// labels and decimals are untouched; that math_respell() and respell(),
// normalize_math() and normalizeMath() agree on a broad list; and that 050
// re-marks submitted attempts raise-only, skipping any marked by hand.
// Look-alike problems only — never a real paper's items.
//
//   npm run test:spellings
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputeEngine } from '@cortex-js/compute-engine';
import { useEngine } from '../../src/lib/mathCheck.js';
import { markAnswer } from '../../src/lib/workedSolution.js';
import { markWorking, answerVerdict } from '../../src/lib/stepMarking.js';
import { respell, normalizeMath, unbracketSigns } from '../../src/lib/mathNormalize.js';
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
  '046_answers_typed_as_words']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

// ── Look-alike keys ─────────────────────────────────────────────────────
const K_SIN = ["y'=7\\sin(7x)", "y'=7\\sin 7x"];
const K_FRAC = ["y'=\\frac{\\sin(x)}{1+\\cos^2(x)}"];
const K_ROOT = ["y'=\\frac{4}{\\sqrt{1-16x^2}}"];
const K_ATAN = ["y'=\\frac{4}{1+16x^2}"];
const K_CSC = ["y'=-7\\csc(7x)\\cot(7x)"];
const K_ARC = ["y'=\\arcsin(x)+\\frac{x}{\\sqrt{1-x^2}}"];
const K_OUTER = ["g'(x)=3x\\sin(x^3)"];
const K_DEC = ["y'=0.5\\cos(0.5x)"];
const K_SQ = ["y=(\\sin(x))^2"];

// [student line, accepted, why] — wrong before 050, right after.
const RIGHT = [
  ['y^{\\prime}=7sin\\left(7x\\right)', K_SIN, 'the function name typed as letters'],
  ["\\text{y'=7sin(7x)}", K_SIN, 'the whole line in a text box'],
  ['^{y^{\\prime}}=7\\sin\\left(7x\\right)', K_SIN, 'the label typed inside a superscript'],
  ['^{y^{\\prime}=}7sin\\left(7x\\right)', K_SIN, 'the label and = inside a superscript'],
  ['y^{\\prime}=7\\operatorname{\\mathrm{sin}}7x', K_SIN, '\\operatorname{\\mathrm{sin}}'],
  ['y^{\\prime}=\\frac{\\sin x}{1+\\cos^2\\left(x\\right)}', K_FRAC, '\\sin x and \\cos^2(x) mixed'],
  ['y^{\\prime}=\\frac{sinx}{1+cos^2x}', K_FRAC, 'letters, and no brackets at all'],
  ['y^{\\prime}=\\frac{\\sin\\left(x\\right)}{\\left(1+\\cos^2\\left(x\\right)\\right)}', K_FRAC, 'a bracket filling the whole denominator, brackets inside'],
  ['y^{\\prime}=\\frac{4}{\\sqrt{\\left(1-16x^2\\right)}}', K_ROOT, 'a bracket filling the whole root'],
  ['y^{\\prime}=\\frac{4}{_{\\sqrt{1-16x^2}}}', K_ROOT, 'a subscript with nothing under it'],
  ['y^{\\prime}=\\frac{4}{1+16x^{^2}}', K_ATAN, 'a power typed inside a power'],
  ['y^{\\prime}=-7\\operatorname{\\mathrm{cosec}}7x\\cot7x', K_CSC, 'cosec, and arguments without brackets'],
  ['y^{\\prime}=-7csc\\left(7x\\right)cot\\left(7x\\right)', K_CSC, 'two names typed as letters'],
  ['y^{\\prime}=arc\\sin\\left(x\\right)+\\frac{x}{\\sqrt{1-x^2}}', K_ARC, 'arc typed before \\sin'],
  ['y^{\\prime}=arcsin\\left(x\\right)+\\frac{x}{\\sqrt{1-x^2}}', K_ARC, 'arcsin typed as letters'],
  ['g^{\\prime}\\left(x\\right)=\\left(3x\\right)\\sin\\left(x^3\\right)', K_OUTER, 'a first and last bracket that are not a pair (s11)'],
  ['y^{\\prime}=-7csc\\left(7x\\right)\\ast cot\\left(7x\\right)', K_CSC, '\\ast for a times sign (058)'],
  ['y^{\\prime}=0.5cos\\left(0.5x\\right)', K_DEC, 'letters beside a decimal'],
];
// [student line, accepted, why] — wrong before AND after.
const WRONG = [
  ['y^{\\prime}=7sin\\left(5x\\right)', K_SIN, 'letters, wrong argument'],
  ['y^{\\prime}=7\\sin x', K_SIN, 'the argument\'s 7 missing'],
  ['y^{\\prime}=05\\cos\\left(05x\\right)', K_DEC, 'a decimal point is not a times sign (0.5 is not 0·5)'],
  ['y=\\sin x^2', K_SQ, '\\sin x^2 is \\sin(x^2), not (\\sin x)^2'],
  ['y^{\\prime}=-7\\csc\\cdot\\cot\\left(7x\\right)', K_CSC, 'a function with no argument'],
  ['y^{\\prime}7sin\\left(7x\\right)', K_SIN, 'no = after the label'],
];

console.log('=== before 050 ===');
for (const [a, acc, why] of RIGHT) ck(`wrong before: ${why}`, (await verdict(a, acc)) !== null);

const M050 = fs.readFileSync(P + '/sql/050_answers_as_the_keyboard_spells_them.sql', 'utf8');
await x(M050);
await x(M050);
ck('050 applies, twice', true);
{
  const v = (await q(M050.slice(M050.lastIndexOf('SELECT\n'))))[0];
  ck('its VERIFY row is all true', Object.values(v).every(b => b === true), JSON.stringify(v));
}
// What is live: 053 switched 050's third look off, 058 brought it back
// respelling only the student's line (and reading \ast as a times sign).
await x(fs.readFileSync(P + '/sql/053_marking_fast_again.sql', 'utf8'));
const M058 = fs.readFileSync(P + '/sql/058_keyboard_spellings_fast.sql', 'utf8');
await x(M058);
await x(M058);
ck('053 then 058 apply, 058 twice', true);
{
  const v = (await q(M058.slice(M058.lastIndexOf('SELECT\n'))))[0];
  ck('058\'s VERIFY row is all true', Object.values(v).every(b => b === true), JSON.stringify(v));
}

console.log('\n=== after 050: right, in the database and the dashboard ===');
for (const [a, acc, why] of RIGHT) {
  ck(`database: ${why}`, (await verdict(a, acc)) === null, `${a} → ${await verdict(a, acc)}`);
  ck(`dashboard: ${why}`, answerVerdict(a, acc) === null
    && markAnswer([a], { steps: [{ latex: acc[0], marks: 2 }], accept: acc.slice(1) }).marks === 2, respell(a));
}

console.log('\n=== still wrong ===');
for (const [a, acc, why] of WRONG) {
  ck(`database: ${why}`, (await verdict(a, acc)) !== null);
  ck(`dashboard: ${why}`, answerVerdict(a, acc) !== null);
}
{
  const v = await verdict('7sin\\left(7x\\right)', K_SIN);
  ck('no label is still judged, on the respelt line', /^Right value, but no label/.test(v ?? ''), v);
  ck('…and the dashboard says the same', answerVerdict('7sin\\left(7x\\right)', K_SIN) === v);
  const w = await verdict('\\text{y=7sin(7x)}', K_SIN);
  ck('a wrong label inside a text box is still a wrong label', /^Right value, but the wrong label/.test(w ?? ''), w);
  ck('…and the dashboard says the same', answerVerdict('\\text{y=7sin(7x)}', K_SIN) === w);
}

console.log('\n=== math_respell() and respell(), normalize_math() and normalizeMath() agree ===');
const CORPUS = [...RIGHT, ...WRONG].flatMap(([a, acc]) => [a, ...acc]).concat([
  '', 'x', '\\cosec x', 'arc\\tan x', 'arc\\tangent', '\\left.x\\right|', '1.5x', 'x.5', '.5x', '=.5', '5x.',
  'a\\times-b+c', '\\cdot -\\frac{1}{2}x', '2\\cdot-\\left(x+1\\right)\\cdot3', '\\sqrt{ (x+1) }', '{(a)(b)}', '(a)(b)',
  '((a)', '(a))', '\\text{cost}', '\\mathrm{d}x', '\\ln x^2', '\\log 10', '\\log 10x', '\\sin^{-1}3x^2',
  '\\cos^22x', '\\cos^{2} x', '\\sin\\left(x\\right)^2', '\\sin 2\\pi', '\\cos\\theta', 'cos\\theta', 'xcosx',
  '\\cdots', '\\sin', 'sin', 'y=sin', '\\frac{\\left(a+b\\right)}{c}', '\\frac{(a)(b)}{c}', '{^{2}}', 'x^{^{2}}',
  '\\placeholder{}x', '^{}y=3', '  ^{y}=x', '\\operatorname{arctan}x', '\\mathrm{sec}^2 x', 'u\\text{\'=5}',
  '\\textasciicircum', '\\text{a\\textasciicircum\\textbraceleft 2\\textbraceright}', 'sinh x', 'cosecant',
  '\\left(\\csc x\\left(\\csc^2x\\right)\\right.', '3\\left(x\\right))\\left(2\\right.\\right)', '(3x)\\sin(x^3+2)',
  '(x+1)', '(x+1)(x-1)', '((x+1)(x-1))', 'y\'=(6x)(\\tan(x)(\\sec(x)))', '\\frac{-\\left(x\\right)}{2}',
]);
let same = 0, sameN = 0;
for (const s of CORPUS) {
  const r = (await q(`SELECT public.math_respell($1) r, public.normalize_math($1) n`, [s]))[0];
  if (r.r === respell(s)) same++; else console.log(`        respell differs: ${JSON.stringify(s)}\n          sql ${JSON.stringify(r.r)}\n          js  ${JSON.stringify(respell(s))}`);
  if (r.n === normalizeMath(s)) sameN++; else console.log(`        normalize differs: ${JSON.stringify(s)} sql ${r.n} js ${normalizeMath(s)}`);
}
ck(`respell agrees on all ${CORPUS.length} strings`, same === CORPUS.length, `${same}`);
ck(`normalize agrees on all ${CORPUS.length} strings`, sameN === CORPUS.length, `${sameN}`);
ck('a decimal stays a decimal', respell('0.5x') === '0.5x' && respell('=.5') === '=.5');
ck('\\cdots is not a \\cdot', respell('a\\cdots b') === 'a\\cdots b');
ck('a whole bracket pair is still stripped (s11)', normalizeMath('(x+1)') === 'x+1' && normalizeMath('(x+1)(x-1)') === '(x+1)(x-1)');

console.log('\n=== a full solution, marked line by line ===');
const RUBRIC = { mode: 'lines', steps: [
  { label: 'The function', latex: 'y=\\cos^2(x^3)', marks: 1, accept: ['y=(\\cos(x^3))^2'] },
  { label: 'Not simplified', latex: "y'=2\\cos(x^3)(-\\sin(x^3))(3x^2)", marks: 3 },
  { label: 'Simplified', latex: "y'=-6x^2\\cos(x^3)\\sin(x^3)", marks: 5, alone: 3, partial: 4 },
] };
const LETTERS = ['y=cos^2\\left(x^3\\right)', 'y^{\\prime}=2cos\\left(x^3\\right)\\left(-sin\\left(x^3\\right)\\right)\\left(3x^2\\right)',
  'y^{\\prime}=-6x^2cos\\left(x^3\\right)sin\\left(x^3\\right)'];
const DOTS = ['y=\\cos^2\\left(x^3\\right)', 'y^{\\prime}=2\\cos\\left(x^3\\right).\\left(-\\sin\\left(x^3\\right)\\right).3x^2',
  'y^{\\prime}=-6x^2\\cos\\left(x^3\\right)\\sin\\left(x^3\\right)'];
const TIMES_NEG = ['y=\\cos^2\\left(x^3\\right)', 'y^{\\prime}=2\\cos\\left(x^3\\right)\\cdot-\\sin\\left(x^3\\right)\\cdot3x^2',
  'y^{\\prime}=-6x^2\\cos\\left(x^3\\right)\\sin\\left(x^3\\right)'];
const OPEN = ['y=\\cos^2\\left(x^3\\right)', 'y^{\\prime}=2\\cos\\left(x^3\\right)\\left(-\\sin\\left(x^3\\right)\\right)\\left(3x^2\\right.',
  'y^{\\prime}=-6x^2\\cos\\left(x^3\\right)\\sin\\left(x^3\\right)'];
const WRONG_MID = ['y=\\cos^2\\left(x^3\\right)', 'y^{\\prime}=2cos\\left(x^3\\right)\\left(-sin\\left(x^3\\right)\\right)\\left(3x\\right)',
  'y^{\\prime}=-6x^2cos\\left(x^3\\right)sin\\left(x^3\\right)'];
for (const [lines, want, why] of [[LETTERS, 5, 'every line typed in letters'], [DOTS, 5, 'full stops for times signs'],
  [TIMES_NEG, 5, '\\cdot- for times a negative'], [OPEN, 5, 'a bracket left open'], [WRONG_MID, 4, 'a wrong middle line still costs its step']]) {
  const d = (await q(`SELECT public.mark_working($1::jsonb, $2::jsonb) m`, [JSON.stringify(lines), JSON.stringify(RUBRIC)]))[0].m;
  ck(`database: ${why} — ${want}`, Number(d.marks) === want, JSON.stringify(d));
  ck(`dashboard: ${why} — ${want}`, markWorking(lines, RUBRIC).marks === want && markAnswer(lines, RUBRIC).marks === want);
}

console.log('\n=== 061: a minus in a bracket of its own ===');
{
  const M061 = fs.readFileSync(P + '/sql/061_minus_out_of_a_bracket.sql', 'utf8');
  const K = ["y'=7(-\\csc(3x)\\cot(3x))(3)"];
  const own = 'y^{\\prime}=7\\left(-\\csc\\left(3x\\right)\\right)\\left(\\cot\\left(3x\\right)\\right)\\left(3\\right)';
  ck('before 061: wrong', (await verdict(own, K)) !== null);
  await x(M061); await x(M061);
  ck('061 applies, twice', true);
  const v = (await q(M061.slice(M061.lastIndexOf('SELECT\n'))))[0];
  ck('061\'s VERIFY row is all true', Object.values(v).every(b => b === true), JSON.stringify(v));
  ck('database: the minus in its own bracket is right', (await verdict(own, K)) === null);
  ck('dashboard: the same', answerVerdict(own, K) === null
    && markAnswer([own], { steps: [{ latex: K[0], marks: 2 }] }).marks === 2);
  for (const [a, acc, why] of [
    ["y'=7(-\\sin)(x^3)(3x^2)", ["y'=7(-\\sin(x^3))(3x^2)"], 'a bare (-\\sin) is not -\\sin(x^3)'],
    ["y'=x^4(-\\cos(x))", ["y'=x^4-\\cos(x)"], 'a product is not a difference'],
    ["y'=(-x)^2", ["y'=-x^2"], 'a raised bracket keeps its minus'],
  ]) {
    ck(`database: still wrong — ${why}`, (await verdict(a, acc)) !== null);
    ck(`dashboard: still wrong — ${why}`, answerVerdict(a, acc) !== null);
  }
  // A full solution whose unsimplified step differs from the answer only by
  // where the minus sits: each line must keep its own step.
  const R = { mode: 'lines', steps: [
    { latex: 'y=x^4\\cos(x)', marks: 1 },
    { latex: "y'=4x^3\\cos(x)+x^4(-\\sin(x))", marks: 3 },
    { latex: "y'=4x^3\\cos(x)-x^4\\sin(x)", marks: 5, alone: 3, partial: 4 }] };
  const L = ['y=x^4\\cos\\left(x\\right)', 'y^{\\prime}=\\left(4x^3\\right)\\left(\\cos x\\right)+\\left(x^4\\right)\\left(-\\sin x\\right)',
    'y^{\\prime}=4x^3\\cos x-x^4\\sin x'];
  const d = (await q(`SELECT public.mark_working($1::jsonb, $2::jsonb) m`, [JSON.stringify(L), JSON.stringify(R)]))[0].m;
  ck('database: a right solution keeps 5 — each line its own step', Number(d.marks) === 5 && JSON.stringify(d.line_steps) === '[1,2,3]', JSON.stringify(d));
  const j = markWorking(L, R);
  ck('dashboard: the same', j.marks === 5 && JSON.stringify(j.lineSteps) === '[1,2,3]', JSON.stringify(j));
  let same = 0;
  for (const c of CORPUS.concat(['5(-a)(b)', '2-3(-a)', '-(-a)', '(-a)(-b)', 'x(-\\sin)(x^2)', '\\frac{(-a)}{b}', '{(-a)b}', '=(-a)', '(-\\sin(x))^2', 'a+b(-c)d-e'])) {
    const r = (await q(`SELECT public.math_unbracket_signs(public.normalize_math($1)) u`, [c]))[0].u;
    if (r === unbracketSigns(normalizeMath(c))) same++; else console.log(`        signs differ: ${JSON.stringify(c)} sql ${r} js ${unbracketSigns(normalizeMath(c))}`);
  }
  ck(`math_unbracket_signs and its JS twin agree on all ${CORPUS.length + 10}`, same === CORPUS.length + 10);
  // 062 is 059 for 061: it runs, and finishes.
  const M062 = fs.readFileSync(P + '/sql/062_remark_in_batches_after_061.sql', 'utf8');
  await x(M062);
  const c62 = (await q(M062.slice(M062.lastIndexOf('SELECT\n'))))[0];
  ck('062 runs', c62.graded_left !== undefined, JSON.stringify(c62));
}

console.log('\n=== 059 re-marks what was submitted, in batches, raise-only ===');
{
  const M059 = fs.readFileSync(P + '/sql/059_remark_in_batches.sql', 'utf8');
  const counts = async () => (await q(M059.slice(M059.lastIndexOf('SELECT\n'))))[0];
  const left = async () => { const c = await counts(); return Number(c.graded_left) + Number(c.practice_left); };
  const OLD = '2000-01-01';  // marked before 058 went live
  const mkPaper = async (id, retakes) => {
    await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,
        duration_minutes,allow_retakes,show_answers)
      VALUES ('${id}','exam','P ${id.slice(-2)}','MATH 117','${INS}',true,60,${retakes},true);`);
    await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
        question_type, choices, correct_answer, marks, work_given, work_variable, work_rubric)
      VALUES ($1,$1,1,'Differentiate, showing your working.','worked_solution','[]'::jsonb,NULL,5,'y=\\cos^2(x^3)','x',$2::jsonb),
             ($1,$1,2,'Differentiate','worked_solution','[]'::jsonb,NULL,2,'y=-\\cos(7x)','x',$3::jsonb)`,
      [id, JSON.stringify(RUBRIC), JSON.stringify({ steps: [{ latex: K_SIN[0], marks: 2, label: 'Final answer' }], accept: K_SIN.slice(1) })]);
    const ids = await q(`SELECT id, question_number FROM public.questions WHERE exam_id=$1 ORDER BY question_number`, [id]);
    return n => ids.find(r => r.question_number === n).id;
  };
  const sit = async (paper, qid) => {
    await x(`DELETE FROM public.live_sessions WHERE student_id='${STU}'`);
    await q(`INSERT INTO public.live_sessions (student_id, exam_id, assessment_id, student_name, status, work_answers_json)
             VALUES ($1,$2,$2,'S One','active',$3::jsonb)`,
      [STU, paper, JSON.stringify({ [qid(1)]: { lines: LETTERS }, [qid(2)]: { lines: ['y^{\\prime}=7sin\\left(7x\\right)'] } })]);
    return (await q(`SELECT public.submit_assessment($1,$2,'{}'::jsonb,60,0,'[]'::jsonb) AS r`, [STU, paper]))[0].r;
  };
  const PRAC = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b50', GRADED = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b51';
  const pq = await mkPaper(PRAC, true), gq = await mkPaper(GRADED, false);
  const attempts = [];
  for (let k = 0; k < 17; k++) attempts.push((await sit(PRAC, pq)).attempt_no);
  ck('a sitting typed in letters scores 5 + 2 under 058', true);
  const g = await sit(GRADED, gq);
  ck('…on a graded paper too', Number(g.work_marks) === 7, JSON.stringify(g));
  // As they stood before 058: marked 0, before it went live.
  await q(`UPDATE public.review_attempts SET work_marks = 0, work_marked_at = $1 WHERE student_id = $2`, [OLD, STU]);
  await q(`UPDATE public.results SET work_marks = 0, work_marked_at = $1 WHERE student_id = $2 AND assessment_id = $3`, [OLD, STU, GRADED]);
  // One attempt an instructor marked by hand.
  const hand = attempts[0];
  await q(`UPDATE public.review_attempts SET work_marks = 1,
             answers_json = jsonb_set(answers_json, $1::text[], '"Marked by instructor. x"') WHERE student_id = $2 AND attempt_no = $3`,
    [`{${pq(1)},reason}`, STU, hand]);
  ck('18 to re-mark (17 attempts + 1 graded, less the hand-marked one)', (await left()) === 17, String(await left()));
  await x(M059);
  {
    const c = await counts();
    ck('a run re-marks 6, the graded result first', Number(c.graded_left) === 0 && Number(c.practice_left) === 11, JSON.stringify(c));
  }
  await x(M059); await x(M059);
  ck('two more runs finish: 0 left', (await left()) === 0, String(await left()));
  await x(M059);
  ck('running it again changes nothing', (await left()) === 0);
  const pm = (await q(`SELECT attempt_no, work_marks FROM public.review_attempts WHERE student_id = $1`, [STU]))
    .map(r => [r.attempt_no, Number(r.work_marks)]);
  ck('every practice attempt marked 0 before is now 7', pm.filter(([n]) => n !== hand).every(([, m]) => m === 7), JSON.stringify(pm));
  ck('the hand-marked attempt is left at 1', pm.find(([n]) => n === hand)[1] === 1);
  const gm = (await q(`SELECT work_marks FROM public.results WHERE student_id = $1 AND assessment_id = $2`, [STU, GRADED]))[0];
  ck('the graded result is re-marked to 7', Number(gm.work_marks) === 7, JSON.stringify(gm));
  // Raise-only: a run in which one would go down changes nothing.
  await q(`UPDATE public.review_attempts SET work_marks = 9, work_marked_at = $1 WHERE student_id = $2 AND attempt_no = $3`, [OLD, STU, attempts[1]]);
  await q(`UPDATE public.review_attempts SET work_marks = 0, work_marked_at = $1 WHERE student_id = $2 AND attempt_no = $3`, [OLD, STU, attempts[2]]);
  let refused = '';
  try { await x(M059); } catch (e) { refused = e.message; await x('ROLLBACK'); }
  ck('if any would go down, the run is refused', /would go DOWN/i.test(refused), refused);
  const kept = Object.fromEntries((await q(`SELECT attempt_no, work_marks FROM public.review_attempts WHERE student_id = $1 AND attempt_no = ANY($2)`,
    [STU, [attempts[1], attempts[2]]])).map(r => [r.attempt_no, Number(r.work_marks)]));
  ck('…and nothing in it is changed', kept[attempts[1]] === 9 && kept[attempts[2]] === 0, JSON.stringify(kept));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
