// Runs 001 + 002 + 003 + 012 + 016 + 018 + 019 + 020 + 021 against real
// PostgreSQL (PGlite), AS THE ANON ROLE — which is what a student's browser
// is. The password only ever gated the Start button; the questions came from
// a table anon could read with USING (true). This proves that, then proves
// 020/021 put the paper behind the gate without stranding anyone mid-sitting.
//   npm run test:exam-gate
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSESSMENT_COLUMNS } from '../../src/lib/assessmentsCore.js';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const db = new PGlite();
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
process.on('unhandledRejection', e => { console.error('\nREJECTED:', e?.message || e); process.exit(1); });
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };

// Run something the way a student's browser does, and report what came back.
const asAnon = async (sql, params) => {
  try {
    await x(`SET ROLE anon`);
    const rows = await q(sql, params);
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  } finally {
    await x(`RESET ROLE`);
  }
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
// The RLS policies and grants as they stand in production.
await x(setup.match(/ALTER TABLE public\.\w+\s+ENABLE ROW LEVEL SECURITY;/g).join('\n'));
await x(setup.match(/^(DROP POLICY IF EXISTS|CREATE POLICY)[\s\S]*?;/gm).filter(s2 => !/storage\./.test(s2)).join('\n'));
await x(setup.match(/CREATE OR REPLACE FUNCTION public\.verify_exam_password[\s\S]*?END; \$\$;/)[0]);
await x(setup.match(/^(GRANT|REVOKE)[\s\S]*?;/gm).filter(g => /public\./.test(g) && !/storage|FUNCTION/.test(g)).join('\n'));

const INS = 'd24df77e-309a-4ed8-988f-da3ee1c76408';
const STU = '11111111-1111-1111-1111-111111111111';
const OUT = '22222222-2222-2222-2222-222222222222';   // a student in another section
const TOK = 'f0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1a';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.users (id, full_name, section, session_token)
  VALUES ('${STU}','S One','AENG 426, Esci 316 -2','${TOK}'),
         ('${OUT}','S Two','AENG 223L','tok-two');`);
for (const f of ['001_assessments_and_lessons', '002_review_mode_and_server_scoring',
                 '003_lock_answer_key', '012_five_option_items',
                 '002b_grant_new_columns', '015_archive_assessments',
                 '016_unlimited_choices', '017_shuffle_questions_switch',
                 '018_multi_select_items']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

// A locked paper, open now, created the way the app creates one today.
const PAPER = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b33';
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id,
           is_open, duration_minutes, exam_password, has_password)
         VALUES ('${PAPER}','exam','Finals 2025','AENG 426','${INS}',true,60,'BRAVO',true);
  INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choices, correct_answer)
  VALUES ('${PAPER}','${PAPER}',1,'What is V1?','multiple_choice','["a","b","c","d"]'::jsonb,2),
         ('${PAPER}','${PAPER}',2,'What is Vr?','multiple_choice','["a","b","c","d"]'::jsonb,1);`);

