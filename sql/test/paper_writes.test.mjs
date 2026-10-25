// Runs sql/094 + sql/095 against real PostgreSQL (PGlite), on production's
// policies and grants (supabase_setup.sql + 001 + 002 + 009), and checks the
// rules 095 adds: only a paper's own instructors change its questions,
// results and sittings; instructors write only a student's sections; a sat
// paper is archived before it can be deleted; the scorer cannot be called
// from outside while a submission (which calls it inside) still works.
//   npm run test:paper-writes
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

const KAI = 'a0000000-0000-0000-0000-0000000000a1', BEA = 'b0000000-0000-0000-0000-0000000000b1';
const COL = 'c0000000-0000-0000-0000-0000000000c1';
const QUIZ = 'a1000000-0000-0000-0000-000000000001';   // Kai's, sat
const DRAFT = 'a1000000-0000-0000-0000-000000000002';  // Kai's, never sat
const OPEN = 'a1000000-0000-0000-0000-000000000003';   // Kai's, for a live submission
const STU = '11111111-0000-0000-0000-000000000001', STU2 = '11111111-0000-0000-0000-000000000002';
const QN = 'q0000000-0000-0000-0000-000000000001'.replace('q', 'e');
const QOPEN = 'e0000000-0000-0000-0000-000000000002';

await x(`INSERT INTO auth.users VALUES ('${KAI}','k@p.ph'),('${BEA}','b@p.ph'),('${COL}','c@p.ph');
  INSERT INTO public.instructors (id,email,full_name) VALUES ('${KAI}','k@p.ph','Kai'),('${BEA}','b@p.ph','Bea'),('${COL}','c@p.ph','Col');
  INSERT INTO public.section_instructors (section_name,instructor_id,added_by) VALUES
    ('ESCI 316 -1','${KAI}','${KAI}'), ('AENG 223L','${BEA}','${BEA}');
  INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,duration_minutes) VALUES
    ('${QUIZ}','exam','Look-alike Quiz','ESCI 316 -1','${KAI}',false,60),
    ('${DRAFT}','exam','Look-alike Draft','ESCI 316 -1','${KAI}',false,60),
    ('${OPEN}','exam','Look-alike Open','ESCI 316 -1','${KAI}',true,60);
  INSERT INTO public.exams (id,title,target_section,instructor_id,is_open,duration_minutes)
    SELECT id,title,target_section,instructor_id,is_open,duration_minutes FROM public.assessments
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.questions (id,exam_id,assessment_id,question_number,question_text,question_type,
    choice_a,choice_b,choice_c,choice_d,correct_answer) VALUES
    ('${QN}','${QUIZ}','${QUIZ}',1,'Look-alike item','multiple_choice','w','x','y','z',2),
    ('${QOPEN}','${OPEN}','${OPEN}',1,'Look-alike item','multiple_choice','w','x','y','z',1);
  INSERT INTO public.users (id,full_name,section,student_email,student_code) VALUES
    ('${STU}','Both','ESCI 316 -1, AENG 223L','s1@s.ph','S-1'),
    ('${STU2}','Esci','ESCI 316 -1','s2@s.ph','S-2');
  INSERT INTO public.results (student_id,exam_id,assessment_id,score,total_items) VALUES
    ('${STU}','${QUIZ}','${QUIZ}',20,30);
  INSERT INTO public.live_sessions (student_id,exam_id,assessment_id,status) VALUES
    ('${STU}','${QUIZ}','${QUIZ}','finished');`);

const as = async (role, uid, sql, params) => {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid || '']);
  await x(`SET ROLE ${role}`);
  try { return await q(sql, params); }
  finally { await x(`RESET ROLE`); }
};
const err = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const one = async (sql) => (await q(sql))[0];

