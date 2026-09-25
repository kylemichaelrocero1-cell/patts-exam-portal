// A student pressed "review answers" on a paper of worked items and saw
// nothing: get_answer_review() had excluded them since 024, back when the
// database could not mark them. It can now (027), so the review has to show
// them — with what the student wrote, what it earned, and the answer.
//
//   npm run test:worked-review
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
const INS = 'd24df77e-309a-4ed8-988f-da3ee1c76408', STU = '11111111-1111-1111-1111-111111111111', TOK = 'tk';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.users (id, full_name, section, session_token)
  VALUES ('${STU}','S','MATH 117','${TOK}');`);
for (const f of ['001_assessments_and_lessons','002_review_mode_and_server_scoring','003_lock_answer_key',
  '012_five_option_items','002b_grant_new_columns','015_archive_assessments','016_unlimited_choices',
  '017_shuffle_questions_switch','018_multi_select_items','019_exam_password_on_assessments',
  '020_exam_content_behind_the_gate','024_worked_solution_items','025_points_per_item',
  '026_worked_answers_are_saved_and_scored','027_score_worked_in_the_database']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}
const PAPER = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b33';
await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,
    duration_minutes,allow_retakes,show_answers)
  VALUES ('${PAPER}','exam','Review me','MATH 117','${INS}',true,60,true,true);`);
await q(`INSERT INTO public.questions (exam_id,assessment_id,question_number,question_text,
    question_type,choices,marks,work_given,work_variable,work_rubric)
  VALUES ($1,$1,1,'Differentiate','worked_solution','[]'::jsonb,2,'y=5x','x',$2::jsonb),
         ($1,$1,2,'Limit','worked_solution','[]'::jsonb,1,'\\lim_{x\\to2}(x+3)','x',$3::jsonb)`,
  [PAPER,
   JSON.stringify({ steps: [{ latex: "y'=5", marks: 2 }], accept: ["y'=5x^0"] }),
   JSON.stringify({ steps: [{ latex: '5', marks: 1 }] })]);
await q(`INSERT INTO public.questions (exam_id,assessment_id,question_number,question_text,
    question_type,choices,correct_answer,marks)
  VALUES ($1,$1,3,'Pick one','multiple_choice','["a","b","c","d"]'::jsonb,1,1)`, [PAPER]);
const ids = await q(`SELECT id, question_number n FROM public.questions WHERE exam_id=$1 ORDER BY question_number`, [PAPER]);
const qid = n => ids.find(r => r.n === n).id;

await q(`SELECT public.submit_assessment($1,$2,$3::jsonb,60,0,'[]'::jsonb)`,
  [STU, PAPER, JSON.stringify({ [qid(3)]: 1 })]);
