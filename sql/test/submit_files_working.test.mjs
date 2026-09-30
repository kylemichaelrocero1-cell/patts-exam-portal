// sql/039: handing a paper in files its working in the same call.
//
// The working used to go in by a second call, save_worked_answers(), which
// asks for the session token that submit_assessment() never did — so a
// second sign-in mid-paper filed the picked items and refused the working
// (Pelaez, MATH 117 RETAKE, 3/9 on a paper worth 67). Force Submit and the
// practice sweep never made the second call at all.
//
//   npm run test:submit-working
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

// ── The schema, as score_worked_in_db builds it, through 038 ────────────
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
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');`);
for (const f of ['001_assessments_and_lessons','002_review_mode_and_server_scoring','003_lock_answer_key',
  '012_five_option_items','002b_grant_new_columns','015_archive_assessments','016_unlimited_choices',
  '017_shuffle_questions_switch','018_multi_select_items','019_exam_password_on_assessments',
  '020_exam_content_behind_the_gate','024_worked_solution_items','025_points_per_item',
  '026_worked_answers_are_saved_and_scored','027_score_worked_in_the_database',
  '030_primes_as_the_editor_writes_them','031_any_function_name_is_a_subject',
  '032_a_label_is_part_of_the_answer','033_a_minus_may_sit_on_the_numerator','034_session_is_current',
  '035_session_tokens_are_not_readable','036_four_primes_and_brackets','037_keyboard_leftovers',
  '038_any_arrow_is_to']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

// ── Papers ──────────────────────────────────────────────────────────────
let sn = 0;
const student = async (tok) => {
  const id = `00000000-0000-0000-0000-${String(++sn).padStart(12, '0')}`;
  await x(`INSERT INTO public.users (id, full_name, section, session_token) VALUES ('${id}','S${sn}','MATH 117','${tok}')`);
  return id;
};
const paper = async (id, { retakes = false, worked = true } = {}) => {
  await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,duration_minutes,allow_retakes,show_answers)
    VALUES ('${id}','exam','P','MATH 117','${INS}',true,60,${retakes},false)`);
  await x(`INSERT INTO public.questions (exam_id,assessment_id,question_number,question_text,question_type,choices,correct_answer)
    VALUES ('${id}','${id}',1,'Q1','multiple_choice','["a","b","c"]'::jsonb,0),
           ('${id}','${id}',2,'Q2','multiple_choice','["a","b","c"]'::jsonb,1)`);
  if (worked) {
    await q(`INSERT INTO public.questions (exam_id,assessment_id,question_number,question_text,question_type,choices,marks,work_given,work_variable,work_rubric)
      VALUES ($1,$1,3,'Find','worked_solution','[]'::jsonb,4,'f','x',$2::jsonb),
             ($1,$1,4,'Find','worked_solution','[]'::jsonb,4,'g','x',$3::jsonb)`,
      [id, JSON.stringify({ steps: [{ latex: 'x=0', marks: 4 }] }), JSON.stringify({ steps: [{ latex: 'x=2', marks: 4 }] })]);
  }
  const ids = await q(`SELECT id::text, question_number n FROM public.questions WHERE exam_id=$1 ORDER BY question_number`, [id]);
  return n => ids.find(r => r.n === n).id;
};
const liveSession = (stu, exam, work, status = 'active') => q(
  `INSERT INTO public.live_sessions (student_id, exam_id, assessment_id, status, work_answers_json)
   VALUES ($1,$2,$2,$3,$4::jsonb)
   ON CONFLICT (student_id, exam_id) DO UPDATE SET status = EXCLUDED.status, work_answers_json = EXCLUDED.work_answers_json`,
  [stu, exam, status, JSON.stringify(work)]);
const submit = async (stu, exam, mc) => (await asAnon(
  `SELECT public.submit_assessment($1,$2,$3::jsonb,60,0,'[]'::jsonb) AS r`, [stu, exam, JSON.stringify(mc)]));
const resultRow = async (stu, exam) => (await q(
  `SELECT score, total_items, work_marks, work_total, answers_json FROM public.results WHERE student_id=$1 AND exam_id=$2`, [stu, exam]))[0];

const RETAKE = '0202219b-dee7-4c50-a3ca-bb440d153e8d';
const qid = await paper(RETAKE);

console.log('=== before 039: the two halves can be split ===');
{
  const stu = await student('current');
  await liveSession(stu, RETAKE, { [qid(3)]: { lines: ['x=0'] }, [qid(4)]: { lines: ['x=2'] } });
  const r = await submit(stu, RETAKE, { [qid(1)]: 0, [qid(2)]: 1 });
  ck('the picked items go in without a token', r.ok, r.message);
  const refused = await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb)`,
    [stu, RETAKE, 'from-before-a-second-sign-in', JSON.stringify({ [qid(3)]: { lines: ['x=0'] } })]);
  ck('the working is refused with a stale token', !refused.ok && /session has expired/i.test(refused.message), refused.message);
  const row = await resultRow(stu, RETAKE);
  ck('and the row is left as picked items only — the 3/9 on a paper worth 67', row.score === 2 && row.work_total === null,
    JSON.stringify({ s: row.score, wt: row.work_total }));
}

