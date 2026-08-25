// Runs 001 then 002 against real PostgreSQL (PGlite) on a replica of the
// production schema, and asserts the behaviour that matters: server-side
// marking is correct, retakes are unlimited, the graded record is never
// touched by practice, and the answer key is only reachable after submitting.
//   npm run test:review
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const db = new PGlite();
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass=0, fail=0;
const ck=(n,ok,d='')=>{ok?(pass++,console.log(`  PASS  ${n}`)):(fail++,console.log(`  FAIL  ${n}${d?' — '+d:''}`));};

await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;`);
const setup = fs.readFileSync(P+'/supabase_setup.sql','utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);

const INS='d24df77e-309a-4ed8-988f-da3ee1c76408', STU='11111111-1111-1111-1111-111111111111';
const EX='67d25e6e-a4d7-45eb-96d2-01bb22241274';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.users (id,full_name,section) VALUES ('${STU}','S One','AENG 223L, AENG 426');
  INSERT INTO public.users (id,full_name,section) VALUES ('22222222-2222-2222-2222-222222222222','S Two','AENG 212L-1');
  INSERT INTO public.exams (id,title,target_section,instructor_id,is_open,duration_minutes)
    VALUES ('${EX}','EEMLE Finals','AENG 426','${INS}',false,60);`);
// 4 MC questions with known keys + 1 essay that must be excluded from totals
const QIDS=[];
for (let i=0;i<4;i++){
  const r=await q(`INSERT INTO public.questions (exam_id,question_number,question_text,question_type,choice_a,choice_b,choice_c,choice_d,correct_answer)
    VALUES ($1,$2,$3,'multiple_choice','A','B','C','D',$4) RETURNING id`,[EX,i+1,`Q${i+1}`,i%4]);
  QIDS.push(r[0].id);
}
await x(`INSERT INTO public.questions (exam_id,question_number,question_text,question_type,correct_answer)
         VALUES ('${EX}',5,'Essay','essay',null)`);

await x(fs.readFileSync(P+'/sql/001_assessments_and_lessons.sql','utf8'));
await x(fs.readFileSync(P+'/sql/002_review_mode_and_server_scoring.sql','utf8'));
console.log('001 + 002 applied\n');

console.log('=== COHORT ===');
{
  const r=await q(`SELECT section FROM public.users WHERE id='${STU}'`);
  ck('AENG 426 student gained Pre-Boards PATTS', r[0].section.includes('Pre-Boards PATTS'), r[0].section);
  ck('AENG 426 retained (results stay linked)', r[0].section.includes('AENG 426'));
  const o=await q(`SELECT section FROM public.users WHERE id='22222222-2222-2222-2222-222222222222'`);
  ck('non-426 student untouched', !o[0].section.includes('Pre-Boards'), o[0].section);
  await x(`UPDATE public.users SET section=section WHERE id='${STU}'`);
}
{ // idempotency of the cohort update
  await x(fs.readFileSync(P+'/sql/002_review_mode_and_server_scoring.sql','utf8'));
  const r=await q(`SELECT section FROM public.users WHERE id='${STU}'`);
  const n=(r[0].section.match(/Pre-Boards PATTS/g)||[]).length;
  ck('re-running does not duplicate the section', n===1, `${n} copies`);
}

console.log('\n=== REVIEW MATERIAL ===');
{
  const r=await q(`SELECT allow_review,is_open,target_section FROM public.assessments WHERE id='${EX}'`);
  ck('AENG 426 paper is review-enabled', r[0].allow_review===true);
  ck('and reachable', r[0].is_open===true);
  ck('targeted at Pre-Boards PATTS', r[0].target_section.includes('Pre-Boards PATTS'));
}

console.log('\n=== SERVER-SIDE MARKING ===');
{
  const all = {}; QIDS.forEach((id,i)=>all[id]=i%4);           // every answer right
  const r=await q(`SELECT * FROM public.score_answers($1,$2)`,[EX,JSON.stringify(all)]);
  ck('all correct scores 4/4', r[0].score===4 && r[0].total_items===4, JSON.stringify(r[0]));
  ck('essay excluded from total', r[0].total_items===4);

  const half={}; QIDS.forEach((id,i)=>half[id]= i<2 ? i%4 : (i%4+1)%4);
  const r2=await q(`SELECT * FROM public.score_answers($1,$2)`,[EX,JSON.stringify(half)]);
  ck('two right scores 2/4', r2[0].score===2, JSON.stringify(r2[0]));

  const r3=await q(`SELECT * FROM public.score_answers($1,'{}'::jsonb)`,[EX]);
  ck('blank paper scores 0/4 (not 0/0)', r3[0].score===0 && r3[0].total_items===4);

  const partial={}; partial[QIDS[0]]=0;
  const r4=await q(`SELECT * FROM public.score_answers($1,$2)`,[EX,JSON.stringify(partial)]);
  ck('unanswered questions omitted from answers_json',
     Object.keys(r4[0].answers_json).length===1, JSON.stringify(r4[0].answers_json));
  ck('stored shape matches what the dashboard renders',
     'chosen' in r4[0].answers_json[QIDS[0]] && 'is_correct' in r4[0].answers_json[QIDS[0]]);
}