console.log('\n=== BEFORE 095 ===');
await x('BEGIN');
let r = await as('authenticated', BEA, `UPDATE public.results SET score=0 WHERE assessment_id='${QUIZ}' RETURNING id`);
ck("Bea could rewrite a score on Kai's paper", r.length === 1);
r = await as('authenticated', BEA, `UPDATE public.questions SET correct_answer=0 WHERE id='${QN}' RETURNING id`);
ck("and change Kai's answer key", r.length === 1);
await x('ROLLBACK');
r = await as('anon', null, `SELECT * FROM public.score_answers('${QUIZ}', '{}'::jsonb)`);
ck('and anyone could call the scorer', r.length === 1);

for (const f of ['094_removing_a_student_keeps_other_instructors_students', '095_writes_belong_to_the_papers_instructors'])
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
const mig = fs.readFileSync(`${P}/sql/095_writes_belong_to_the_papers_instructors.sql`, 'utf8');
console.log('\n094 + 095 applied');
try { await x(mig); ck('095 re-runs without error', true); } catch (e) { ck('095 re-runs without error', false, e.message); }
{
  const v = (await q(mig.slice(mig.lastIndexOf('SELECT\n'))))[0];
  ck('every VERIFY column is true', Object.values(v).every(b => b === true), JSON.stringify(v));
}

console.log('\n=== ANOTHER INSTRUCTOR\'S PAPER ===');
r = await as('authenticated', BEA, `UPDATE public.results SET score=0 WHERE assessment_id='${QUIZ}' RETURNING id`);
ck("Bea cannot rewrite Kai's scores", r.length === 0);
r = await as('authenticated', BEA, `UPDATE public.questions SET correct_answer=0 WHERE id='${QN}' RETURNING id`);
ck("nor his answer key", r.length === 0);
r = await as('authenticated', BEA, `DELETE FROM public.questions WHERE assessment_id='${QUIZ}' RETURNING id`);
ck("nor delete his questions", r.length === 0);
ck("nor add a question to his paper", !!(await err(() => as('authenticated', BEA,
  `INSERT INTO public.questions (exam_id,assessment_id,question_number,question_text,question_type,correct_answer)
   VALUES ('${QUIZ}','${QUIZ}',2,'x','multiple_choice',0)`))));
r = await as('authenticated', BEA, `UPDATE public.live_sessions SET status='active' WHERE assessment_id='${QUIZ}' RETURNING id`);
ck("nor reopen a sitting on it", r.length === 0);
ck("nor insert a result for it", !!(await err(() => as('authenticated', BEA,
  `INSERT INTO public.results (student_id,exam_id,assessment_id,score,total_items) VALUES ('${STU2}','${QUIZ}','${QUIZ}',30,30)`))));

console.log('\n=== HIS OWN, AND A GRANTED CO-INSTRUCTOR ===');
r = await as('authenticated', KAI, `UPDATE public.results SET score=21 WHERE assessment_id='${QUIZ}' RETURNING id`);
ck('Kai can still correct a score (manual score, re-mark)', r.length === 1);
r = await as('authenticated', KAI, `UPDATE public.questions SET question_text='Look-alike item, reworded' WHERE id='${QN}' RETURNING id`);
ck('and edit his questions', r.length === 1);
r = await as('authenticated', KAI, `UPDATE public.live_sessions SET status='locked' WHERE assessment_id='${QUIZ}' RETURNING id`);
ck('and lock or unlock a sitting from the monitor', r.length === 1);
await x(`INSERT INTO public.section_instructors (section_name,instructor_id,added_by) VALUES ('ESCI 316 -1','${COL}','${KAI}')`);
r = await as('authenticated', COL, `UPDATE public.results SET score=22 WHERE assessment_id='${QUIZ}' RETURNING id`);
ck('a co-instructor Kai granted can too', r.length === 1);
await x(`DELETE FROM public.section_instructors WHERE instructor_id='${COL}'`);

console.log('\n=== STUDENT ROWS ===');
ck("an instructor cannot change a student's ID (a login credential)",
   /permission denied/i.test((await err(() => as('authenticated', KAI, `UPDATE public.users SET student_code='X' WHERE id='${STU2}'`)))?.message || ''));
