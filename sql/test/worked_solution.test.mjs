// Runs 001 → 024 against real PostgreSQL (PGlite) and proves the four things
// a worked item has to get right in the database:
//
//   1. the rubric — the instructor's own working, with the marks on it — is
//      unreachable from a student's browser, by grant AND by the shape of
//      get_exam_questions();
//   2. adding the type did not change a single existing score, because a
//      worked item is excluded from score_answers() exactly as an essay is;
//   3. the constraints refuse a half-built item, so a paper cannot go live
//      with a worked question nobody can mark;
//   4. marks can only be written by an instructor who owns the paper.
//
//   npm run test:worked
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

const asRole = async (role, sql, params, uid) => {
  try {
    if (uid) await x(`SET test.uid = '${uid}'`);
    await x(`SET ROLE ${role}`);
    return { ok: true, rows: await q(sql, params) };
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  } finally {
    await x(`RESET ROLE`);
    if (uid) await x(`SET test.uid = ''`);
  }
};
const asAnon = (sql, params) => asRole('anon', sql, params);
const asInstructor = (sql, params, uid) => asRole('authenticated', sql, params, uid);
const tryRun = async (sql, params) => {
  try { return { ok: true, rows: await q(sql, params) }; }
  catch (e) { return { ok: false, message: e.message || String(e) }; }
};
// A whole migration is many statements, which db.query() cannot take.
const tryExec = async sql => {
  try { await x(sql); return { ok: true }; }
  catch (e) { return { ok: false, message: e.message || String(e) }; }
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
const OTHER = 'a1b2c3d4-0000-4000-8000-000000000001';   // an instructor with no claim on the paper
const STU = '11111111-1111-1111-1111-111111111111';
const TOK = 'f0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1a';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph'), ('${OTHER}','o@p.ph');
  INSERT INTO public.users (id, full_name, section, session_token)
  VALUES ('${STU}','S One','MATH 115-5B','${TOK}');`);

for (const f of ['001_assessments_and_lessons', '002_review_mode_and_server_scoring',
                 '003_lock_answer_key', '012_five_option_items',
                 '002b_grant_new_columns', '015_archive_assessments',
                 '016_unlimited_choices', '017_shuffle_questions_switch',
                 '018_multi_select_items', '019_exam_password_on_assessments',
                 '020_exam_content_behind_the_gate']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

const PAPER = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b33';
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id,
           is_open, duration_minutes)
         VALUES ('${PAPER}','exam','Calculus I','MATH 115-5B','${INS}',true,60);
  INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choices, correct_answer)
  VALUES ('${PAPER}','${PAPER}',1,'Which is the power rule?','multiple_choice','["a","b","c","d"]'::jsonb,2),
         ('${PAPER}','${PAPER}',2,'Define a limit','multiple_choice','["a","b","c","d"]'::jsonb,0);`);

// What the paper scored BEFORE a worked item existed. Every later assertion
// about "nothing changed" is measured against these two numbers.
const before = (await q(
  `SELECT score, total_items FROM public.score_answers($1, $2::jsonb)`,
  [PAPER, JSON.stringify({})]))[0];

console.log('=== 024 runs ===');
{
  const sql = fs.readFileSync(P + '/sql/024_worked_solution_items.sql', 'utf8');
  const first = await tryExec(sql);
  ck('the migration applies cleanly', first.ok, first.message);
  const again = await tryExec(sql);
  ck('and is idempotent — running it twice changes nothing', again.ok, again.message);
}

console.log('\n=== nothing that existed was disturbed ===');
{
  const rows = await q(`SELECT marks, work_rubric FROM public.questions WHERE exam_id = $1`, [PAPER]);
  ck('every existing item is worth exactly 1 mark',
     rows.length === 2 && rows.every(r => Number(r.marks) === 1),
     JSON.stringify(rows));
  ck('and none of them acquired a rubric', rows.every(r => r.work_rubric === null));

  const after = (await q(
    `SELECT score, total_items FROM public.score_answers($1, $2::jsonb)`,
    [PAPER, JSON.stringify({})]))[0];
  ck('the paper still scores out of the same total',
     Number(after.total_items) === Number(before.total_items),
     `${before.total_items} -> ${after.total_items}`);
}