console.log('\n=== OFFICIAL SUBMISSION (results) ===');
{
  const all={}; QIDS.forEach((id,i)=>all[id]=i%4);
  const r=await q(`SELECT public.submit_exam($1,$2,$3,600,1,'[]'::jsonb) AS out`,[STU,EX,JSON.stringify(all)]);
  ck('returns score', r[0].out.score===4 && r[0].out.total_items===4, JSON.stringify(r[0].out));
  const rows=await q(`SELECT score,total_items,tab_switches FROM public.results WHERE student_id=$1`,[STU]);
  ck('one graded row written', rows.length===1 && rows[0].score===4);
  await q(`SELECT public.submit_exam($1,$2,$3,600,0,'[]'::jsonb)`,[STU,EX,'{}']);
  const rows2=await q(`SELECT score FROM public.results WHERE student_id=$1`,[STU]);
  ck('resubmitting does NOT overwrite the graded record', rows2.length===1 && rows2[0].score===4, JSON.stringify(rows2));
}

console.log('\n=== UNLIMITED RETAKES (review_attempts) ===');
let attemptId;
{
  const mk=(right)=>{const a={};QIDS.forEach((id,i)=>a[id]= i<right ? i%4 : (i%4+1)%4);return JSON.stringify(a);};
  const r1=await q(`SELECT public.submit_review_attempt($1,$2,$3,120) AS o`,[STU,EX,mk(1)]);
  const r2=await q(`SELECT public.submit_review_attempt($1,$2,$3,110) AS o`,[STU,EX,mk(3)]);
  const r3=await q(`SELECT public.submit_review_attempt($1,$2,$3,100) AS o`,[STU,EX,mk(4)]);
  ck('attempt numbers increment', r1[0].o.attempt_no===1 && r2[0].o.attempt_no===2 && r3[0].o.attempt_no===3);
  ck('scores improve across attempts', r1[0].o.score===1 && r2[0].o.score===3 && r3[0].o.score===4,
     [r1[0].o.score,r2[0].o.score,r3[0].o.score].join(','));
  const n=await q(`SELECT count(*)::int c FROM public.review_attempts WHERE student_id=$1`,[STU]);
  ck('three attempts stored', n[0].c===3);
  const g=await q(`SELECT score FROM public.results WHERE student_id=$1`,[STU]);
  ck('graded record STILL untouched by practice', g[0].score===4);
  attemptId = r2[0].o.attempt_id;
}

console.log('\n=== ANSWER REVEAL ===');
{
  const r=await q(`SELECT public.get_attempt_review($1) AS o`,[attemptId]);
  const rev=r[0].o;
  ck('review returns one row per MC question', rev.length===4, String(rev.length));
  ck('essay excluded from review', !rev.some(x=>x.question_text==='Essay'));
  ck('correct answer revealed', rev.every(x=>x.correct!==null && x.correct!==undefined));
  ck('choices included so the paper can be re-rendered', rev.every(x=>Array.isArray(x.choices)&&x.choices.length===4));
  ck('marks which the student got right', rev.filter(x=>x.is_correct).length===3, JSON.stringify(rev.map(x=>x.is_correct)));
  ck('records what they chose', rev.every(x=>x.chosen!==null));
}

console.log('\n=== GUARDS ===');
{
  await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,allow_review,duration_minutes)
           VALUES ('aaaaaaaa-1111-1111-1111-111111111111','exam','Live Paper','AENG 212L-1','${INS}',true,false,60)`);
  let threw=false;
  try { await q(`SELECT public.submit_review_attempt($1,$2,'{}'::jsonb,10)`,[STU,'aaaaaaaa-1111-1111-1111-111111111111']); }
  catch { threw=true; }
  ck('retake refused when review is off', threw);

  const empty=await q(`SELECT public.get_attempt_review($1) AS o`,['aaaaaaaa-2222-2222-2222-222222222222']);
  ck('unknown attempt reveals nothing', Array.isArray(empty[0].o) && empty[0].o.length===0);
}

console.log('\n=== 003: ANSWER KEY LOCKED ===');
{
  await x(fs.readFileSync(P+'/sql/003_lock_answer_key.sql','utf8'));
  const g=await q(`SELECT string_agg(column_name,',' ORDER BY column_name) AS c
                   FROM information_schema.column_privileges
                   WHERE grantee='anon' AND table_name='questions' AND privilege_type='SELECT'`);
  const cols=(g[0].c||'');
  ck('anon can still read question_text', cols.includes('question_text'), cols);
  ck('anon can still read the choices', cols.includes('choice_a') && cols.includes('choice_d'));
  ck('anon can NO LONGER read correct_answer', !cols.split(',').includes('correct_answer'), cols);

  // marking must keep working, because the RPCs are SECURITY DEFINER
  const all={}; QIDS.forEach((id,i)=>all[id]=i%4);
  const r=await q(`SELECT * FROM public.score_answers($1,$2)`,[EX,JSON.stringify(all)]);
  ck('server-side marking still works after the revoke', r[0].score===4, JSON.stringify(r[0]));
  const rv=await q(`SELECT public.submit_review_attempt($1,$2,$3,60) AS o`,[STU,EX,JSON.stringify(all)]);
  ck('retakes still work after the revoke', rv[0].o.score===4);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
