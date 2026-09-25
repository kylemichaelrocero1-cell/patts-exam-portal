// Runs 001 → 025 against real PostgreSQL (PGlite). The whole risk in 025 is
// that `score` and `total_items` are a COUNT on every result row ever written,
// and a great deal reads them. So most of this file is about what did NOT
// change: an unweighted paper must score identically before and after, and old
// rows must keep their meaning rather than being quietly restated.
//
//   npm run test:points
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
const tryExec = async s => { try { await x(s); return { ok: true }; } catch (e) { return { ok: false, message: e.message }; } };

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
const STU2 = '22222222-2222-2222-2222-222222222222';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.users (id, full_name, section)
  VALUES ('${STU}','S One','MATH 115-5B'), ('${STU2}','S Two','MATH 115-5B');`);
for (const f of ['001_assessments_and_lessons', '002_review_mode_and_server_scoring',
                 '003_lock_answer_key', '012_five_option_items', '002b_grant_new_columns',
                 '015_archive_assessments', '016_unlimited_choices',
                 '017_shuffle_questions_switch', '018_multi_select_items',
                 '019_exam_password_on_assessments', '020_exam_content_behind_the_gate',
                 '024_worked_solution_items']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

// A plain four-item paper, and a student who got two of them right.
const PAPER = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b33';
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id, is_open, duration_minutes)
  VALUES ('${PAPER}','exam','Prelim','MATH 115-5B','${INS}',true,60);
  INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choices, correct_answer)
  VALUES ('${PAPER}','${PAPER}',1,'Q1','multiple_choice','["a","b","c","d"]'::jsonb,0),
         ('${PAPER}','${PAPER}',2,'Q2','multiple_choice','["a","b","c","d"]'::jsonb,1),
         ('${PAPER}','${PAPER}',3,'Q3','multiple_choice','["a","b","c","d"]'::jsonb,2),
         ('${PAPER}','${PAPER}',4,'Q4','multiple_choice','["a","b","c","d"]'::jsonb,3);`);
const ids = (await q(`SELECT id, question_number FROM public.questions WHERE exam_id=$1 ORDER BY question_number`, [PAPER]));
const qid = n => ids.find(r => r.question_number === n).id;
// Right on Q1 and Q3, wrong on Q2, Q4 left blank.
const ANSWERS = { [qid(1)]: 0, [qid(2)]: 3, [qid(3)]: 2 };

const before = (await q(`SELECT score, total_items FROM public.score_answers($1,$2::jsonb)`,
  [PAPER, JSON.stringify(ANSWERS)]))[0];
ck('before 025 the paper scores 2 of 4',
   Number(before.score) === 2 && Number(before.total_items) === 4, JSON.stringify(before));

// A result already on file, written the old way, with no points columns.
await x(`INSERT INTO public.results (student_id, exam_id, assessment_id, score, total_items,
    answers_json, submitted_at)
  VALUES ('${STU2}','${PAPER}','${PAPER}',2,4,'{}'::jsonb, now());`);

console.log('\n=== 025 runs ===');
{
  const sql = fs.readFileSync(P + '/sql/025_points_per_item.sql', 'utf8');
  const first = await tryExec(sql);
  ck('the migration applies cleanly', first.ok, first.message);
  const again = await tryExec(sql);
  ck('and is idempotent', again.ok, again.message);
}

console.log('\n=== an unweighted paper is scored EXACTLY as it was ===');
{
  const after = (await q(`SELECT * FROM public.score_answers($1,$2::jsonb)`,
    [PAPER, JSON.stringify(ANSWERS)]))[0];
  ck('the count is unchanged',
     Number(after.score) === 2 && Number(after.total_items) === 4, JSON.stringify(after));
  ck('and the weighted sum agrees with it, because every item is worth one',
     Number(after.points_earned) === 2 && Number(after.points_total) === 4,
     JSON.stringify(after));
}
{
  const row = (await q(`SELECT score, total_items, points_earned, points_total
    FROM public.results WHERE student_id=$1`, [STU2]))[0];
  ck('a row written before 025 keeps its count',
     Number(row.score) === 2 && Number(row.total_items) === 4);
  ck('and is NOT backfilled — it falls back on screen instead of being restated',
     row.points_earned === null && row.points_total === null, JSON.stringify(row));
}

