// Executes sql/001_assessments_and_lessons.sql against a real PostgreSQL
// (PGlite — Postgres compiled to WASM, no daemon, no Docker) on a replica of
// the production schema, then asserts the behaviour that actually carries
// risk: trigger sync, auto-fill, idempotency, constraints, cascades.
//
//   npm run test:migration
//
// Parsing the SQL only proves it is grammatical. This proves it works.

import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
const x = s => db.exec(s);
const q = async s => (await db.query(s)).rows;

let pass=0, fail=0;
const check = (name, ok, detail='') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else    { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;`);
const setup = fs.readFileSync(P+'/supabase_setup.sql','utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);
await x(`INSERT INTO auth.users VALUES ('d24df77e-309a-4ed8-988f-da3ee1c76408','i@p.ph');
  INSERT INTO public.users (id,full_name,section) VALUES ('11111111-1111-1111-1111-111111111111','S1','A');
  INSERT INTO public.exams (id,title,target_section,instructor_id,is_open,duration_minutes)
    VALUES ('67d25e6e-a4d7-45eb-96d2-01bb22241274','Math',', AENG 223L','d24df77e-309a-4ed8-988f-da3ee1c76408',true,180);
  INSERT INTO public.results (student_id,exam_id,score,total_items)
    VALUES ('11111111-1111-1111-1111-111111111111','67d25e6e-a4d7-45eb-96d2-01bb22241274',14,50);`);

const mig = fs.readFileSync(P+'/sql/001_assessments_and_lessons.sql','utf8');
await x(mig);

console.log('\n=== IDEMPOTENCY ===');
try { await x(mig); check('migration re-runs without error', true); }
catch(e){ check('migration re-runs without error', false, e.message); }
check('no duplicate assessments after re-run',
  (await q(`SELECT count(*)::int c FROM assessments`))[0].c === 1);

console.log('\n=== TRIGGER: exams -> assessments ===');
await x(`INSERT INTO public.exams (id,title,target_section,instructor_id,is_open,duration_minutes)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','Seatwork-era exam','AENG 426',
          'd24df77e-309a-4ed8-988f-da3ee1c76408',false,30);`);
let r = await q(`SELECT title,kind,duration_minutes FROM assessments WHERE id='aaaaaaaa-0000-0000-0000-000000000001'`);
check('INSERT on exams mirrors into assessments', r.length===1 && r[0].kind==='exam', JSON.stringify(r));

await x(`UPDATE public.exams SET title='Renamed', is_open=true WHERE id='aaaaaaaa-0000-0000-0000-000000000001'`);
r = await q(`SELECT title,is_open FROM assessments WHERE id='aaaaaaaa-0000-0000-0000-000000000001'`);
check('UPDATE on exams propagates', r[0].title==='Renamed' && r[0].is_open===true, JSON.stringify(r));

await x(`DELETE FROM public.exams WHERE id='aaaaaaaa-0000-0000-0000-000000000001'`);
r = await q(`SELECT 1 FROM assessments WHERE id='aaaaaaaa-0000-0000-0000-000000000001'`);
check('DELETE on exams removes the mirror', r.length===0);

console.log('\n=== TRIGGER: assessment_id auto-fill on child inserts ===');
await x(`INSERT INTO public.questions (exam_id,question_number,question_text,question_type,correct_answer)
  VALUES ('67d25e6e-a4d7-45eb-96d2-01bb22241274',2,'Q2','multiple_choice',1)`);
r = await q(`SELECT assessment_id=exam_id AS ok FROM questions WHERE question_number=2`);
check('old-code question INSERT gets assessment_id', r[0].ok===true);

await x(`INSERT INTO public.live_sessions (student_id,exam_id,student_name,status)
  VALUES ('11111111-1111-1111-1111-111111111111','67d25e6e-a4d7-45eb-96d2-01bb22241274','S1','active')`);
r = await q(`SELECT assessment_id=exam_id AS ok FROM live_sessions`);
check('old-code live_session INSERT gets assessment_id', r[0].ok===true);

console.log('\n=== CONSTRAINTS ===');
try { await x(`INSERT INTO assessments (title,kind) VALUES ('bad','quiz')`); check('kind CHECK rejects unknown kind', false); }
catch { check('kind CHECK rejects unknown kind', true); }
try { await x(`INSERT INTO assessments (title,opens_at,closes_at)
  VALUES ('bad', now(), now() - interval '1 hour')`); check('window CHECK rejects closes<opens', false); }
catch { check('window CHECK rejects closes<opens', true); }
try { await x(`INSERT INTO results (student_id,exam_id,assessment_id,score,total_items)
  VALUES ('11111111-1111-1111-1111-111111111111','67d25e6e-a4d7-45eb-96d2-01bb22241274','67d25e6e-a4d7-45eb-96d2-01bb22241274',1,1)`);
  check('duplicate (student, assessment) rejected', false); }
catch { check('duplicate (student, assessment) rejected', true); }

console.log('\n=== AVAILABILITY FUNCTION ===');
r = await q(`SELECT
  assessment_is_available(true, NULL, NULL) AS no_window,
  assessment_is_available(false, NULL, NULL) AS closed_switch,
  assessment_is_available(true, now()+interval '1 h', NULL) AS not_yet,
  assessment_is_available(true, NULL, now()-interval '1 h') AS expired,
  assessment_is_available(true, now()-interval '1 h', now()+interval '1 h') AS inside`);
const a=r[0];
check('open + no window = available', a.no_window===true);
check('is_open=false blocks even inside window', a.closed_switch===false);
check('before opens_at = unavailable', a.not_yet===false);
check('after closes_at = unavailable', a.expired===false);
check('inside window = available', a.inside===true);

console.log('\n=== LESSONS ===');
await x(`INSERT INTO lesson_subjects (id,title) VALUES ('bbbbbbbb-0000-0000-0000-000000000001','Aircraft Structures');
  INSERT INTO lessons (id,subject_id,title,content_md,is_published)
    VALUES ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Lesson 1','# Hello',true);
  INSERT INTO lesson_progress (student_id,lesson_id)
    VALUES ('11111111-1111-1111-1111-111111111111','cccccccc-0000-0000-0000-000000000001');`);
check('lesson chain inserts', (await q(`SELECT count(*)::int c FROM lesson_progress`))[0].c===1);
try { await x(`INSERT INTO lesson_progress (student_id,lesson_id)
  VALUES ('11111111-1111-1111-1111-111111111111','cccccccc-0000-0000-0000-000000000001')`);
  check('duplicate lesson_progress rejected', false); }
catch { check('duplicate lesson_progress rejected', true); }

const before = (await q(`SELECT updated_at FROM lessons WHERE id='cccccccc-0000-0000-0000-000000000001'`))[0].updated_at;
await new Promise(r=>setTimeout(r,50));
await x(`UPDATE lessons SET title='Lesson 1b' WHERE id='cccccccc-0000-0000-0000-000000000001'`);
const after = (await q(`SELECT updated_at FROM lessons WHERE id='cccccccc-0000-0000-0000-000000000001'`))[0].updated_at;
check('updated_at touch trigger fires', new Date(after) > new Date(before));

await x(`DELETE FROM lessons WHERE id='cccccccc-0000-0000-0000-000000000001'`);
check('lesson delete cascades to progress', (await q(`SELECT count(*)::int c FROM lesson_progress`))[0].c===0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