const MIG = fs.readFileSync(P + '/sql/039_submit_files_the_working.sql', 'utf8');
await x(MIG);
await x(MIG);
ck('039 applies, twice', true);

console.log('\n=== after 039 ===');
{
  // Pelaez: signed in elsewhere, so only the submit gets through.
  const stu = await student('current');
  await liveSession(stu, RETAKE, { [qid(3)]: { lines: ['x=0'] }, [qid(4)]: { lines: [''] } });
  const r = await submit(stu, RETAKE, { [qid(1)]: 0, [qid(2)]: 2 });
  ck('one call hands the paper in', r.ok, r.message);
  const out = r.ok ? r.rows[0].r : {};
  ck('and says what the working scored: 4 of 8', Number(out.work_marks) === 4 && Number(out.work_total) === 8, JSON.stringify(out));
  const refused = await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb)`,
    [stu, RETAKE, 'stale', JSON.stringify({ [qid(3)]: { lines: ['x=0'] } })]);
  ck('the second call can still be refused…', !refused.ok);
  const row = await resultRow(stu, RETAKE);
  ck('…and the row has its working anyway: 1 of 2 picked + 4 of 8 worked',
    row.score === 1 && Number(row.work_marks) === 4 && Number(row.work_total) === 8, JSON.stringify({ s: row.score, m: row.work_marks, t: row.work_total }));
  ck('the working is stored as typed, in the shape save_worked_answers() uses',
    JSON.stringify(row.answers_json[qid(3)].lines) === '["x=0"]' && row.answers_json[qid(3)].type === 'worked');
  ck('the picked answers are kept beside it', row.answers_json[qid(1)] && row.answers_json[qid(1)].is_correct === true,
    JSON.stringify(row.answers_json[qid(1)]));
}
{
  // The student's own browser, token current: its fresher copy re-marks.
  const stu = await student('tok-live');
  await liveSession(stu, RETAKE, { [qid(3)]: { lines: ['x=1'] } });   // 2s behind the screen
  await submit(stu, RETAKE, {});
  const saved = await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb) AS r`,
    [stu, RETAKE, 'tok-live', JSON.stringify({ [qid(3)]: { lines: ['x=0'] }, [qid(4)]: { lines: ['x=2'] } })]);
  ck('a current token still saves the freshest copy', saved.ok, saved.message);
  const row = await resultRow(stu, RETAKE);
  ck('and that is what counts: 8 of 8', Number(row.work_marks) === 8 && Number(row.work_total) === 8, String(row.work_marks));
}
{
  // Force Submit claims the live session (status finished) before it submits.
  const stu = await student('t');
  await liveSession(stu, RETAKE, { [qid(4)]: { lines: ['x=2'] } }, 'finished');
  await x(`SET ROLE authenticated; SET test.uid = '${INS}'`);
  const out = (await q(`SELECT public.submit_assessment($1,$2,'{}'::jsonb,3600,0,'[]'::jsonb) AS r`, [stu, RETAKE]))[0].r;
  await x(`RESET ROLE; SET test.uid = ''`);
  ck('Force Submit files the working too — it never did', Number(out.work_marks) === 4 && Number(out.work_total) === 8, JSON.stringify(out));
}
{
  const stu = await student('t');
  const r = await submit(stu, RETAKE, { [qid(1)]: 0 });
  const row = await resultRow(stu, RETAKE);
  ck('no live session at all: still out of the full paper, 0 worked marks',
    r.ok && Number(row.work_marks) === 0 && Number(row.work_total) === 8, JSON.stringify({ m: row.work_marks, t: row.work_total }));
}
{
  // A paper already on file is never re-marked by a repeat submit.
  const stu = await student('t');
  await liveSession(stu, RETAKE, { [qid(3)]: { lines: ['x=0'] } });
  await submit(stu, RETAKE, {});
  await x(`UPDATE public.results SET work_marks = 7 WHERE student_id='${stu}'`);   // an instructor's hand mark
  await liveSession(stu, RETAKE, { [qid(3)]: { lines: ['x=9'] } });
  const again = await submit(stu, RETAKE, {});
  const row = await resultRow(stu, RETAKE);
  ck('a second submit leaves the filed paper and its marks alone', again.ok && Number(row.work_marks) === 7, String(row.work_marks));
  ck('and reports no working of its own', again.ok && again.rows[0].r.work_total === null, JSON.stringify(again.ok && again.rows[0].r));
}