console.log('\n=== the constraints refuse a half-built item ===');
{
  const noRubric = await tryRun(
    `INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
       question_type, choices, marks)
     VALUES ($1,$1,3,'Differentiate y = 5x','worked_solution','[]'::jsonb,3)`, [PAPER]);
  ck('a worked item without a rubric is refused', !noRubric.ok, noRubric.message);

  const emptySteps = await tryRun(
    `INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
       question_type, choices, marks, work_rubric)
     VALUES ($1,$1,3,'Differentiate y = 5x','worked_solution','[]'::jsonb,3,'{"steps":[]}'::jsonb)`, [PAPER]);
  ck('a rubric with no steps in it is refused', !emptySteps.ok, emptySteps.message);

  const strayRubric = await tryRun(
    `INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
       question_type, choices, correct_answer, work_rubric)
     VALUES ($1,$1,3,'Pick one','multiple_choice','["a","b"]'::jsonb,0,'{"steps":[{"latex":"x","marks":1}]}'::jsonb)`, [PAPER]);
  ck('a multiple-choice item may not carry a rubric', !strayRubric.ok, strayRubric.message);

  const keyedWorked = await tryRun(
    `INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
       question_type, choices, marks, correct_answer, work_rubric)
     VALUES ($1,$1,3,'Differentiate','worked_solution','[]'::jsonb,3,1,'{"steps":[{"latex":"x","marks":1}]}'::jsonb)`, [PAPER]);
  ck('a worked item may not also key on a choice', !keyedWorked.ok, keyedWorked.message);

  const zeroMarks = await tryRun(
    `INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
       question_type, choices, marks, work_rubric)
     VALUES ($1,$1,3,'Differentiate','worked_solution','[]'::jsonb,0,'{"steps":[{"latex":"x","marks":1}]}'::jsonb)`, [PAPER]);
  ck('an item worth no marks at all is refused', !zeroMarks.ok, zeroMarks.message);
}

console.log('\n=== a real worked item ===');
const RUBRIC = {
  steps: [
    { latex: "y'=5(1)x^{1-1}", marks: 1, label: 'Power rule applied' },
    { latex: "y'=5", marks: 2, label: 'Final answer' },
  ],
  penaltyPerBrokenStep: 1,
};
const inserted = await tryRun(
  `INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
     question_type, choices, marks, work_given, work_variable, work_rubric)
   VALUES ($1,$1,3,'Differentiate with respect to x, showing your working.',
     'worked_solution','[]'::jsonb,3,'y=5x','x',$2::jsonb)`,
  [PAPER, JSON.stringify(RUBRIC)]);
ck('a complete worked item is accepted', inserted.ok, inserted.message);

{
  const after = (await q(
    `SELECT score, total_items FROM public.score_answers($1, $2::jsonb)`,
    [PAPER, JSON.stringify({})]))[0];
  ck('adding it did NOT change what the paper is scored out of — it is not a picked item',
     Number(after.total_items) === Number(before.total_items),
     `${before.total_items} -> ${after.total_items}`);
}

console.log('\n=== the rubric never reaches a student ===');
{
  const direct = await asAnon(`SELECT work_rubric FROM public.questions WHERE exam_id = $1`, [PAPER]);
  ck('anon cannot read work_rubric off the table', !direct.ok, direct.message);

  const paper = await asAnon(
    `SELECT * FROM public.get_exam_questions($1,$2,$3)`, [PAPER, STU, TOK]);
  ck('a student is served the paper', paper.ok && paper.rows.length === 3, paper.message);
  if (paper.ok) {
    const worked = paper.rows.find(r => r.question_type === 'worked_solution');
    ck('the worked item arrives with the problem and what it is worth',
       worked && worked.work_given === 'y=5x' && Number(worked.marks) === 3
       && worked.work_variable === 'x', JSON.stringify(worked));
    ck('and with no rubric column on it at all',
       worked && !('work_rubric' in worked), Object.keys(worked || {}).join(', '));
  }

  const grants = await q(
    `SELECT column_name FROM information_schema.column_privileges
     WHERE grantee='anon' AND table_name='questions' AND privilege_type='SELECT'`);
  ck('work_rubric is on no anon grant',
     !grants.some(g => g.column_name === 'work_rubric'),
     grants.map(g => g.column_name).join(', '));
}