console.log('\n=== now weight the items ===');
// Q1 worth 5, Q2 worth 3, Q3 worth 2, Q4 left at 1. Same answers as before:
// right on Q1 (5) and Q3 (2) = 7, out of 5+3+2+1 = 11.
await x(`UPDATE public.questions SET marks = 5 WHERE exam_id='${PAPER}' AND question_number=1;
         UPDATE public.questions SET marks = 3 WHERE exam_id='${PAPER}' AND question_number=2;
         UPDATE public.questions SET marks = 2 WHERE exam_id='${PAPER}' AND question_number=3;`);
{
  const w = (await q(`SELECT * FROM public.score_answers($1,$2::jsonb)`,
    [PAPER, JSON.stringify(ANSWERS)]))[0];
  ck('the weighted sum follows the marks', Number(w.points_earned) === 7, JSON.stringify(w));
  ck('as does the weighted total', Number(w.points_total) === 11, JSON.stringify(w));
  ck('the COUNT is deliberately untouched by reweighting — it is a different fact',
     Number(w.score) === 2 && Number(w.total_items) === 4, JSON.stringify(w));
  ck('each answered item carries what it was worth',
     Number(w.answers_json[qid(1)].marks) === 5 && Number(w.answers_json[qid(2)].marks) === 3,
     JSON.stringify(w.answers_json));
  ck('a blank item is still absent rather than recorded as wrong',
     w.answers_json[qid(4)] === undefined);
}

console.log('\n=== submitting records both ===');
{
  const out = (await q(`SELECT public.submit_assessment($1,$2,$3::jsonb,120,0,'[]'::jsonb) AS r`,
    [STU, PAPER, JSON.stringify(ANSWERS)]))[0].r;
  ck('the returned object carries the count and the points',
     Number(out.score) === 2 && Number(out.points_earned) === 7 && Number(out.points_total) === 11,
     JSON.stringify(out));
  const row = (await q(`SELECT score, total_items, points_earned, points_total
    FROM public.results WHERE student_id=$1 AND assessment_id=$2`, [STU, PAPER]))[0];
  ck('and so does the stored row',
     Number(row.score) === 2 && Number(row.total_items) === 4
     && Number(row.points_earned) === 7 && Number(row.points_total) === 11,
     JSON.stringify(row));
}

console.log('\n=== a worked item is still weighed separately ===');
// 024 keeps worked items out of score_answers() because they cannot be marked
// in Postgres at all. Adding one must not change the picked-item totals.
await x(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choices, marks, work_given, work_variable, work_rubric)
  VALUES ('${PAPER}','${PAPER}',5,'Differentiate','worked_solution','[]'::jsonb,3,'y=5x','x',
    '{"steps":[{"latex":"y=5","marks":3}]}'::jsonb);`);
{
  const w = (await q(`SELECT * FROM public.score_answers($1,$2::jsonb)`,
    [PAPER, JSON.stringify(ANSWERS)]))[0];
  ck('the worked item joins essays in being excluded',
     Number(w.points_total) === 11 && Number(w.total_items) === 4, JSON.stringify(w));
}

console.log('\n=== answer review says what each item was worth ===');
{
  await x(`UPDATE public.assessments SET show_answers = true WHERE id='${PAPER}'`);
  const review = (await q(`SELECT public.get_answer_review($1,$2,NULL) AS r`, [STU, PAPER]))[0].r;
  const q1 = review.find(i => Number(i.question_number) === 1);
  ck('a five-point item says so', q1 && Number(q1.marks) === 5, JSON.stringify(q1));
  ck('and the worked item is not on the review at all',
     !review.some(i => i.question_type === 'worked_solution'));
}

console.log('\n=== the key is still withheld ===');
{
  const grants = await q(`SELECT column_name FROM information_schema.column_privileges
    WHERE grantee='anon' AND table_name='questions' AND privilege_type='SELECT'`);
  const names = grants.map(g => g.column_name);
  ck('no key column is readable by anon',
     !names.includes('correct_answer') && !names.includes('correct_answers')
     && !names.includes('work_rubric'), names.join(', '));
  const ex = await q(`SELECT grantee FROM information_schema.routine_privileges
    WHERE routine_name='score_answers'`);
  ck('and anon cannot mark a paper itself',
     !ex.some(r => r.grantee === 'anon'), JSON.stringify(ex));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
