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
let MOCK;
// PGlite prints its entire minified bundle on an uncaught error, which buries
// the actual failure. Keep only the message.
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
process.on('unhandledRejection', e => { console.error('\nREJECTED:', e?.message || e); process.exit(1); });
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

console.log('\n=== ORIGINAL PAPERS MUST BE UNTOUCHED ===');
{
  const r=await q(`SELECT allow_retakes,show_answers,is_open,target_section,score_policy
                   FROM public.assessments WHERE id='${EX}'`);
  ck('retakes still OFF on the original', r[0].allow_retakes===false);
  ck('answers still HIDDEN on the original', r[0].show_answers===false);
  ck('original still closed', r[0].is_open===false);
  ck('original NOT retargeted at Pre-Boards', !r[0].target_section.includes('Pre-Boards'));
  ck('score_policy defaults to first', r[0].score_policy==='first');
  const n=await q(`SELECT count(*)::int c FROM public.assessments WHERE allow_retakes OR show_answers`);
  ck('no paper anywhere was made reviewable', n[0].c===0, String(n[0].c));
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

console.log('\n=== NORMAL EXAM: one graded row, no answers ===');
{
  const all={}; QIDS.forEach((id,i)=>all[id]=i%4);
  const r=await q(`SELECT public.submit_assessment($1,$2,$3,600,1,'[]'::jsonb) AS o`,[STU,EX,JSON.stringify(all)]);
  ck('marked server-side 4/4', r[0].o.score===4 && r[0].o.total_items===4, JSON.stringify(r[0].o));
  ck('reports answers are NOT viewable', r[0].o.can_review===false);
  const rows=await q(`SELECT score FROM public.results WHERE student_id=$1`,[STU]);
  ck('written to results (the graded record)', rows.length===1 && rows[0].score===4);
  await q(`SELECT public.submit_assessment($1,$2,'{}'::jsonb,60,0,'[]'::jsonb)`,[STU,EX]);
  const rows2=await q(`SELECT score FROM public.results WHERE student_id=$1`,[STU]);
  ck('resubmitting cannot overwrite a grade', rows2.length===1 && rows2[0].score===4);
  let threw=false;
  try { await q(`SELECT public.get_answer_review($1,$2,null)`,[STU,EX]); } catch { threw=true; }
  ck('answers REFUSED while show_answers is off', threw);
}

console.log('\n=== MOCK EXAM via duplicate_assessment ===');
{
  // set_config on the session, so auth.uid() resolves for the ownership
  // check inside duplicate_assessment. SET LOCAL would only last a
  // transaction, and quoting the name in a bare SET does not take.
  await q(`SELECT set_config('test.uid', $1, false)`, [INS]);
  const r=await q(`SELECT public.duplicate_assessment($1,$2,$3,true,true,'latest') AS id`,
                  [EX,'Practice Copy (EEMLE) 1','Pre-Boards PATTS']);
  MOCK=r[0].id;
  const a=await q(`SELECT title,target_section,is_open,allow_retakes,show_answers,score_policy FROM public.assessments WHERE id=$1`,[MOCK]);
  ck('copy created with the new name', a[0].title==='Practice Copy (EEMLE) 1');
  ck('aimed at Pre-Boards PATTS only', a[0].target_section==='Pre-Boards PATTS');
  ck('created CLOSED, to be opened deliberately', a[0].is_open===false);
  ck('retakes + answers on', a[0].allow_retakes===true && a[0].show_answers===true);
  ck('score policy carried through', a[0].score_policy==='latest');
  const qn=await q(`SELECT count(*)::int c FROM public.questions WHERE exam_id=$1`,[MOCK]);
  ck('questions copied (4 MC + 1 essay)', qn[0].c===5, String(qn[0].c));
  const orig=await q(`SELECT is_open,show_answers FROM public.assessments WHERE id='${EX}'`);
  ck('SOURCE paper still closed and non-revealing', orig[0].is_open===false && orig[0].show_answers===false);
}

console.log('\n=== UNLIMITED RETAKES ON THE MOCK ===');
{
  const mk=(right)=>{const a={};QIDS.forEach((id,i)=>a[id]= i<right ? i%4 : (i%4+1)%4);return a;};
  // question ids differ on the copy, so map by question_number
  const mq=await q(`SELECT id,question_number,correct_answer FROM public.questions
                    WHERE exam_id=$1 AND question_type<>'essay' ORDER BY question_number`,[MOCK]);
  const ans=(right)=>{const a={};mq.forEach((r,i)=>a[r.id]= i<right ? r.correct_answer : (r.correct_answer+1)%4);return JSON.stringify(a);};
  const r1=await q(`SELECT public.submit_assessment($1,$2,$3,300,0,'[]'::jsonb) AS o`,[STU,MOCK,ans(1)]);
  const r2=await q(`SELECT public.submit_assessment($1,$2,$3,240,0,'[]'::jsonb) AS o`,[STU,MOCK,ans(3)]);
  const r3=await q(`SELECT public.submit_assessment($1,$2,$3,180,0,'[]'::jsonb) AS o`,[STU,MOCK,ans(4)]);
  ck('attempts increment', [r1,r2,r3].map(r=>r[0].o.attempt_no).join(',')==='1,2,3');
  ck('scores improve 1 -> 3 -> 4', [r1,r2,r3].map(r=>r[0].o.score).join(',')==='1,3,4');
  ck('reports answers ARE viewable', r3[0].o.can_review===true);
  const g=await q(`SELECT count(*)::int c FROM public.results WHERE assessment_id=$1`,[MOCK]);
  ck('nothing written to the graded results table', g[0].c===0);
  const orig=await q(`SELECT score FROM public.results WHERE student_id=$1 AND assessment_id='${EX}'`,[STU]);
  ck('real exam grade untouched by practice', orig[0].score===4);
}

console.log('\n=== SCORE POLICY (what the instructor sees) ===');
{
  const pol=async(p)=>{
    await q(`UPDATE public.assessments SET score_policy=$1 WHERE id=$2`,[p,MOCK]);
    const r=await q(`SELECT score,attempt_count,shown_attempt_no FROM public.assessment_scores
                     WHERE assessment_id=$1 AND student_id=$2`,[MOCK,STU]);
    return r[0];
  };
  const f=await pol('first'), l=await pol('latest'), h=await pol('highest');
  ck("'first' shows attempt 1 (score 1)", f.score===1 && f.shown_attempt_no===1, JSON.stringify(f));
  ck("'latest' shows attempt 3 (score 4)", l.score===4 && l.shown_attempt_no===3, JSON.stringify(l));
  ck("'highest' shows the best (score 4)", h.score===4, JSON.stringify(h));
  ck('attempt_count exposed so the tab stays clean', f.attempt_count===3);
  const rows=await q(`SELECT count(*)::int c FROM public.assessment_scores WHERE assessment_id=$1`,[MOCK]);
  ck('ONE row per student despite 3 attempts', rows[0].c===1, String(rows[0].c));
}

console.log('\n=== ANSWER REVIEW (only after submitting, only when enabled) ===');
{
  const r=await q(`SELECT public.get_answer_review($1,$2,null) AS o`,[STU,MOCK]);
  const rev=r[0].o;
  ck('one row per MC question', rev.length===4, String(rev.length));
  ck('essay excluded', !rev.some(z=>z.question_text==='Essay'));
  ck('shows the correct answer', rev.every(z=>z.correct!==null));
  ck('shows what they chose', rev.every(z=>z.chosen!==null));
  ck('latest attempt used — all 4 right', rev.filter(z=>z.is_correct).length===4);
  const r1=await q(`SELECT public.get_answer_review($1,$2,1) AS o`,[STU,MOCK]);
  ck('can review an earlier attempt (attempt 1 = 1 right)',
     r1[0].o.filter(z=>z.is_correct).length===1);

  let threw=false;
  try { await q(`SELECT public.get_answer_review($1,$2,null)`,['22222222-2222-2222-2222-222222222222',MOCK]); }
  catch { threw=true; }
  ck('refused for a student who has not submitted', threw);
}

console.log('\n=== 004: MOCK EXAM CREATION ===');
{
  // two AENG 426 papers per subject so the numbering can be checked
  await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,duration_minutes,created_at)
    VALUES ('dddddddd-0000-0000-0000-000000000001','exam','Powerplant - Diagnostic Exam','AENG 426','${INS}',false,180,'2026-01-01'),
           ('dddddddd-0000-0000-0000-000000000002','exam','Powerplant - Revalida Exam','AENG 426','${INS}',false,180,'2026-02-01'),
           ('dddddddd-0000-0000-0000-000000000003','exam','EEMLE - Finals Exam','AENG 426','${INS}',true,180,'2026-03-01')`);
  for (const [eid,n] of [['dddddddd-0000-0000-0000-000000000001',3],['dddddddd-0000-0000-0000-000000000002',2],['dddddddd-0000-0000-0000-000000000003',4]])
    for (let i=1;i<=n;i++)
      await x(`INSERT INTO public.questions (exam_id,assessment_id,question_number,question_text,question_type,choice_a,choice_b,choice_c,choice_d,correct_answer)
               VALUES ('${eid}','${eid}',${i},'Q${i}','multiple_choice','A','B','C','D',${i%4})`);

  await x(fs.readFileSync(P+'/sql/004_create_mock_exams.sql','utf8'));

  // How many AENG 426 papers exist, and how many questions they hold — the
  // copies must mirror exactly that, whatever earlier fixtures left behind.
  const src=await q(`SELECT a.id, a.title,
                            (SELECT count(*)::int FROM public.questions z WHERE z.exam_id=a.id) AS qn
                     FROM public.assessments a
                     WHERE a.title NOT LIKE '%Mock Exam %'
                       AND EXISTS (SELECT 1 FROM unnest(string_to_array(coalesce(a.target_section,''),',')) t(x)
                                   WHERE btrim(t.x)='AENG 426')`);
  const expectCopies = src.length;
  const expectQs = src.reduce((t,r)=>t+r.qn,0);

  const m=await q(`SELECT title,is_open,allow_retakes,show_answers,score_policy,target_section,has_password,
                          (SELECT count(*)::int FROM public.questions z WHERE z.exam_id=a.id) AS qn
                   FROM public.assessments a WHERE title LIKE '%Mock Exam %' ORDER BY title`);
  ck(`one copy per AENG 426 paper (${expectCopies})`, m.length===expectCopies, String(m.length));
  ck('named "<Subject> Mock Exam <n>", oldest first',
     m.some(r=>r.title==='Powerplant Mock Exam 1') && m.some(r=>r.title==='Powerplant Mock Exam 2'),
     m.map(r=>r.title).join(' | '));
  ck('the count RESTARTS for each subject (EEMLE begins at 1, not 3)',
     m.some(r=>r.title==='EEMLE Mock Exam 1') && !m.some(r=>r.title==='EEMLE Mock Exam 3'),
     m.map(r=>r.title).join(' | '));
  // the oldest Powerplant paper must be number 1, not merely present
  const ppOrder = m.filter(r=>r.title.startsWith('Powerplant Mock Exam ')).map(r=>r.title).sort();
  ck('Powerplant numbered contiguously from 1',
     ppOrder.every((t,i)=>t===`Powerplant Mock Exam ${i+1}`), ppOrder.join(' | '));
  ck('all created CLOSED', m.every(r=>r.is_open===false));
  ck('all have retakes + answers on', m.every(r=>r.allow_retakes && r.show_answers));
  ck('all show the latest attempt', m.every(r=>r.score_policy==='latest'));
  ck('all aimed at Pre-Boards PATTS only', m.every(r=>r.target_section==='Pre-Boards PATTS'));
  ck('no password on revision material', m.every(r=>r.has_password===false));
  const pp1=m.find(r=>r.title==='Powerplant Mock Exam 1');
  ck('questions copied (3 for the oldest Powerplant paper)', pp1.qn===3, String(pp1?.qn));
  const tot=m.reduce((t,r)=>t+r.qn,0);
  ck(`every question copied (${expectQs})`, tot===expectQs, String(tot));

  // Check the actual source papers by id. A title pattern would also sweep in
  // copies made by duplicate_assessment earlier in this file, which are
  // supposed to have retakes on.
  const orig=await q(`SELECT count(*) FILTER (WHERE is_open)::int o,
                             count(*) FILTER (WHERE show_answers)::int sa,
                             count(*) FILTER (WHERE allow_retakes)::int ar
                      FROM public.assessments WHERE id = ANY($1::uuid[])`,
                     [src.map(r=>r.id)]);
  ck('no original made revealing', orig[0].sa===0);
  ck('no original made retakeable', orig[0].ar===0);
  ck('originals keep their own open/closed state', orig[0].o===1, String(orig[0].o));

  // idempotency
  await x(fs.readFileSync(P+'/sql/004_create_mock_exams.sql','utf8'));
  const again=await q(`SELECT count(*)::int c FROM public.assessments WHERE title LIKE '%Mock Exam %'`);
  ck('re-running creates no duplicates', again[0].c===expectCopies, String(again[0].c));
  const qs=await q(`SELECT count(*)::int c FROM public.questions z
                    JOIN public.assessments a ON a.id=z.exam_id WHERE a.title LIKE '%Mock Exam %'`);
  ck('re-running does not double the questions', qs[0].c===expectQs, String(qs[0].c));
}

console.log('\n=== 002b: STUDENT-VISIBLE SWITCHES ===');
{
  await x(fs.readFileSync(P+'/sql/002b_grant_new_columns.sql','utf8'));
  const g=await q(`SELECT string_agg(column_name,',' ORDER BY column_name) AS c
                   FROM information_schema.column_privileges
                   WHERE grantee='anon' AND table_name='assessments' AND privilege_type='SELECT'`);
  const cols=(g[0].c||'').split(',');
  ck('anon can read allow_retakes', cols.includes('allow_retakes'), g[0].c);
  ck('anon can read show_answers',  cols.includes('show_answers'));
  ck('score_policy stays instructor-only', !cols.includes('score_policy'));
  ck('exam_password still withheld', !cols.includes('exam_password'));
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
  // MOCK has retakes on, so this exercises the retake path post-revoke.
  const mq2=await q(`SELECT id,correct_answer FROM public.questions
                     WHERE exam_id=$1 AND question_type<>'essay'`,[MOCK]);
  const perfect={}; mq2.forEach(r=>perfect[r.id]=r.correct_answer);
  const rv=await q(`SELECT public.submit_assessment($1,$2,$3,60,0,'[]'::jsonb) AS o`,[STU,MOCK,JSON.stringify(perfect)]);
  ck('retakes still work after the revoke', rv[0].o.score===4, JSON.stringify(rv[0].o));
  ck('answer review still works after the revoke',
     (await q(`SELECT public.get_answer_review($1,$2,null) AS o`,[STU,MOCK]))[0].o.length===4);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
