// sql/042: a full solution marked line by line, and a review that can keep
// the key back.
//
//   * mark_working() (SQL) and markWorking() (src/lib/stepMarking.js) give
//     the same marks, verdict and line-by-line steps — on the scheme Kyle
//     asked for case by case, and on hundreds of random solutions;
//   * the dashboard's markAnswer() agrees, so a re-mark cannot overturn it;
//   * a whole sitting through submit_assessment() is marked with it, and a
//     one-line item on the same paper is marked exactly as before;
//   * get_exam_questions() tells the exam screen which items take lines;
//   * get_answer_review() withholds the key for missed items when the paper
//     says so — and only then — and get_worked_keys() refuses on such a paper;
//   * 042 runs twice.
//
//   npm run test:working-lines
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markWorking } from '../../src/lib/stepMarking.js';
import { markAnswer } from '../../src/lib/workedSolution.js';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const asAnon = async (sql, params) => {
  try { await x(`SET ROLE anon`); return { ok: true, rows: await q(sql, params) }; }
  catch (e) { return { ok: false, message: e.message || String(e) }; }
  finally { await x(`RESET ROLE`); }
};

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
  '039_submit_files_the_working']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}
const M042 = fs.readFileSync(P + '/sql/042_working_marked_line_by_line.sql', 'utf8');
await x(M042);
await x(M042);
ck('042 applies, twice', true);

// ── The scheme, as asked: y = sin^2(x^2) ─────────────────────────────────
// 5 for the working and the simplified answer, 3 for the derivative left
// unsimplified, 3 for the simplified answer written on its own.
const S1 = 'y=\\sin^2(x^2)';
const S2 = "y'=2\\sin(x^2)\\cos(x^2)(2x)";
const S2b = "y'=2\\sin(x^2)\\cdot\\cos(x^2)\\cdot2x";
const S3 = "y'=4x\\sin(x^2)\\cos(x^2)";
const S3b = "\\frac{dy}{dx}=4x\\cos(x^2)\\sin(x^2)";
const RUBRIC = {
  mode: 'lines',
  steps: [
    { latex: S1, marks: 0, label: 'The function' },
    { latex: S2, marks: 3, label: 'Derivative, not simplified', accept: [S2b] },
    { latex: S3, marks: 5, label: 'Simplified', alone: 3, accept: ["y'=4x\\cos(x^2)\\sin(x^2)"] },
  ],
};
const sqlMark = async lines => (await q(`SELECT public.mark_working($1::jsonb, $2::jsonb) AS m`,
  [JSON.stringify(lines), JSON.stringify(RUBRIC)]))[0].m;

console.log('\n=== the scheme, case by case — database and dashboard ===');
const CASES = [
  ['nothing written', [], 0],
  ['the function, the derivative, the simplified answer', [S1, S2, S3], 5],
  ['the same, in other accepted spellings', [S1, S2b, S3b], 5],
  ['blank lines in between change nothing', [S1, '', S2, '  ', S3], 5],
  ['the simplified answer alone', [S3], 3],
  ['the derivative left unsimplified', [S1, S2], 3],
  ['the unsimplified derivative alone', [S2], 3],
  ['the answer without restating the function', [S2, S3], 3],
  ['the function and the answer, no derivative', [S1, S3], 3],
  ['the function alone earns nothing', [S1], 0],
  ['steps right, then a wrong final line', [S1, S2, "y'=4x\\sin(x^2)"], 3],
  ['the answer, then something after it', [S1, S2, S3, "y'=0"], 3],
  ['working out of order', [S2, S1, S3], 3],
  ['a function with no label is not the step', ['\\sin^2(x^2)', S2, S3], 3],
  ['a wrong derivative', [S1, "y'=2\\sin(x^2)\\cos(x^2)", "y'=2\\sin(x^2)\\cos(x^2)"], 0],
  ['nothing right at all', ['y=x', "y'=1"], 0],
];
for (const [name, lines, want] of CASES) {
  const s = await sqlMark(lines);
  const j = markWorking(lines, RUBRIC);
  const a = markAnswer(lines, { ...RUBRIC, marks: 5 });
  const same = Number(s.marks) === j.marks && s.reason === j.reason && s.correct === j.correct
    && JSON.stringify(s.line_steps) === JSON.stringify(j.lineSteps) && a.marks === j.marks;
  ck(`${name}: ${want}/5, and SQL = JS = markAnswer`, Number(s.marks) === want && same,
    `sql ${JSON.stringify(s)} js ${JSON.stringify(j)} markAnswer ${a.marks}`);
}
ck('full marks say so; part marks are not "correct"',
  (await sqlMark([S1, S2, S3])).correct === true && (await sqlMark([S3])).correct === false);