// A paper not open until next week — nobody should see it at all.
const FUTURE = '3f2b6c88-7d41-4e55-b0a9-8c7e5d4f3a21';
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id,
           is_open, duration_minutes, opens_at)
         VALUES ('${FUTURE}','exam','Next week','AENG 426','${INS}',true,60, now() + interval '7 days');
  INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choices, correct_answer)
  VALUES ('${FUTURE}','${FUTURE}',1,'Unseen item','multiple_choice','["a","b"]'::jsonb,0);`);

console.log('=== BEFORE 020/021 — what the password actually protected ===');
{
  const r = await asAnon(`SELECT question_text FROM public.questions WHERE exam_id = $1`, [PAPER]);
  ck('BUG — anon reads a locked paper without ever seeing the gate',
     r.ok && r.rows.length === 2, r.message);

  const f = await asAnon(`SELECT question_text FROM public.questions WHERE exam_id = $1`, [FUTURE]);
  ck("BUG — and next week's paper, a week early",
     f.ok && f.rows.length === 1, f.message);

  const k = await asAnon(`SELECT correct_answer FROM public.questions LIMIT 1`);
  ck('the answer key is withheld though — 003 did its job', k.ok === false);
}

console.log('\n=== AFTER 020 (additive) ===');
await x(fs.readFileSync(P + '/sql/019_exam_password_on_assessments.sql', 'utf8'));
await x(fs.readFileSync(P + '/sql/020_exam_content_behind_the_gate.sql', 'utf8'));
const call = (paper, student, token) =>
  asAnon(`SELECT * FROM public.get_exam_questions($1,$2,$3)`, [paper, student, token]);
{
  const locked = await call(PAPER, STU, TOK);
  ck('a student who has not entered the password is refused',
     locked.ok === false && /password/i.test(locked.message), locked.message);

  const forged = await asAnon(
    `INSERT INTO public.exam_unlocks (assessment_id, student_id) VALUES ($1,$2)`, [PAPER, STU]);
  ck('and cannot forge an unlock', forged.ok === false, 'the insert succeeded');

  const wrong = await asAnon(`SELECT public.unlock_assessment($1,$2,$3,$4) AS ok`,
                             [PAPER, 'guess', STU, TOK]);
  ck('a wrong password unlocks nothing', wrong.ok && wrong.rows[0].ok === false);
  ck('and records nothing',
     (await q(`SELECT count(*)::int c FROM public.exam_unlocks`))[0].c === 0);

  const noToken = await asAnon(`SELECT public.unlock_assessment($1,$2,$3,$4) AS ok`,
                               [PAPER, 'BRAVO', STU, 'not-their-token']);
  ck('the right password with a forged identity is refused',
     noToken.ok === false && /session/i.test(noToken.message), noToken.message);

  const good = await asAnon(`SELECT public.unlock_assessment($1,$2,$3,$4) AS ok`,
                            [PAPER, 'BRAVO', STU, TOK]);
  ck('the right password, from the real student, unlocks', good.ok && good.rows[0].ok === true);

  const open = await call(PAPER, STU, TOK);
  ck('who then gets the paper', open.ok && open.rows.length === 2, open.message);
  ck('with no answer key in it',
     open.ok && !Object.keys(open.rows[0]).some(k => k.startsWith('correct')),
     open.ok ? Object.keys(open.rows[0]).join(',') : '');
  ck('in question order', open.ok && open.rows[0].question_number === 1);

  const other = await call(PAPER, OUT, 'tok-two');
  ck('a student in another section is refused',
     other.ok === false && /section/i.test(other.message), other.message);

  const future = await call(FUTURE, STU, TOK);
  ck("next week's paper is refused until it opens",
     future.ok === false && /not open/i.test(future.message), future.message);

  // Mid-sitting must survive the instructor closing the paper.
  await x(`INSERT INTO public.live_sessions (student_id, exam_id, assessment_id, status)
           VALUES ('${STU}','${PAPER}','${PAPER}','active');
           UPDATE public.assessments SET is_open = false WHERE id = '${PAPER}';`);
  const midSitting = await call(PAPER, STU, TOK);
  ck('a student already writing keeps the paper when it is closed under them',
     midSitting.ok && midSitting.rows.length === 2, midSitting.message);
  await x(`UPDATE public.live_sessions SET status = 'finished' WHERE student_id='${STU}';
           UPDATE public.assessments SET is_open = true WHERE id = '${PAPER}';`);

  // Changing the password must lock the class back out — this is what makes
  // the remediation step in 019 mean anything.
  await x(`UPDATE public.assessments SET exam_password = 'CHARLIE' WHERE id = '${PAPER}'`);
  ck('changing the password tears up every unlock',
     (await q(`SELECT count(*)::int c FROM public.exam_unlocks`))[0].c === 0);
  const after = await call(PAPER, STU, TOK);
  ck('so the student is back at the gate',
     after.ok === false && /password/i.test(after.message), after.message);
  ck('and the old password no longer works',
     (await asAnon(`SELECT public.unlock_assessment($1,$2,$3,$4) AS ok`,
                   [PAPER, 'BRAVO', STU, TOK])).rows[0].ok === false);
  await asAnon(`SELECT public.unlock_assessment($1,$2,$3,$4)`, [PAPER, 'CHARLIE', STU, TOK]);

  const stillOpen = await asAnon(`SELECT question_text FROM public.questions WHERE exam_id = $1`, [PAPER]);
  ck('020 alone does NOT close the direct read — that is 021, on purpose',
     stillOpen.ok === true);
}

console.log('\n=== AFTER 021 (the lock) ===');
await x(fs.readFileSync(P + '/sql/021_revoke_direct_question_reads.sql', 'utf8'));
{
  const direct = await asAnon(`SELECT question_text FROM public.questions WHERE exam_id = $1`, [PAPER]);
  ck('the direct read is gone', direct.ok === false && /denied/i.test(direct.message), direct.message);

  const cols = await asAnon(`SELECT id FROM public.questions LIMIT 1`);
  ck('down to the last column', cols.ok === false, 'id was still readable');

  const f = await asAnon(`SELECT question_text FROM public.questions WHERE exam_id = $1`, [FUTURE]);
  ck("next week's paper is unreachable too", f.ok === false);

  const through = await call(PAPER, STU, TOK);
  ck('an unlocked student still gets their paper', through.ok && through.rows.length === 2, through.message);

  const g = await q(`SELECT count(*)::int c FROM information_schema.column_privileges
                     WHERE grantee='anon' AND table_name='questions'`);
  ck('no anon column grant survives on questions', g[0].c === 0, `${g[0].c} left`);

  // Instructors author papers directly and must be untouched.
  await x(`SET ROLE authenticated`);
  const mine = await q(`SELECT correct_answer FROM public.questions LIMIT 1`);
  await x(`RESET ROLE`);
  ck('instructors keep full access, key included', mine.length === 1);

  for (const f2 of ['020_exam_content_behind_the_gate', '021_revoke_direct_question_reads']) {
    await x(fs.readFileSync(`${P}/sql/${f2}.sql`, 'utf8'));
  }
  const again = await call(PAPER, STU, TOK);
  ck('both files are idempotent', again.ok && again.rows.length === 2, again.message);
}

console.log('\n=== THE ANSWER REVIEW — 022 / 023 ===');
// Same shape of hole one door along: get_answer_review() took the student id
// on trust. On a paper opened for review that hands a classmate's answers,
// and the key to every item, to anyone who passes their id.
{
  await x(`UPDATE public.assessments SET show_answers = true WHERE id = '${PAPER}';
    INSERT INTO public.results (student_id, exam_id, assessment_id, score, total_items, answers_json)
    SELECT '${STU}','${PAPER}','${PAPER}',2,2,
           jsonb_object_agg(q.id::text, jsonb_build_object('chosen', 2, 'is_correct', true))
    FROM public.questions q WHERE q.exam_id = '${PAPER}';`);

  const stolen = await asAnon(
    `SELECT public.get_answer_review($1,$2,NULL) AS r`, [STU, PAPER]);
  ck('BUG — a classmate\'s marked paper, and the key, for anyone with their id',
     stolen.ok && Array.isArray(stolen.rows[0].r) && stolen.rows[0].r.length === 2,
     stolen.message);
  ck('BUG — with the correct answer to every item in it',
     stolen.ok && stolen.rows[0].r.every(i => i.correct !== null && i.correct !== undefined));

  await x(fs.readFileSync(P + '/sql/022_answer_review_needs_identity.sql', 'utf8'));

  const guarded = (student, token, id = student) =>
    asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3) AS r`, [id, PAPER, token]);

  const mine = await guarded(STU, TOK);
  ck('the student themselves still gets their marked paper',
     mine.ok && mine.rows[0].r.length === 2, mine.message);

  const thief = await asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3) AS r`,
                             [STU, PAPER, 'tok-two']);
  ck('a classmate holding their own token cannot ask for someone else\'s paper',
     thief.ok === false && /session/i.test(thief.message), thief.message);

  const noToken = await asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3) AS r`,
                               [STU, PAPER, null]);
  ck('and no token at all is refused', noToken.ok === false, 'it returned a paper');

  const old3 = await asAnon(`SELECT public.get_answer_review($1,$2,NULL) AS r`, [STU, PAPER]);
  ck('022 alone leaves the old form callable — that is 023, on purpose', old3.ok === true);

  await x(fs.readFileSync(P + '/sql/023_drop_unidentified_answer_review.sql', 'utf8'));

  const gone = await asAnon(`SELECT public.get_answer_review($1,$2,NULL) AS r`, [STU, PAPER]);
  ck('the unidentified form is gone', gone.ok === false, 'it still answers');

  const still = await guarded(STU, TOK);
  ck('the proved form still works after the drop',
     still.ok && still.rows[0].r.length === 2, still.message);

  const n = await q(`SELECT count(*)::int c FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                     WHERE ns.nspname='public' AND p.proname='get_answer_review'`);
  ck('exactly one get_answer_review is left', n[0].c === 1, `${n[0].c}`);

  // It reads `questions` inside SECURITY DEFINER, so 021's revoke must not
  // have broken it — the review is the one place a key is meant to travel.
  ck('and it still reaches the key that 021 took away from anon',
     still.ok && still.rows[0].r.every(i => i.correct !== null));

  for (const f3 of ['022_answer_review_needs_identity', '023_drop_unidentified_answer_review']) {
    await x(fs.readFileSync(`${P}/sql/${f3}.sql`, 'utf8'));
  }
  const rerun = await guarded(STU, TOK);
  ck('both files are idempotent', rerun.ok && rerun.rows[0].r.length === 2, rerun.message);
}

