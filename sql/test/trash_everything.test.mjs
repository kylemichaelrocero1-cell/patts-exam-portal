// Runs sql/139 against real PostgreSQL (PGlite), on top of 104 and the rules
// it builds on. A result, a question or a lesson goes to the Trash rather than
// being deleted at the first click, comes back as it was, and is gone only
// after 30 days. What 104 did for papers and students keeps working.
//   npm run test:trash-all
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

await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`);
const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);
await x(setup.slice(setup.indexOf('ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY'),
                    setup.indexOf('-- 6. REALTIME')));
for (const f of ['001_assessments_and_lessons', '002_review_mode_and_server_scoring',
                 '009_section_ownership', '015_archive_assessments'])
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
// Supabase grants the API roles every table by default; production has it.
await x(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;`);
for (const f of ['094_removing_a_student_keeps_other_instructors_students',
                 '095_writes_belong_to_the_papers_instructors',
                 '104_deletes_wait_thirty_days_in_trash'])
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));

// Look-alike people and papers, not the real ones.
const KAI = 'a0000000-0000-0000-0000-0000000000a1';   // owns the quiz
const BEA = 'b0000000-0000-0000-0000-0000000000b1';   // teaches something else
const COL = 'c0000000-0000-0000-0000-0000000000c1';   // the quiz is shared with them
const QUIZ = 'a1000000-0000-0000-0000-000000000001';
const STU = '11111111-0000-0000-0000-000000000001';
const STU2 = '11111111-0000-0000-0000-000000000002';
const Q1 = 'f1000000-0000-0000-0000-000000000001';
const Q2 = 'f1000000-0000-0000-0000-000000000002';
const Q3 = 'f1000000-0000-0000-0000-000000000003';
const OTHER_Q = 'f2000000-0000-0000-0000-000000000001';
const OTHER = 'b1000000-0000-0000-0000-000000000001';
const LESSON = 'e1000000-0000-0000-0000-000000000001';
const SUBJECT = 'e2000000-0000-0000-0000-000000000001';

await x(`INSERT INTO auth.users VALUES ('${KAI}','k@p.ph'),('${BEA}','b@p.ph'),('${COL}','c@p.ph');
  INSERT INTO public.instructors (id,email,full_name) VALUES
    ('${KAI}','k@p.ph','Kai'),('${BEA}','b@p.ph','Bea'),('${COL}','c@p.ph','Col');
  INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,duration_minutes) VALUES
    ('${QUIZ}','exam','Look-alike Quiz','AERO 101','${KAI}',false,60),
    ('${OTHER}','exam','Bea Quiz','AENG 1','${BEA}',false,60);
  INSERT INTO public.exams (id,title,target_section,instructor_id,is_open,duration_minutes)
    SELECT id,title,target_section,instructor_id,is_open,duration_minutes FROM public.assessments;
  INSERT INTO public.exam_shares (exam_id,shared_by,shared_with) VALUES ('${QUIZ}','${KAI}','${COL}');
  INSERT INTO public.users (id,full_name,section,student_email,student_code) VALUES
    ('${STU}','Test Student','AERO 101','s@s.ph','S-1'),('${STU2}','Second Student','AERO 101','t@s.ph','S-2');
  INSERT INTO public.results (student_id,exam_id,assessment_id,score,total_items,answers_json,tab_switches,submitted_at) VALUES
    ('${STU}','${QUIZ}','${QUIZ}',20,30,'{"q":1}',2,'2026-10-01T02:00:00Z'),
    ('${STU2}','${QUIZ}','${QUIZ}',10,30,'{}',0,'2026-10-01T02:00:00Z');
  INSERT INTO public.questions (id,exam_id,assessment_id,question_number,question_text,correct_answer) VALUES
    ('${Q1}','${QUIZ}','${QUIZ}',1,'What lifts a wing?',0),
    ('${Q2}','${QUIZ}','${QUIZ}',2,'What turns a rudder?',1),
    ('${Q3}','${QUIZ}','${QUIZ}',3,'What stalls a wing?',2),
    ('${OTHER_Q}','${OTHER}','${OTHER}',1,'Not on this paper',0);
  INSERT INTO public.lesson_subjects (id,title,instructor_id) VALUES ('${SUBJECT}','Aerodynamics','${KAI}');
  INSERT INTO public.lessons (id,subject_id,title,content_md,target_section,instructor_id,is_published) VALUES
    ('${LESSON}','${SUBJECT}','Lift','Text','AERO 101','${KAI}',true);
  INSERT INTO public.lesson_progress (student_id,lesson_id,completed_at) VALUES ('${STU}','${LESSON}',now());`);

