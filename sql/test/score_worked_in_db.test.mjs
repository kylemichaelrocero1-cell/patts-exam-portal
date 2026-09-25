// Marking moved from the browser into the database. The trade that made it
// possible: instead of asking "are these expressions mathematically equal",
// which needs algebra Postgres does not have, it asks "is this one of the
// forms the instructor accepts", which needs only careful string handling.
//
// So the two things worth testing hard are the normaliser — every rule must
// collapse two spellings of the SAME thing and never change what an answer
// means — and the guarantee that a student cannot influence their own mark.
//
//   npm run test:score-db
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
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const asAnon = async (sql, p) => { try { await x(`SET ROLE anon`); return { ok: true, rows: await q(sql, p) }; }
  catch (e) { return { ok: false, message: e.message }; } finally { await x(`RESET ROLE`); } };
const match = async (a, b) => (await q(`SELECT public.math_answers_match($1,$2) m`, [a, b]))[0].m;

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
const TOK = 'tok-a';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.users (id, full_name, section, session_token)
  VALUES ('${STU}','S One','MATH 117','${TOK}');`);
for (const f of ['001_assessments_and_lessons','002_review_mode_and_server_scoring','003_lock_answer_key',
  '012_five_option_items','002b_grant_new_columns','015_archive_assessments','016_unlimited_choices',
  '017_shuffle_questions_switch','018_multi_select_items','019_exam_password_on_assessments',
  '020_exam_content_behind_the_gate','024_worked_solution_items','025_points_per_item',
  '026_worked_answers_are_saved_and_scored']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}
await x(fs.readFileSync(P + '/sql/027_score_worked_in_the_database.sql', 'utf8'));
await x(fs.readFileSync(P + '/sql/027_score_worked_in_the_database.sql', 'utf8'));
ck('027 applies, twice', true);

console.log('\n=== spellings that must collapse to one answer ===');
for (const [a, b, why] of [
  ["y'=5", '5', 'a subject on the left is a label, not the answer'],
  ['\\frac{dy}{dx}=5', "y'=5", 'Leibniz and Lagrange'],
  ['y = 5', 'y=5', 'spaces'],
  ['2 \\cdot x', '2x', 'explicit multiplication'],
  ['2 \\times x', '2x', 'the other multiplication sign'],
  ['\\left( x+1 \\right)', '(x+1)', '\\left and \\right'],
  ['x^{2}', 'x^2', 'braces round a single token'],
  ['\\dfrac{1}{x}', '\\frac{1}{x}', 'display fractions'],
  ['(2x+3)', '2x+3', 'brackets round the whole answer'],
  ['2', '2.0', 'a number is a number'],
  ['\\frac{1}{2}', '0.5', 'a fraction of integers is a number too'],
  ['\\frac{4}{2}', '2', 'and it is reduced by comparing values'],
  ["Y'=\\Cos(x)", "y'=\\cos(x)", 'case'],
  ['x+ -1', 'x-1', 'plus-minus'],
]) ck(`${a}  =  ${b}   (${why})`, await match(a, b));

console.log('\n=== and things that must stay different ===');
for (const [a, b, why] of [
  ['2x=6', 'x=3', 'an equivalent equation is not an answer'],
  ["y'=2x", "y'=x", 'plainly different'],
  ['5', '6', 'different numbers'],
  ['\\sin(x)', '\\cos(x)', 'different functions'],
  ['x+1', '1', 'an expression is not a number'],
  ['-5', '5', 'sign'],
  ['\\frac{1}{3}', '0.33', 'a near miss is a miss'],
]) ck(`${a}  ≠  ${b}   (${why})`, !(await match(a, b)));

console.log('\n=== what needs the accept list, and gets it ===');
ck('x^{-1} and 1/x are NOT matched by normalisation — that needs algebra',
  !(await match('x^{-1}', '\\frac{1}{x}')));
{
  const acc = (await q(`SELECT public.accepted_answers($1::jsonb) a`,
    [JSON.stringify({ steps: [{ latex: "y'=\\frac{1}{x}", marks: 2 }], accept: ["y'=x^{-1}", "1/x"] })]))[0].a;
  ck('the accept list and the answer are offered together', acc.length === 3, JSON.stringify(acc));
  const none = (await q(`SELECT public.accepted_answers($1::jsonb) a`,
    [JSON.stringify({ steps: [{ latex: "y'=5", marks: 2 }] })]))[0].a;
  ck('an item with no accept list still accepts its own answer, so old papers keep working',
    none.length === 1 && none[0] === "y'=5", JSON.stringify(none));
}

console.log('\n=== marking a real paper, on the server ===');
const PAPER = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b33';
await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,
    duration_minutes,allow_retakes,show_answers)
  VALUES ('${PAPER}','exam','Practice','MATH 117','${INS}',true,60,true,true);`);
await q(`INSERT INTO public.questions (exam_id,assessment_id,question_number,question_text,
    question_type,choices,marks,work_given,work_variable,work_rubric)
  VALUES ($1,$1,1,'Differentiate','worked_solution','[]'::jsonb,2,'y=5x','x',$2::jsonb),
         ($1,$1,2,'Differentiate','worked_solution','[]'::jsonb,3,'y=\\ln(x)','x',$3::jsonb),
         ($1,$1,3,'Limit','worked_solution','[]'::jsonb,1,'\\lim_{x\\to2}(x+3)','x',$4::jsonb)`,
  [PAPER,
   JSON.stringify({ steps: [{ latex: "y'=5", marks: 2 }] }),
   JSON.stringify({ steps: [{ latex: "y'=\\frac{1}{x}", marks: 3 }], accept: ["y'=x^{-1}"] }),
   JSON.stringify({ steps: [{ latex: '5', marks: 1 }] })]);