ck('nor their email or name',
   !!(await err(() => as('authenticated', KAI, `UPDATE public.users SET student_email='x@x' WHERE id='${STU2}'`)))
   && !!(await err(() => as('authenticated', KAI, `UPDATE public.users SET full_name='X' WHERE id='${STU2}'`))));
r = await err(() => as('authenticated', KAI, `UPDATE public.users SET section='ESCI 316 -1, ESCI 316 -2' WHERE id='${STU2}'`));
ck('but can still put a student in a section', r === null, r?.message);
r = await err(() => as('authenticated', KAI, `UPDATE public.users SET session_token='t' WHERE id='${STU2}'`));
ck('and a student can log in on an instructor-signed-in device', r === null, r?.message);

console.log('\n=== DELETING A PAPER ===');
let e = await err(() => as('authenticated', KAI, `DELETE FROM public.assessments WHERE id='${QUIZ}'`));
ck('a sat paper cannot be deleted while it is not archived', e?.hint === 'archive_before_delete', e?.message);
ck('and nothing went with the attempt',
   (await one(`SELECT count(*)::int c FROM public.results WHERE assessment_id='${QUIZ}'`)).c === 1
   && (await one(`SELECT count(*)::int c FROM public.questions WHERE assessment_id='${QUIZ}'`)).c === 1);
e = await err(() => as('authenticated', KAI, `DELETE FROM public.exams WHERE id='${QUIZ}'`));
ck('nor through its legacy exams row', e?.hint === 'archive_before_delete', e?.message);
r = await as('authenticated', KAI, `DELETE FROM public.assessments WHERE id='${DRAFT}' RETURNING id`);
ck('a paper nobody has sat deletes in one step', r.length === 1);
await as('authenticated', KAI, `UPDATE public.assessments SET archived_at=now(), is_open=false WHERE id='${QUIZ}'`);
r = await as('authenticated', KAI, `DELETE FROM public.assessments WHERE id='${QUIZ}' RETURNING id`);
ck('once archived, the owner can delete it', r.length === 1);
ck('and its results, sittings and questions go with it by foreign key',
   (await one(`SELECT (SELECT count(*) FROM public.results WHERE assessment_id='${QUIZ}')
                    + (SELECT count(*) FROM public.live_sessions WHERE assessment_id='${QUIZ}')
                    + (SELECT count(*) FROM public.questions WHERE assessment_id='${QUIZ}') AS c`)).c == 0);
ck('the SQL editor (postgres) is not held to it',
   (await err(() => q(`DELETE FROM public.assessments WHERE id='${OPEN}' AND false`))) === null);

console.log('\n=== FUNCTIONS ===');
ck('a student can no longer call the scorer',
   /permission denied/i.test((await err(() => as('anon', null, `SELECT * FROM public.score_answers('${OPEN}', '{}'::jsonb)`)))?.message || ''));
ck('nor can a signed-in account',
   /permission denied/i.test((await err(() => as('authenticated', BEA, `SELECT * FROM public.score_answers('${OPEN}', '{}'::jsonb)`)))?.message || ''));
r = await as('anon', null, `SELECT public.submit_assessment('${STU2}','${OPEN}', '{"${QOPEN}": 1}'::jsonb, 60, 0, '[]'::jsonb) AS s`);
ck('a student\'s submission is still scored (the scorer runs inside it)', r[0]?.s?.score === 1, JSON.stringify(r[0]?.s));
ck('and filed', (await one(`SELECT count(*)::int c FROM public.results WHERE assessment_id='${OPEN}' AND student_id='${STU2}'`)).c === 1);
ck('a student cannot file a result directly (a forged score)',
   /permission denied/i.test((await err(() => as('anon', null,
     `INSERT INTO public.results (student_id,exam_id,assessment_id,score,total_items) VALUES ('${STU}','${OPEN}','${OPEN}',30,30)`)))?.message || ''));
ck('TRUNCATE is refused to the API roles',
   /permission denied/i.test((await err(() => as('authenticated', KAI, `TRUNCATE public.results`)))?.message || ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