await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb)`,
  [STU, PAPER, TOK, JSON.stringify({ [qid(1)]: { lines: ["y'=5"] }, [qid(2)]: { lines: ['6'] } })]);

console.log('=== before 028 ===');
{
  const r = await asAnon(`SELECT public.get_answer_review($1,$2,NULL) AS r`, [STU, PAPER]);
  const items = r.ok ? r.rows[0].r : [];
  ck('the review skips every worked item — the bug',
    items.length === 1 && items[0].question_type === 'multiple_choice', JSON.stringify(items.length));
}

await x(fs.readFileSync(P + '/sql/028_worked_items_in_answer_review.sql', 'utf8'));
await x(fs.readFileSync(P + '/sql/028_worked_items_in_answer_review.sql', 'utf8'));
ck('028 applies, twice', true);

console.log('\n=== after ===');
{
  const r = await asAnon(`SELECT public.get_answer_review($1,$2,NULL) AS r`, [STU, PAPER]);
  ck('the review returns every item', r.ok && r.rows[0].r.length === 3, JSON.stringify(r.ok ? r.rows[0].r.length : r.message));
  const items = r.rows[0].r;
  const w1 = items.find(i => i.question_number === 1);
  const w2 = items.find(i => i.question_number === 2);
  const mc = items.find(i => i.question_number === 3);

  ck('a worked item carries the problem it started from', w1.work_given === 'y=5x');
  ck('and what the student wrote', w1.chosen === "y'=5", JSON.stringify(w1.chosen));
  ck('and that it was right, with the marks it earned',
    w1.is_correct === true && Number(w1.earned) === 2, JSON.stringify({ c: w1.is_correct, e: w1.earned }));
  ck('and the answer, since the instructor has answers on', w1.correct_latex === "y'=5");
  ck('a wrong one says so, and earned nothing',
    w2.is_correct === false && Number(w2.earned) === 0 && w2.chosen === '6',
    JSON.stringify({ c: w2.is_correct, e: w2.earned, ch: w2.chosen }));
  ck('but still shows the right answer', w2.correct_latex === '5');
  ck('the ACCEPT LIST is not released — that is marking policy, not the answer',
    !JSON.stringify(items).includes('5x^0'), JSON.stringify(items).slice(0, 80));
  ck('multiple-choice items are untouched',
    mc.question_type === 'multiple_choice' && mc.correct === 1 && mc.is_correct === true,
    JSON.stringify(mc));
  ck('the items come back in question order',
    items.map(i => i.question_number).join(',') === '1,2,3');
}

console.log('\n=== the gate still holds ===');
{
  await x(`UPDATE public.assessments SET show_answers=false WHERE id='${PAPER}'`);
  const r = await asAnon(`SELECT public.get_answer_review($1,$2,NULL)`, [STU, PAPER]);
  ck('a paper with answers off reveals nothing at all',
    !r.ok && /not available/i.test(r.message), r.message);
  await x(`UPDATE public.assessments SET show_answers=true WHERE id='${PAPER}'`);
  await x(`INSERT INTO public.users (id, full_name, section, session_token)
           VALUES ('22222222-2222-2222-2222-222222222222','Not Sat','MATH 117','t2')`);
  const n = await asAnon(`SELECT public.get_answer_review($1,$2,NULL)`,
    ['22222222-2222-2222-2222-222222222222', PAPER]);
  ck('nor does it to someone who has not submitted',
    !n.ok && /submit this assessment/i.test(n.message), n.message);
}

console.log('\n=== the form the CLIENT calls (4 arguments, sql/022) ===');
// There are two get_answer_review()s and the client calls the guarded one.
// 028 updated only the other, so the fix landed everywhere except where it
// was used: thirty cards with no problem and no answer on them.
await x(fs.readFileSync(P + '/sql/022_answer_review_needs_identity.sql', 'utf8'));
{
  const r = await asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3) AS r`, [STU, PAPER, TOK]);
  const w = (r.ok ? r.rows[0].r : []).filter(i => i.question_type === 'worked_solution');
  ck('before 029 the guarded form returns worked items in the OLD shape',
    w.length === 2 && w.every(i => !i.work_given && !i.correct_latex),
    JSON.stringify(w.map(i => Object.keys(i))));
}
await x(fs.readFileSync(P + '/sql/029_guarded_review_shows_worked_items.sql', 'utf8'));
await x(fs.readFileSync(P + '/sql/029_guarded_review_shows_worked_items.sql', 'utf8'));
ck('029 applies, twice', true);
{
  const r = await asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3) AS r`, [STU, PAPER, TOK]);
  ck('the guarded form now returns every item', r.ok && r.rows[0].r.length === 3, r.message);
  const items = r.rows[0].r;
  const w1 = items.find(i => i.question_number === 1);
  ck('with the problem', w1.work_given === 'y=5x', JSON.stringify(w1.work_given));
  ck('what the student wrote', w1.chosen === "y'=5");
  ck('what it earned', Number(w1.earned) === 2 && w1.is_correct === true);
  ck('and the answer', w1.correct_latex === "y'=5");
  ck('the accept list is still withheld', !JSON.stringify(items).includes('5x^0'));
}
{
  // The guard this form exists for must survive the change.
  const forged = await asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3)`, [STU, PAPER, 'wrong-token']);
  ck('a forged session is still refused',
    !forged.ok && /session has expired/i.test(forged.message), forged.message);
  await x(`UPDATE public.assessments SET show_answers=false WHERE id='${PAPER}'`);
  const off = await asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3)`, [STU, PAPER, TOK]);
  ck('and answers-off still reveals nothing', !off.ok && /not available/i.test(off.message));
  await x(`UPDATE public.assessments SET show_answers=true WHERE id='${PAPER}'`);
}
{
  // A classmate's id with your own token must not hand over their paper.
  await x(`INSERT INTO public.users (id, full_name, section, session_token)
           VALUES ('33333333-3333-3333-3333-333333333333','Other','MATH 117','t3')`);
  const other = await asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3)`, [STU, PAPER, 't3']);
  ck("passing a classmate's id with your own token gets you nothing of theirs",
    !other.ok, other.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
