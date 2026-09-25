// Proves the bug this migration exists for, then proves it fixed.
//
// A student's worked answers never reached the result row: ExamBoard patched
// `results` directly, RLS has no anon UPDATE policy there, and an UPDATE that
// matches zero rows is not an error — so the call reported success and the
// working was thrown away. Ten real submissions scored 0/0 before anyone
// noticed, because the failure was invisible from both ends.
//
//   npm run test:worked-saved
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
  '020_exam_content_behind_the_gate', '024_worked_solution_items', '025_points_per_item']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

// A retakeable paper of worked items, exactly like the practice papers.
const PAPER = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b33';
await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,
    duration_minutes,allow_retakes,show_answers)
  VALUES ('${PAPER}','exam','Practice','MATH 117','${INS}',true,60,true,true);`);
await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choices, marks, work_given, work_variable, work_rubric)
  VALUES ($1,$1,1,'Differentiate','worked_solution','[]'::jsonb,2,'y=5x','x',$2::jsonb),
         ($1,$1,2,'Differentiate','worked_solution','[]'::jsonb,3,'y=x^2','x',$3::jsonb)`,
  [PAPER,
   JSON.stringify({ steps: [{ latex: "y'=5", marks: 2, label: 'Final answer' }] }),
   JSON.stringify({ steps: [{ latex: "y'=2x", marks: 3, label: 'Final answer' }] })]);
const ids = await q(`SELECT id, question_number FROM public.questions WHERE exam_id=$1 ORDER BY question_number`, [PAPER]);
const qid = n => ids.find(r => r.question_number === n).id;

// The student sits it and submits, exactly as the app does.
await q(`SELECT public.submit_assessment($1,$2,'{}'::jsonb,120,0,'[]'::jsonb)`, [STU, PAPER]);
ck('submitting a worked-only paper writes an attempt scoring 0 of 0 picked items',
  (await q(`SELECT score, total_items FROM public.review_attempts WHERE student_id=$1`, [STU]))
    .every(r => Number(r.total_items) === 0));

console.log('\n=== the bug, reproduced ===');
// The app patched the row from the browser. It fails two different ways
// depending on the table, and the SILENT one is what hid this for so long.
{
  const ra = await asAnon(
    `UPDATE public.review_attempts SET answers_json = '{"x":1}'::jsonb
      WHERE student_id=$1 AND assessment_id=$2 RETURNING id`, [STU, PAPER]);
  ck('writing to review_attempts is refused outright — no grant at all',
     !ra.ok && /permission denied/i.test(ra.message), ra.message);

  // `results` refuses too. On THIS schema it is refused at the grant, as
  // above; on the live database anon has picked up an UPDATE grant somewhere
  // along the way, so the statement is allowed, RLS matches no row, and zero
  // rows is not an error — PostgREST reports success and the working
  // evaporates. That silent variant is why ten real submissions scored 0/0
  // before anyone noticed. Either way the write does not land, which is what
  // this asserts, because the fix is the same for both.
  await x(`INSERT INTO public.results (student_id, exam_id, assessment_id, score, total_items,
             answers_json, submitted_at)
           VALUES ('${STU}','${PAPER}','${PAPER}',0,0,'{}'::jsonb, now())`);
  const rs = await asAnon(
    `UPDATE public.results SET answers_json = '{"x":1}'::jsonb
      WHERE student_id=$1 AND assessment_id=$2 RETURNING id`, [STU, PAPER]);
  ck('writing to results from a browser does not land either',
     !rs.ok || rs.rows.length === 0, rs.ok ? `${rs.rows.length} rows` : rs.message);
  const still = (await q(`SELECT answers_json FROM public.results WHERE student_id=$1`, [STU]))[0];
  ck('so the working is thrown away',
     Object.keys(still.answers_json || {}).length === 0, JSON.stringify(still.answers_json));
  await x(`DELETE FROM public.results WHERE student_id='${STU}'`);
}

await x(fs.readFileSync(P + '/sql/026_worked_answers_are_saved_and_scored.sql', 'utf8'));
await x(fs.readFileSync(P + '/sql/026_worked_answers_are_saved_and_scored.sql', 'utf8'));
ck('026 applies, twice', true);