console.log('\n=== A CLOSED OR ARCHIVED PAPER KEEPS THE STUDENT\'S RECORD ===');
// The asymmetry this pins down, because everything above pushes the other way:
// SITTING a paper is gated on it being open, and must be. SEEING what you
// already scored on it is not, and must never be. An instructor closing a
// paper, or filing it in the archive, is housekeeping — it takes the paper out
// of the Exams tab and it must not take away the student's own record.
//
// This is exactly the guarantee a later tightening of the assessments policy
// would quietly break, which is why it is written down here.
{
  await x(`UPDATE public.assessments
           SET is_open = false, archived_at = now()
           WHERE id = '${PAPER}';`);

  const score = await asAnon(
    `SELECT score, total_items FROM public.results
     WHERE student_id = $1 AND exam_id = $2`, [STU, PAPER]);
  ck('the score survives the paper being closed and archived',
     score.ok && score.rows.length === 1 && score.rows[0].score === 2, score.message);

  // The Summary reads the papers UNDERNEATH the results, not the open ones,
  // and with this exact column list. A missing grant here is what turns a
  // finished paper into a bare "Assessment" with no way back into it.
  const title = await asAnon(
    `SELECT id, kind, title, target_section, is_open, archived_at,
            allow_retakes, show_answers, has_password, duration_minutes
     FROM public.assessments WHERE id = $1`, [PAPER]);
  ck('and so does its title, archived and all',
     title.ok && title.rows[0].title === 'Finals 2025', title.message);
  ck('which the student can see IS archived, rather than it just vanishing',
     title.ok && title.rows[0].archived_at !== null);

  // The anon grant on `assessments` is an explicit column allow-list (001),
  // extended one migration at a time. PostgREST refuses the WHOLE request if a
  // single requested column is missing from it — so one forgotten GRANT does
  // not degrade the Summary, it blanks it, archived titles and all. Cross-check
  // the list the client actually asks for against the list anon may read.
  const granted = new Set((await q(
    `SELECT column_name FROM information_schema.column_privileges
     WHERE grantee='anon' AND table_name='assessments' AND privilege_type='SELECT'`
  )).map(r => r.column_name));
  const wanted = ASSESSMENT_COLUMNS.split(',').map(c => c.trim());
  const ungranted = wanted.filter(c => !granted.has(c));
  ck('every column the student app reads is granted to anon',
     ungranted.length === 0, `missing: ${ungranted.join(', ')}`);
  ck('and exam_password is still not one of them', !granted.has('exam_password'));

  const attempts = await asAnon(
    `SELECT attempt_no FROM public.review_attempts WHERE student_id = $1`, [STU]);
  ck('practice attempts stay readable too', attempts.ok, attempts.message);

  const marked = await asAnon(
    `SELECT public.get_answer_review($1,$2,NULL,$3) AS r`, [STU, PAPER, TOK]);
  ck('and the marked paper can still be opened for review',
     marked.ok && marked.rows[0].r.length === 2, marked.message);

  // The other half of the asymmetry, and the reason this section exists.
  const sit = await call(PAPER, STU, TOK);
  ck('but an archived paper still cannot be SAT — the two are different questions',
     sit.ok === false && /not open/i.test(sit.message), sit.message);
}

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
