// Runs 001 + 002 + 003 + 012 against real PostgreSQL (PGlite) on a replica of
// the production schema, and asserts what 012 has to get right: a fifth choice
// that four-choice papers do not notice, a key that may point at it but never
// at nothing, the answer-key grant still withholding correct_answer, review and
// duplication carrying the new column, and the per-paper shuffle switch.
//   npm run test:five-option
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
const fails = async (sql, params) => {
  try { await q(sql, params); return null; } catch (e) { return e.message || String(e); }
};

await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;`);
const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);

const INS = 'd24df77e-309a-4ed8-988f-da3ee1c76408';
const STU = '11111111-1111-1111-1111-111111111111';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.users (id, full_name, section) VALUES ('${STU}','S One','AENG 426');`);

await x(fs.readFileSync(P + '/sql/001_assessments_and_lessons.sql', 'utf8'));
await x(fs.readFileSync(P + '/sql/002_review_mode_and_server_scoring.sql', 'utf8'));
await x(fs.readFileSync(P + '/sql/003_lock_answer_key.sql', 'utf8'));
console.log('001 + 002 + 003 applied\n');

// A four-choice paper that existed before 012, to prove it is untouched by it.
const OLD = '67d25e6e-a4d7-45eb-96d2-01bb22241274';
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id,
           is_open, duration_minutes, show_answers, allow_retakes)
         VALUES ('${OLD}','exam','Legacy four-choice','AENG 426','${INS}',true,60,true,true);
  INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choice_a, choice_b, choice_c, choice_d, correct_answer)
  VALUES ('${OLD}','${OLD}',1,'Old item','multiple_choice','w','x','y','z',2);`);

console.log('=== BEFORE 012 ===');
{
  const e = await fails(`SELECT choice_e FROM public.questions LIMIT 1`);
  ck('choice_e does not exist yet', !!e && /choice_e/.test(e));
  const k = await fails(`UPDATE public.questions SET correct_answer = 4 WHERE exam_id = $1`, [OLD]);
  ck('a key of 4 is rejected by the old 0..3 constraint', !!k, (k || '').slice(0, 60));
}

const SQL = fs.readFileSync(P + '/sql/012_five_option_items.sql', 'utf8');
await x(SQL);
console.log('\n012 applied\n');

console.log('=== THE COLUMN AND THE SWITCH ===');
{
  const c = await q(`SELECT column_name, is_nullable, data_type FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='questions' AND column_name='choice_e'`);
  ck('questions.choice_e exists and is nullable',
     c.length === 1 && c[0].is_nullable === 'YES', JSON.stringify(c));
  const s = await q(`SELECT column_name, column_default, is_nullable FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='assessments' AND column_name='shuffle_choices'`);
  ck('assessments.shuffle_choices exists, NOT NULL, defaulting true',
     s.length === 1 && s[0].is_nullable === 'NO' && /true/.test(s[0].column_default || ''),
     JSON.stringify(s));
  const old = await q(`SELECT shuffle_choices FROM public.assessments WHERE id = $1`, [OLD]);
  ck('a paper that existed before 012 keeps shuffling', old[0].shuffle_choices === true);
  const oldq = await q(`SELECT choice_e, correct_answer FROM public.questions WHERE exam_id = $1`, [OLD]);
  ck('a four-choice item is untouched: choice_e NULL, key unchanged',
     oldq[0].choice_e === null && oldq[0].correct_answer === 2);
}

console.log('\n=== THE KEY MAY POINT AT E, BUT NEVER AT NOTHING ===');
{
  const NEW = '9f000000-0000-4000-8000-00000000000e';
  await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id,
             is_open, duration_minutes, show_answers, allow_retakes, shuffle_choices)
           VALUES ('${NEW}','exam','Five-choice paper','AENG 426','${INS}',true,60,true,true,false);`);
  await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
             question_type, choice_a, choice_b, choice_c, choice_d, choice_e, correct_answer)
           VALUES ($1,$1,1,'Five item','multiple_choice','v','w','x','y','z',4)`, [NEW]);
  const r = await q(`SELECT choice_e, correct_answer FROM public.questions WHERE exam_id=$1`, [NEW]);
  ck('an item may be keyed to E when choice_e is present',
     r[0].choice_e === 'z' && r[0].correct_answer === 4);

  const e1 = await fails(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
      question_text, question_type, choice_a, choice_b, choice_c, choice_d, correct_answer)
      VALUES ($1,$1,2,'No E','multiple_choice','a','b','c','d',4)`, [NEW]);
  ck('a key of E with no choice E is rejected', !!e1, (e1 || '').slice(0, 70));

  const e2 = await fails(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
      question_text, question_type, choice_a, choice_b, choice_c, choice_d, choice_e, correct_answer)
      VALUES ($1,$1,3,'Six','multiple_choice','a','b','c','d','e',5)`, [NEW]);
  ck('a key of 5 is still out of range', !!e2, (e2 || '').slice(0, 70));

  ck('the switch can be set false on a paper',
     (await q(`SELECT shuffle_choices FROM public.assessments WHERE id=$1`, [NEW]))[0].shuffle_choices === false);
}

console.log('\n=== THE ANSWER KEY IS STILL WITHHELD ===');
{
  const g = await q(`SELECT string_agg(column_name, ',' ORDER BY column_name) AS cols
                     FROM information_schema.column_privileges
                     WHERE grantee='anon' AND table_name='questions' AND privilege_type='SELECT'`);
  const cols = (g[0].cols || '').split(',');
  ck('anon may read choice_e', cols.includes('choice_e'), g[0].cols);
  ck('anon still may NOT read correct_answer', !cols.includes('correct_answer'), g[0].cols);
  ck('anon may read the four original choices',
     ['choice_a', 'choice_b', 'choice_c', 'choice_d'].every(c => cols.includes(c)));
  const s = await q(`SELECT string_agg(column_name, ',' ORDER BY column_name) AS cols
                     FROM information_schema.column_privileges
                     WHERE grantee='anon' AND table_name='assessments' AND privilege_type='SELECT'`);
  ck('anon may read shuffle_choices', (s[0].cols || '').split(',').includes('shuffle_choices'), s[0].cols);
}

console.log('\n=== MARKING ===');
{
  const [{ id }] = await q(`SELECT id FROM public.questions WHERE correct_answer = 4 LIMIT 1`);
  const paper = (await q(`SELECT assessment_id a FROM public.questions WHERE id=$1`, [id]))[0].a;
  const right = await q(`SELECT * FROM public.score_answers($1,$2::jsonb)`,
                        [paper, JSON.stringify({ [id]: 4 })]);
  ck('score_answers marks a key of E correct', right[0].score === 1, `${right[0].score}`);
  const wrong = await q(`SELECT * FROM public.score_answers($1,$2::jsonb)`,
                        [paper, JSON.stringify({ [id]: 0 })]);
  ck('and marks another choice wrong', wrong[0].score === 0, `${wrong[0].score}`);
}

console.log('\n=== ANSWER REVIEW SHOWS THE RIGHT NUMBER OF CHOICES ===');
{
  // Four-choice paper: the array must still be four long, or every index in
  // the review UI shifts and the wrong option is highlighted.
  await q(`INSERT INTO public.results (student_id, exam_id, assessment_id, score, total_items, answers_json)
           SELECT $1,$2,$2,1,1, jsonb_build_object(q.id::text, jsonb_build_object('chosen',2,'is_correct',true))
           FROM public.questions q WHERE q.exam_id=$2`, [STU, OLD]);
  const a = await q(`SELECT public.get_answer_review($1,$2,NULL) AS j`, [STU, OLD]);
  const four = a[0].j[0];
  ck('a four-choice item reviews with exactly four choices',
     Array.isArray(four.choices) && four.choices.length === 4, JSON.stringify(four.choices));
  ck('and its indices are unchanged (correct = 2 is the third option)',
     four.correct === 2 && four.choices[2] === 'y');

  const NEW = '9f000000-0000-4000-8000-00000000000e';
  await q(`INSERT INTO public.results (student_id, exam_id, assessment_id, score, total_items, answers_json)
           SELECT $1,$2,$2,1,1, jsonb_build_object(q.id::text, jsonb_build_object('chosen',4,'is_correct',true))
           FROM public.questions q WHERE q.exam_id=$2 AND q.correct_answer=4`, [STU, NEW]);
  const b = await q(`SELECT public.get_answer_review($1,$2,NULL) AS j`, [STU, NEW]);
  const five = b[0].j.find(r => r.correct === 4);
  ck('a five-choice item reviews with five choices',
     five && five.choices.length === 5, JSON.stringify(five?.choices));
  ck('and the fifth is the one the key points at',
     five && five.choices[4] === 'z' && five.chosen === 4);
}

console.log('\n=== DUPLICATING A PAPER CARRIES BOTH ===');
{
  const NEW = '9f000000-0000-4000-8000-00000000000e';
  await x(`SET LOCAL test.uid = '${INS}';`);
  await q(`SET test.uid = '${INS}'`);
  const [{ copy }] = await q(
    `SELECT public.duplicate_assessment($1,'Copy of five','AENG 426',true,true,'latest') AS copy`, [NEW]);
  const c = await q(`SELECT shuffle_choices FROM public.assessments WHERE id=$1`, [copy]);
  ck('the copy keeps shuffle_choices = false', c[0].shuffle_choices === false);
  const qs = await q(`SELECT choice_e, correct_answer FROM public.questions
                      WHERE assessment_id=$1 AND correct_answer=4`, [copy]);
  ck('the copy keeps choice_e and its key', qs.length === 1 && qs[0].choice_e === 'z',
     JSON.stringify(qs));
}

console.log('\n=== IDEMPOTENCY ===');
{
  await x(SQL);
  await x(SQL);
  const c = await q(`SELECT count(*)::int n FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='questions' AND column_name='choice_e'`);
  ck('re-running 012 twice more changes nothing', c[0].n === 1);
  const still = await q(`SELECT correct_answer, choice_e FROM public.questions WHERE exam_id=$1`, [OLD]);
  ck('and the legacy four-choice item is still untouched',
     still[0].correct_answer === 2 && still[0].choice_e === null);
}

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