const as = async (role, uid, sql, params) => {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid || '']);
  await x(`SET ROLE ${role}`);
  try { return await q(sql, params); }
  finally { await x(`RESET ROLE`); }
};
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const count = async (table, where = 'true') => Number((await q(`SELECT count(*) n FROM public.${table} WHERE ${where}`))[0].n);
const trashResult = (uid, stu = STU) => as('authenticated', uid, `SELECT public.trash_result('${stu}','${QUIZ}') AS o`).then(r => r[0].o);
const trashQs = (uid, ids) => as('authenticated', uid,
  `SELECT public.trash_questions('${QUIZ}', ${ids ? `ARRAY[${ids.map(i => `'${i}'`).join(',')}]::uuid[]` : 'NULL'}) AS o`).then(r => r[0].o);
const trashLesson = (uid) => as('authenticated', uid, `SELECT public.trash_lesson('${LESSON}') AS o`).then(r => r[0].o);
const entry = async (kind) => (await q(`SELECT * FROM public.trash WHERE kind=$1 ORDER BY trashed_at DESC`, [kind]))[0];
const restore = async (uid, id) => (await as('authenticated', uid, `SELECT * FROM public.restore_from_trash(ARRAY['${id}']::uuid[])`))[0]?.outcome;
const backdate = (where) => x(`UPDATE public.trash SET purge_after = now() - interval '1 minute' WHERE ${where}`);

const mig = fs.readFileSync(P + '/sql/139_every_delete_goes_to_the_trash.sql', 'utf8');
await x(mig);
console.log('\n139 applied');
try { await x(mig); ck('re-runs without error', true); }
catch (e) { ck('re-runs without error', false, e.message); }

console.log('\n=== VERIFY ===');
{
  const v = (await q(mig.slice(mig.lastIndexOf('SELECT\n'))))[0];
  ck('every VERIFY column is true', Object.values(v).every(b => b === true), JSON.stringify(v));
}

console.log('\n=== NOTHING IS DELETED ON THE SPOT ===');
for (const [t, w] of [['results', `student_id='${STU}'`], ['questions', `id='${Q1}'`], ['lessons', `id='${LESSON}'`]]) {
  ck(`an instructor can no longer DELETE from ${t}`,
     /permission denied/i.test(await fails(() => as('authenticated', KAI, `DELETE FROM public.${t} WHERE ${w}`)) || ''));
}
ck('nothing went', await count('results') === 2 && await count('questions') === 4 && await count('lessons') === 1);
for (const fn of [`trash_result('${STU}','${QUIZ}')`, `trash_questions('${QUIZ}')`, `trash_lesson('${LESSON}')`]) {
  ck(`a student cannot call ${fn.split('(')[0]}`,
     /permission denied/i.test(await fails(() => as('anon', null, `SELECT public.${fn}`)) || ''));
}
ck('a student cannot read a copy in the Trash',
   /permission denied/i.test(await fails(() => as('anon', null, `SELECT snapshot FROM public.trash`)) || ''));