console.log('\n=== saving the working through the function ===');
const WORK = { [qid(1)]: { lines: ["y'=5"] }, [qid(2)]: { lines: ["y'=2x"] } };
{
  const r = await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb) AS r`,
    [STU, PAPER, TOK, JSON.stringify(WORK)]);
  ck('a student can save their own working', r.ok, r.message);
  ck('and it reports what it saved', r.ok && r.rows[0].r.saved === 1 && r.rows[0].r.items === 2,
     JSON.stringify(r.ok ? r.rows[0].r : r.message));
  const row = (await q(`SELECT answers_json, work_total FROM public.review_attempts WHERE student_id=$1`, [STU]))[0];
  ck('the working is on the attempt row now',
     row.answers_json[qid(1)]?.lines?.[0] === "y'=5", JSON.stringify(row.answers_json));
  ck('each entry is stamped as worked and unmarked',
     row.answers_json[qid(1)]?.type === 'worked' && row.answers_json[qid(1)]?.marks === null);
  ck('and the marks AVAILABLE are recorded, so a screen can say what is pending',
     Number(row.work_total) === 5, String(row.work_total));
}
{
  const bad = await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb)`,
    [STU, PAPER, 'not-the-token', JSON.stringify(WORK)]);
  ck('a forged session cannot save anything', !bad.ok && /session has expired/i.test(bad.message), bad.message);
  const junk = await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb) AS r`,
    [STU, PAPER, TOK, JSON.stringify({ '00000000-0000-0000-0000-000000000000': { lines: ['x'] } })]);
  ck('entries for items that are not on this paper are dropped',
     junk.ok && junk.rows[0].r.items === 0, JSON.stringify(junk.ok ? junk.rows[0].r : junk.message));
  const blank = await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb) AS r`,
    [STU, PAPER, TOK, JSON.stringify({ [qid(1)]: { lines: ['  ', ''] } })]);
  ck('blank lines are not an answer', blank.ok && blank.rows[0].r.items === 0);
}

console.log('\n=== the answers, once it is handed in ===');
{
  const r = await asAnon(`SELECT public.get_worked_keys($1,$2,$3) AS r`, [STU, PAPER, TOK]);
  ck('a student who has submitted may fetch the answers', r.ok, r.message);
  const keys = r.ok ? r.rows[0].r : [];
  ck('one per worked item, each with its answer and what it is worth',
     keys.length === 2 && keys[0].answer === "y'=5" && Number(keys[0].marks) === 2,
     JSON.stringify(keys));
  ck("the instructor's intermediate steps and their marks are NOT released",
     keys.every(k => !('steps' in k) && !('work_rubric' in k)), JSON.stringify(Object.keys(keys[0])));
}
{
  await x(`UPDATE public.assessments SET show_answers=false WHERE id='${PAPER}'`);
  const r = await asAnon(`SELECT public.get_worked_keys($1,$2,$3)`, [STU, PAPER, TOK]);
  ck('nothing is released when the instructor has answers turned off',
     !r.ok && /not available/i.test(r.message), r.message);
  await x(`UPDATE public.assessments SET show_answers=true WHERE id='${PAPER}'`);
}
{
  await x(`INSERT INTO public.users (id, full_name, section, session_token)
           VALUES ('22222222-2222-2222-2222-222222222222','Not Sat','MATH 117','tok2')`);
  const r = await asAnon(`SELECT public.get_worked_keys($1,$2,$3)`,
    ['22222222-2222-2222-2222-222222222222', PAPER, 'tok2']);
  ck('and nothing to a student who has not submitted yet — a paper being sat leaks nothing',
     !r.ok && /submit this assessment/i.test(r.message), r.message);
  const forged = await asAnon(`SELECT public.get_worked_keys($1,$2,$3)`, [STU, PAPER, 'wrong']);
  ck('nor on a forged session', !forged.ok && /session has expired/i.test(forged.message));
}

console.log('\n=== the rubric itself is still out of reach ===');
{
  const r = await asAnon(`SELECT work_rubric FROM public.questions LIMIT 1`);
  ck('anon still cannot read work_rubric off the table', !r.ok, r.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