console.log('\n=== writing the marks back ===');
const ITEMS = qid => ({ [qid]: { marks: 1, total: 3, reason: 'Stopped after the power rule.' } });
const workedId = (await q(
  `SELECT id FROM public.questions WHERE exam_id=$1 AND question_type='worked_solution'`, [PAPER]))[0].id;

await x(`INSERT INTO public.results (student_id, exam_id, assessment_id, score, total_items,
    answers_json, submitted_at)
  VALUES ('${STU}','${PAPER}','${PAPER}',1,2,'{"some-mc-id":{"chosen":2,"is_correct":true}}'::jsonb, now());`);

{
  const byAnon = await asAnon(
    `SELECT public.record_work_marks($1,$2,$3::jsonb,NULL)`,
    [STU, PAPER, JSON.stringify(ITEMS(workedId))]);
  ck('a student cannot write their own marks', !byAnon.ok, byAnon.message);

  const byStranger = await asInstructor(
    `SELECT public.record_work_marks($1,$2,$3::jsonb,NULL)`,
    [STU, PAPER, JSON.stringify(ITEMS(workedId))], OTHER);
  ck('nor can an instructor with no claim on the paper',
     !byStranger.ok && /access/i.test(byStranger.message), byStranger.message);

  const byOwner = await asInstructor(
    `SELECT public.record_work_marks($1,$2,$3::jsonb,NULL) AS r`,
    [STU, PAPER, JSON.stringify(ITEMS(workedId))], INS);
  ck('the instructor who owns the paper can', byOwner.ok, byOwner.message);

  const row = (await q(
    `SELECT work_marks, work_total, work_marked_at, answers_json FROM public.results
     WHERE student_id=$1 AND assessment_id=$2`, [STU, PAPER]))[0];
  ck('the marks land on the result row',
     Number(row.work_marks) === 1 && Number(row.work_total) === 3 && row.work_marked_at,
     JSON.stringify(row));
  ck('the multiple-choice answers beside them are untouched',
     row.answers_json['some-mc-id']?.is_correct === true, JSON.stringify(row.answers_json));
  ck('and the worked item carries its reason, so the mark can be explained',
     /power rule/i.test(row.answers_json[workedId]?.reason || ''), JSON.stringify(row.answers_json[workedId]));
  ck('a marked item is stamped with its type',
     row.answers_json[workedId]?.type === 'worked');

  const missing = await asInstructor(
    `SELECT public.record_work_marks($1,$2,$3::jsonb,NULL)`,
    ['22222222-2222-2222-2222-222222222222', PAPER, JSON.stringify(ITEMS(workedId))], INS);
  ck('marking a student who never submitted is an error, not a silent no-op',
     !missing.ok && /no submission/i.test(missing.message), missing.message);
}

console.log('\n=== copying a paper carries the working ===');
{
  const copy = await asInstructor(
    `SELECT public.duplicate_assessment($1,'Calculus I (copy)','MATH 115-5B',true,true,'latest') AS id`,
    [PAPER], INS);
  ck('the paper duplicates', copy.ok, copy.message);
  if (copy.ok) {
    const newId = copy.rows[0].id;
    const w = (await q(
      `SELECT marks, work_given, work_variable, work_rubric FROM public.questions
       WHERE exam_id=$1 AND question_type='worked_solution'`, [newId]))[0];
    ck('the copy keeps the rubric, the problem and the marks',
       w && Number(w.marks) === 3 && w.work_given === 'y=5x'
       && w.work_rubric?.steps?.length === 2, JSON.stringify(w));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