console.log('\n=== A RESULT ===');
ck("another instructor cannot trash it", await trashResult(BEA) === 'not_yours');
ck('and it stays', await count('results', `student_id='${STU}'`) === 1);
ck('its instructor can', await trashResult(KAI) === 'trashed');
ck('it leaves results, so the student can sit again', await count('results', `student_id='${STU}'`) === 0);
{
  const t = await entry('result');
  ck('filed under the student, with the paper and the score', t.label === 'Test Student'
     && t.detail.paper_title === 'Look-alike Quiz' && t.detail.score === 20 && t.detail.total_items === 30, JSON.stringify(t.detail));
  ck('the answers wait in the copy, not the list', t.snapshot.answers_json.q === 1 && t.detail.answers_json === undefined);
  ck('held for 30 days', Math.abs(new Date(t.purge_after) - Date.now() - 30 * 864e5) < 60000);

  const shared = await as('authenticated', COL, `SELECT id FROM public.trash WHERE kind='result'`);
  ck('whoever else teaches the paper can see it', shared.length === 1);
  const stranger = await as('authenticated', BEA, `SELECT id FROM public.trash WHERE kind='result'`);
  ck('an instructor of another paper cannot', stranger.length === 0);
  ck('nor restore it', await restore(BEA, t.id) === 'not_yours' && await count('trash', `id='${t.id}'`) === 1);

  // The student sits again: the old score must not overwrite the new one.
  await x(`INSERT INTO public.results (student_id,exam_id,assessment_id,score,total_items) VALUES ('${STU}','${QUIZ}','${QUIZ}',28,30)`);
  ck('a student who has sat again is not overwritten', await restore(KAI, t.id) === 'taken');
  ck('the newer score stands and the entry stays',
     (await q(`SELECT score FROM public.results WHERE student_id='${STU}'`))[0].score === 28 && await count('trash', `id='${t.id}'`) === 1);
  await x(`DELETE FROM public.results WHERE student_id='${STU}'`);

  ck('with the way clear, a colleague can restore it', await restore(COL, t.id) === 'restored');
  const [r] = await q(`SELECT * FROM public.results WHERE student_id='${STU}'`);
  ck('it comes back exactly as it was', r.score === 20 && r.tab_switches === 2 && r.answers_json.q === 1
     && new Date(r.submitted_at).toISOString() === '2026-10-01T02:00:00.000Z', JSON.stringify(r));
  ck('and leaves the Trash', await count('trash', `id='${t.id}'`) === 0);
}
ck('a result already gone says so', await trashResult(KAI, 'dddddddd-0000-0000-0000-000000000000') === 'gone');

console.log('\n=== QUESTIONS ===');
ck('another instructor cannot trash them', await trashQs(BEA, [Q1]) === 'not_yours');
ck('one question goes', await trashQs(KAI, [Q1]) === 'trashed' && await count('questions', `id='${Q1}'`) === 0);
{
  const t = await entry('question');
  ck('filed under its text', t.label === 'What lifts a wing?' && t.detail.count === 1, JSON.stringify(t));
  ck('restored with the same id, so answers still line up',
     await restore(KAI, t.id) === 'restored' && await count('questions', `id='${Q1}' AND correct_answer=0`) === 1);
}
ck('an id from another paper is not touched', await trashQs(KAI, [OTHER_Q]) === 'gone' && await count('questions', `id='${OTHER_Q}'`) === 1);
ck('a CSV replace moves the whole paper', await trashQs(KAI, null) === 'trashed' && await count('questions', `exam_id='${QUIZ}'`) === 0);
ck('leaving the other paper alone', await count('questions', `id='${OTHER_Q}'`) === 1);
{
  const t = await entry('question');
  ck('as one entry', t.label === '3 questions' && t.detail.count === 3, JSON.stringify(t.detail));
  // The replacement arrives; the old ones can still come back beside it.
  await x(`INSERT INTO public.questions (exam_id,assessment_id,question_number,question_text,correct_answer)
           VALUES ('${QUIZ}','${QUIZ}',1,'A replacement',0)`);
  ck('all three come back', await restore(KAI, t.id) === 'restored' && await count('questions', `exam_id='${QUIZ}'`) === 4);
}