const ids = await q(`SELECT id, question_number n FROM public.questions WHERE exam_id=$1 ORDER BY question_number`, [PAPER]);
const qid = n => ids.find(r => r.n === n).id;
await q(`SELECT public.submit_assessment($1,$2,'{}'::jsonb,60,0,'[]'::jsonb)`, [STU, PAPER]);

{
  // Q1 right in a different spelling, Q2 right via the accept list, Q3 wrong.
  const work = { [qid(1)]: { lines: ['\\frac{dy}{dx} = 5'] },
                 [qid(2)]: { lines: ["y'=x^{-1}"] },
                 [qid(3)]: { lines: ['6'] } };
  const r = await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb) AS r`,
    [STU, PAPER, TOK, JSON.stringify(work)]);
  ck('one call saves and scores', r.ok, r.message);
  ck('the score comes back from the server: 5 of 6',
    r.ok && Number(r.rows[0].r.work_marks) === 5 && Number(r.rows[0].r.work_total) === 6,
    JSON.stringify(r.ok ? r.rows[0].r : r.message));
  const row = (await q(`SELECT work_marks, work_total, work_marked_at, answers_json
    FROM public.review_attempts WHERE student_id=$1`, [STU]))[0];
  ck('and it is IN THE DATABASE, not just in the reply',
    Number(row.work_marks) === 5 && Number(row.work_total) === 6 && row.work_marked_at,
    JSON.stringify({ m: row.work_marks, t: row.work_total }));
  ck('each item records what it earned and why',
    row.answers_json[qid(1)].correct === true && Number(row.answers_json[qid(1)].marks) === 2
    && row.answers_json[qid(3)].correct === false && Number(row.answers_json[qid(3)].marks) === 0,
    JSON.stringify(row.answers_json[qid(3)]));
}

console.log('\n=== a student cannot influence the number ===');
{
  const forge = await asAnon(
    `UPDATE public.review_attempts SET work_marks = 999 WHERE student_id=$1 RETURNING id`, [STU]);
  ck('writing work_marks directly does not land',
    !forge.ok || forge.rows.length === 0, forge.ok ? `${forge.rows.length} rows` : forge.message);
  const still = (await q(`SELECT work_marks FROM public.review_attempts WHERE student_id=$1`, [STU]))[0];
  ck('the stored mark is untouched', Number(still.work_marks) === 5, String(still.work_marks));

  // Sending a list of candidate answers — impossible through the one field on
  // screen, trivial for anyone shaping the request by hand. Only the LAST
  // line counts, so being right by exhaustion does not work.
  const shotgun = { [qid(3)]: { lines: ['5', '4', '3', '2', '1'] } };
  const r = await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb) AS r`,
    [STU, PAPER, TOK, JSON.stringify(shotgun)]);
  ck('listing every possible answer does NOT pay — only the last line is read',
    r.ok && Number(r.rows[0].r.work_marks) === 5,
    JSON.stringify(r.ok ? r.rows[0].r : r.message));
  const honest = { [qid(3)]: { lines: ['5'] } };
  const r2 = await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb) AS r`,
    [STU, PAPER, TOK, JSON.stringify(honest)]);
  ck('and answering it properly does', r2.ok && Number(r2.rows[0].r.work_marks) === 6,
    JSON.stringify(r2.ok ? r2.rows[0].r : r2.message));
  const stepwise = { [qid(3)]: { lines: ['x+3', '2+3', '5'] } };
  const r3 = await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb) AS r`,
    [STU, PAPER, TOK, JSON.stringify(stepwise)]);
  ck('working shown line by line still marks on its last line',
    r3.ok && Number(r3.rows[0].r.work_marks) === 6,
    JSON.stringify(r3.ok ? r3.rows[0].r : r3.message));
}

console.log('\n=== the instructor still has the last word ===');
{
  await x(`SET LOCAL ROLE authenticated; SET test.uid = '${INS}'`);
  const over = await q(`SELECT public.record_work_marks($1,$2,$3::jsonb,$4) AS r`,
    [STU, PAPER, JSON.stringify({ [qid(1)]: { marks: 0, total: 2, reason: 'Marked down by hand.' } }), 1]);
  await x(`RESET ROLE; SET test.uid = ''`);
  const row = (await q(`SELECT work_marks FROM public.review_attempts WHERE student_id=$1`, [STU]))[0];
  ck('an instructor override replaces what the database computed',
    Number(row.work_marks) === 0, String(row.work_marks));
}

console.log('\n=== the rubric is still out of reach ===');
ck('anon cannot read work_rubric', !(await asAnon(`SELECT work_rubric FROM public.questions LIMIT 1`)).ok);
{
  // score_worked_answers() takes a student id and proves nothing about who is
  // asking. Callable by a student, it would let anyone re-score anyone —
  // which overwrites an instructor's hand-set mark with the computed one.
  const direct = await asAnon(`SELECT public.score_worked_answers($1,$2,$3)`, [STU, PAPER, 1]);
  ck('a student cannot call the scorer directly',
    !direct.ok && /permission denied/i.test(direct.message), direct.message);
  const row = (await q(`SELECT work_marks FROM public.review_attempts WHERE student_id=$1`, [STU]))[0];
  ck("so the instructor's override of 0 survives the attempt",
    Number(row.work_marks) === 0, String(row.work_marks));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