ck('no reason ever quotes the key',
  (await Promise.all(CASES.map(c => sqlMark(c[1])))).every(m => !/sin|cos|4x/.test(m.reason)));

console.log('\n=== 400 random solutions: the two markers agree on everything ===');
{
  const POOL = [S1, S2, S2b, S3, S3b, '\\sin^2(x^2)', "y'=4x\\sin(x^2)", "y'=0", 'y=x', '', "4x\\sin(x^2)\\cos(x^2)"];
  let seed = 7;
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let agree = 0, firstBad = null;
  for (let t = 0; t < 400; t++) {
    const lines = Array.from({ length: rnd(6) }, () => POOL[rnd(POOL.length)]);
    const s = await sqlMark(lines), j = markWorking(lines, RUBRIC);
    if (Number(s.marks) === j.marks && s.reason === j.reason && s.correct === j.correct
        && JSON.stringify(s.line_steps) === JSON.stringify(j.lineSteps)) agree++;
    else if (!firstBad) firstBad = { lines, s, j };
  }
  ck('all 400 agree', agree === 400, JSON.stringify(firstBad));
}

// ── A paper: one full solution, one one-line item, one multiple choice ──
console.log('\n=== a whole sitting ===');
const PAPER = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b33';
await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,
    duration_minutes,allow_retakes,show_answers)
  VALUES ('${PAPER}','exam','Practice','MATH 117','${INS}',true,60,true,true);`);
await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choices, correct_answer, marks, work_given, work_variable, work_rubric)
  VALUES ($1,$1,1,'Differentiate, showing your working.','worked_solution','[]'::jsonb,NULL,5,'y=\\sin^2(x^2)','x',$2::jsonb),
         ($1,$1,2,'Differentiate','worked_solution','[]'::jsonb,NULL,2,'y=5x','x',$3::jsonb),
         ($1,$1,3,'Pick one','multiple_choice','["a","b","c","d"]'::jsonb,2,1,NULL,NULL,NULL)`,
  [PAPER, JSON.stringify(RUBRIC),
   JSON.stringify({ steps: [{ latex: "y'=5", marks: 2, label: 'Final answer' }] })]);
const ids = await q(`SELECT id, question_number FROM public.questions WHERE exam_id=$1 ORDER BY question_number`, [PAPER]);
const qid = n => ids.find(r => r.question_number === n).id;

const sit = async (work, picked) => {
  await x(`DELETE FROM public.live_sessions WHERE student_id='${STU}'`);
  await q(`INSERT INTO public.live_sessions (student_id, exam_id, assessment_id, student_name, status, work_answers_json)
           VALUES ($1,$2,$2,'S One','active',$3::jsonb)`, [STU, PAPER, JSON.stringify(work)]);
  return (await q(`SELECT public.submit_assessment($1,$2,$3::jsonb,60,0,'[]'::jsonb) AS r`,
    [STU, PAPER, JSON.stringify(picked)]))[0].r;
};
const r1 = await sit({ [qid(1)]: { lines: [S1, S2, S3] }, [qid(2)]: { lines: ["y'=5"] } }, { [qid(3)]: 2 });
ck('full working + the one-line item: 7 of 7 typed marks', Number(r1.work_marks) === 7 && Number(r1.work_total) === 7, JSON.stringify(r1));
const r2 = await sit({ [qid(1)]: { lines: [S3] }, [qid(2)]: { lines: ['x', "y'=5"] } }, { [qid(3)]: 0 });
ck('answer alone (3) + the one-line item on its LAST line (2): 5', Number(r2.work_marks) === 5, JSON.stringify(r2));
const att2 = (await q(`SELECT answers_json FROM public.review_attempts WHERE student_id=$1 AND attempt_no=2`, [STU]))[0].answers_json;
ck('the attempt records each line\'s step', JSON.stringify(att2[qid(1)].line_steps) === '[3]'
  && Number(att2[qid(1)].marks) === 3 && att2[qid(1)].correct === false, JSON.stringify(att2[qid(1)]));