console.log('\n=== A LESSON ===');
ck('another instructor cannot trash it', await trashLesson(BEA) === 'not_yours');
ck('its owner can', await trashLesson(KAI) === 'trashed');
ck('students lose it', await count('lessons') === 0 && await count('lesson_progress') === 0);
{
  const t = await entry('lesson');
  ck('filed under its title', t.label === 'Lift');
  ck('with its read progress', t.snapshot.progress.length === 1, JSON.stringify(t.snapshot.progress));
  await x(`DELETE FROM public.lesson_subjects WHERE id='${SUBJECT}'`);
  ck('a colleague cannot restore it', await restore(COL, t.id) === 'not_yours');
  ck('its owner can, though its subject has gone', await restore(KAI, t.id) === 'restored');
  const [l] = await q(`SELECT * FROM public.lessons WHERE id='${LESSON}'`);
  ck('it comes back, published, with no subject', l?.title === 'Lift' && l.is_published === true && l.subject_id === null, JSON.stringify(l));
  ck('with what the student had read', await count('lesson_progress', `student_id='${STU}' AND lesson_id='${LESSON}' AND completed_at IS NOT NULL`) === 1);
}

console.log('\n=== AFTER 30 DAYS ===');
await trashResult(KAI);
await trashQs(KAI, [Q2]);
await trashLesson(KAI);
await as('authenticated', KAI, `SELECT public.purge_expired_trash()`);
ck('nothing goes early', await count('trash', `kind IN ('result','question','lesson')`) === 3);
await backdate(`kind IN ('result','question','lesson')`);
await as('authenticated', KAI, `SELECT public.purge_expired_trash()`);
ck('then the copies go', await count('trash', `kind IN ('result','question','lesson')`) === 0);
ck('a result id is never mistaken for a student', await count('users', `id='${STU}'`) === 1);
ck('other results, questions and students stay',
   await count('results', `student_id='${STU2}'`) === 1 && await count('questions', `id='${Q3}'`) === 1);

console.log('\n=== THE PAPER GOES FIRST ===');
{
  await trashResult(KAI, STU2);
  await trashQs(KAI, [Q3]);
  const scoreId = (await entry('result')).id, qId = (await entry('question')).id;
  await as('authenticated', KAI, `SELECT * FROM public.trash_papers(ARRAY['${QUIZ}']::uuid[])`);
  await backdate(`kind='paper'`);
  await as('authenticated', KAI, `SELECT public.purge_expired_trash()`);
  ck('the paper is deleted for good', await count('assessments', `id='${QUIZ}'`) === 0);
  ck('so a score from it says so', await restore(KAI, scoreId) === 'gone' && await count('trash', `id='${scoreId}'`) === 0);
  ck('and a question from it', await restore(KAI, qId) === 'gone' && await count('trash', `id='${qId}'`) === 0);
  ck('and nothing was written', await count('results', `student_id='${STU2}'`) === 0 && await count('questions', `id='${Q3}'`) === 0);
}

console.log('\n=== WHAT 104 DID STILL WORKS ===');
{
  const r = await as('authenticated', BEA, `SELECT * FROM public.trash_papers(ARRAY['${OTHER}']::uuid[])`);
  ck('a paper still goes to the Trash', r[0].outcome === 'trashed');
  const t = await entry('paper');
  ck('and comes back', await restore(BEA, t.id) === 'restored' && await count('trash', `id='${t.id}'`) === 0);
  await x(`INSERT INTO public.section_instructors (section_name,instructor_id,added_by) VALUES ('AERO 101','${KAI}','${KAI}')`);
  const s = await as('authenticated', KAI, `SELECT * FROM public.trash_students(ARRAY['${STU}']::uuid[])`);
  ck('a student still goes to the Trash', s[0].outcome !== 'not_yours', JSON.stringify(s));
  const u = await entry('student');
  ck('and comes back to their section', await restore(KAI, u.id) === 'restored'
     && (await q(`SELECT section FROM public.users WHERE id='${STU}'`))[0].section === 'AERO 101');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