console.log('\n=== practice papers: each attempt its own working ===');
{
  const PRAC = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b33';
  const pq = await paper(PRAC, { retakes: true });
  const stu = await student('t');
  await liveSession(stu, PRAC, { [pq(3)]: { lines: ['x=0'] } });
  const a1 = await submit(stu, PRAC, {});
  await liveSession(stu, PRAC, { [pq(3)]: { lines: ['x=0'] }, [pq(4)]: { lines: ['x=2'] } });
  const a2 = await submit(stu, PRAC, {});
  const rows = await q(`SELECT attempt_no, work_marks, work_total FROM public.review_attempts WHERE student_id=$1 ORDER BY attempt_no`, [stu]);
  ck('attempt 1 scored 4 of 8', a1.ok && Number(rows[0].work_marks) === 4 && Number(rows[0].work_total) === 8, JSON.stringify(rows));
  ck('attempt 2 scored 8 of 8, and attempt 1 is untouched', a2.ok && Number(rows[1].work_marks) === 8 && Number(rows[0].work_marks) === 4, JSON.stringify(rows));
}

console.log('\n=== what it leaves alone ===');
{
  const MCQ = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  const mq = await paper(MCQ, { worked: false });
  const stu = await student('t');
  const r = await submit(stu, MCQ, { [mq(1)]: 0, [mq(2)]: 0 });
  const out = r.ok ? r.rows[0].r : {};
  ck('a multiple-choice paper is marked as before', out.score === 1 && out.total_items === 2, JSON.stringify(out));
  ck('with no working fields filled in', out.work_marks === null && out.work_total === null);
  ck('and no work_total on its row', (await resultRow(stu, MCQ)).work_total === null);
}
{
  // Filing the working must never cost the student their submission.
  await x(`ALTER FUNCTION public.score_worked_answers(uuid,uuid,integer) RENAME TO score_worked_answers_real;
    CREATE FUNCTION public.score_worked_answers(uuid,uuid,integer DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'marking broke'; END $$;`);
  const stu = await student('t');
  await liveSession(stu, RETAKE, { [qid(3)]: { lines: ['x=0'] } });
  const r = await submit(stu, RETAKE, { [qid(1)]: 0 });
  const row = await resultRow(stu, RETAKE);
  ck('when marking the working fails, the paper is still handed in', r.ok && row && row.score === 1, r.message);
  ck('as the picked items alone — which Recover working then finds', row && row.work_total === null
    && !(qid(3) in (row.answers_json || {})), JSON.stringify(row?.answers_json));
  await x(`DROP FUNCTION public.score_worked_answers(uuid,uuid,integer);
    ALTER FUNCTION public.score_worked_answers_real(uuid,uuid,integer) RENAME TO score_worked_answers;`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