ck('a one-line item is stored exactly as before (no line_steps)', att2[qid(2)].line_steps === undefined
  && att2[qid(2)].correct === true);

console.log('\n=== the exam screen learns which items take lines ===');
{
  const r = await asAnon(`SELECT question_number, work_mode FROM public.get_exam_questions($1,$2,$3) ORDER BY 1`, [PAPER, STU, TOK]);
  ck('get_exam_questions works for the student', r.ok, r.message);
  ck('item 1 is "lines", the others have no mode', r.ok && r.rows[0].work_mode === 'lines'
    && r.rows[1].work_mode === null && r.rows[2].work_mode === null, JSON.stringify(r.rows));
  const cols = r.ok ? Object.keys(r.rows[0]) : [];
  ck('…and nothing of the rubric is sent', !cols.some(c => /rubric|accept|correct/.test(c)));
}

console.log('\n=== the review ===');
const review = async () => {
  const r = await asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3) AS r`, [STU, PAPER, TOK]);
  return r.ok ? Object.fromEntries(r.rows[0].r.map(row => [row.question_number, row])) : r.message;
};
// Attempt 2 is the latest: item 1 part marks, item 2 right, item 3 wrong.
ck('a paper created before 042 shows its key, as it always did',
  (await q(`SELECT review_shows_key FROM public.assessments WHERE id=$1`, [PAPER]))[0].review_shows_key === true);
{
  const rv = await review();
  ck('key shown: the missed full solution carries the answer and the worked solution',
    rv[1].correct_latex === S3 && JSON.stringify(rv[1].solution) === JSON.stringify([S1, S2, S3]) && rv[1].key_hidden === false,
    JSON.stringify(rv[1]));
  ck('key shown: every line, which step it was, and why marks were lost',
    JSON.stringify(rv[1].lines) === JSON.stringify([S3]) && JSON.stringify(rv[1].line_steps) === '[3]'
    && /working/.test(rv[1].reason) && rv[1].work_mode === 'lines');
  ck('key shown: the missed multiple choice shows its answer', rv[3].correct === 2 && rv[3].key_hidden === false);
}
await x(`UPDATE public.assessments SET review_shows_key = false WHERE id = '${PAPER}'`);
{
  const rv = await review();
  ck('key kept back: the missed full solution has no answer and no worked solution',
    rv[1].correct_latex === null && rv[1].solution === null && rv[1].key_hidden === true, JSON.stringify(rv[1]));
  ck('key kept back: the student still sees their lines, the marks and the reason',
    JSON.stringify(rv[1].lines) === JSON.stringify([S3]) && Number(rv[1].earned) === 3 && !!rv[1].reason);
  ck('key kept back: the missed multiple choice has no answer either',
    rv[3].correct === null && rv[3].correct_set === null && rv[3].key_hidden === true && rv[3].chosen === 0,
    JSON.stringify(rv[3]));
  ck('key kept back: an item answered right still shows its answer',
    rv[2].correct_latex === "y'=5" && rv[2].key_hidden === false && rv[2].is_correct === true);
  const raw = JSON.stringify(await review());
  // The student wrote the final line themselves and the problem is the
  // given; the step they never wrote — the unsimplified derivative — is the
  // part of the key that must not travel.
  ck('…and the step they missed appears nowhere in what is sent', !raw.includes('(2x)'), raw.slice(0, 200));
  const k = await asAnon(`SELECT public.get_worked_keys($1,$2,$3)`, [STU, PAPER, TOK]);
  ck('get_worked_keys() refuses on a paper that keeps its key', !k.ok && /not available/.test(k.message), k.message);
}
await x(`UPDATE public.assessments SET review_shows_key = true WHERE id = '${PAPER}'`);
{
  const k = await asAnon(`SELECT public.get_worked_keys($1,$2,$3) AS r`, [STU, PAPER, TOK]);
  ck('…and still answers on one that shows it', k.ok && k.rows[0].r.length === 2, k.message);
}
await x(`UPDATE public.assessments SET show_answers = false WHERE id = '${PAPER}'`);
ck('with review off, nothing at all', typeof (await review()) === 'string');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
