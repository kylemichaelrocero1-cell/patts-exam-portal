// Runs 001 + 002 + 003 + 012 + 016 against real PostgreSQL (PGlite). 016 is the
// riskiest migration so far — it backfills every existing item and installs a
// trigger — so this checks the backfill is faithful, the mirror stays true, a
// seven-choice item works end to end, and re-running never narrows an item that
// has since grown.
//   npm run test:unlimited-choices
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
const fails = async (sql, p) => { try { await q(sql, p); return null; } catch (e) { return e.message || String(e); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
await x(fs.readFileSync(P + '/sql/012_five_option_items.sql', 'utf8'));

// A paper as it looked before 016: a four-choice item, a five-choice item and
// an essay.
const PAPER = '67d25e6e-a4d7-45eb-96d2-01bb22241274';
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id,
           is_open, duration_minutes, show_answers, allow_retakes)
         VALUES ('${PAPER}','exam','Legacy paper','AENG 426','${INS}',true,60,true,true);
  INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choice_a, choice_b, choice_c, choice_d, choice_e, correct_answer)
  VALUES
   ('${PAPER}','${PAPER}',1,'Four','multiple_choice','w','x','y','z',NULL,2),
   ('${PAPER}','${PAPER}',2,'Five','multiple_choice','v','w','x','y','z',4),
   ('${PAPER}','${PAPER}',3,'Essay','essay',NULL,NULL,NULL,NULL,NULL,NULL);`);

console.log('=== BEFORE 016 ===');
{
  const e = await fails(`SELECT choices FROM public.questions LIMIT 1`);
  ck('the choices array does not exist yet', !!e);
  const k = await fails(
    `UPDATE public.questions SET choice_e='z', correct_answer=5 WHERE question_number=1 AND exam_id=$1`, [PAPER]);
  ck('a key of 5 is refused by the 0..4 constraint from 012', !!k);
}

await x(fs.readFileSync(P + '/sql/016_unlimited_choices.sql', 'utf8'));
console.log('\n016 applied\n');

console.log('=== THE BACKFILL IS FAITHFUL ===');
{
  const r = await q(`SELECT question_number n, choices, correct_answer FROM public.questions
                     WHERE exam_id=$1 ORDER BY question_number`, [PAPER]);
  ck('the four-choice item became an array of four, in order',
     eq(r[0].choices, ['w', 'x', 'y', 'z']), JSON.stringify(r[0].choices));
  ck('its key still points at the same choice',
     r[0].correct_answer === 2 && r[0].choices[2] === 'y');
  ck('the five-choice item became an array of five',
     eq(r[1].choices, ['v', 'w', 'x', 'y', 'z']), JSON.stringify(r[1].choices));
  ck('and its key still points at the fifth',
     r[1].correct_answer === 4 && r[1].choices[4] === 'z');
  ck('the essay got an empty array, not a row of nulls',
     eq(r[2].choices, []) && r[2].correct_answer === null, JSON.stringify(r[2].choices));
}

console.log('\n=== SEVEN CHOICES, END TO END ===');
const SEVEN = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf'];
{
  await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
             question_text, question_type, choices, correct_answer)
           VALUES ($1,$1,4,'Seven','multiple_choice',$2::jsonb,6)`,
          [PAPER, JSON.stringify(SEVEN)]);
  const r = await q(`SELECT choices, correct_answer, choice_a, choice_e
                     FROM public.questions WHERE exam_id=$1 AND question_number=4`, [PAPER]);
  ck('seven choices are stored as seven', eq(r[0].choices, SEVEN), JSON.stringify(r[0].choices));
  ck('and the key may point at the seventh', r[0].correct_answer === 6);
  ck('the mirror holds the first and fifth for old clients',
     r[0].choice_a === 'alpha' && r[0].choice_e === 'echo',
     `${r[0].choice_a} / ${r[0].choice_e}`);

  const tooFar = await fails(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
      question_text, question_type, choices, correct_answer)
      VALUES ($1,$1,5,'Bad','multiple_choice',$2::jsonb,7)`, [PAPER, JSON.stringify(SEVEN)]);
  ck('a key past the end of the array is refused', !!tooFar, (tooFar || '').slice(0, 70));

  const notArray = await fails(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
      question_text, question_type, choices, correct_answer)
      VALUES ($1,$1,6,'Bad','multiple_choice','"nope"'::jsonb,0)`, [PAPER]);
  ck('choices that are not an array are refused', !!notArray, (notArray || '').slice(0, 70));
}

console.log('\n=== THE MIRROR FOLLOWS EVERY WRITE ===');
{
  await q(`UPDATE public.questions SET choices = $2::jsonb, correct_answer = 0
           WHERE exam_id=$1 AND question_number=4`,
          [PAPER, JSON.stringify(['one', 'two'])]);
  const r = await q(`SELECT choices, choice_a, choice_b, choice_c, choice_d, choice_e
                     FROM public.questions WHERE exam_id=$1 AND question_number=4`, [PAPER]);
  ck('shrinking to two rewrites the mirror',
     r[0].choice_a === 'one' && r[0].choice_b === 'two');
  ck('and clears the columns that no longer have a choice',
     r[0].choice_c === null && r[0].choice_d === null && r[0].choice_e === null,
     JSON.stringify(r[0]));
  const disagree = await q(`SELECT count(*)::int c FROM public.questions
    WHERE choice_a IS DISTINCT FROM (CASE WHEN jsonb_array_length(choices) > 0 THEN choices ->> 0 END)
       OR choice_e IS DISTINCT FROM (CASE WHEN jsonb_array_length(choices) > 4 THEN choices ->> 4 END)`);
  ck('no row anywhere has a mirror that disagrees with its array', disagree[0].c === 0, `${disagree[0].c}`);
  // Put the seven back for the rest of the run.
  await q(`UPDATE public.questions SET choices = $2::jsonb, correct_answer = 6
           WHERE exam_id=$1 AND question_number=4`, [PAPER, JSON.stringify(SEVEN)]);
}

console.log('\n=== A WRITER THAT STILL SPEAKS IN COLUMNS ===');
{
  // The content loader scripts in ~/patts-exam-content (010, 011, 013) INSERT
  // choice_a..choice_e and no array. Before the trigger read the columns as a
  // fallback this nulled every one of them and the row was rejected outright,
  // which would have made 011 and 013 fail the moment 016 was applied.
  await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
             question_text, question_type, choice_a, choice_b, choice_c, choice_d,
             correct_answer)
           VALUES ($1,$1,7,'Legacy-shaped insert','multiple_choice','w','x','y','z',2)`, [PAPER]);
  const r = await q(`SELECT choices, choice_a, choice_d, correct_answer FROM public.questions
                     WHERE exam_id=$1 AND question_number=7`, [PAPER]);
  ck('a choice_a..d INSERT still produces a four-choice item',
     eq(r[0].choices, ['w', 'x', 'y', 'z']), JSON.stringify(r[0].choices));
  ck('its key survives and its columns are intact',
     r[0].correct_answer === 2 && r[0].choice_a === 'w' && r[0].choice_d === 'z');

  await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
             question_text, question_type, choice_a, choice_b, choice_c, choice_d,
             choice_e, correct_answer)
           VALUES ($1,$1,8,'Legacy five','multiple_choice','v','w','x','y','z',4)`, [PAPER]);
  const five = await q(`SELECT choices, correct_answer FROM public.questions
                        WHERE exam_id=$1 AND question_number=8`, [PAPER]);
  ck('and a choice_a..e INSERT keyed to E works too',
     eq(five[0].choices, ['v', 'w', 'x', 'y', 'z']) && five[0].correct_answer === 4,
     JSON.stringify(five[0].choices));

  // An UPDATE that names only a column must resync rather than drift.
  await q(`UPDATE public.questions SET choice_b='CHANGED' WHERE exam_id=$1 AND question_number=7`, [PAPER]);
  const upd = await q(`SELECT choices FROM public.questions WHERE exam_id=$1 AND question_number=7`, [PAPER]);
  ck('updating a single column keeps the array in step',
     eq(upd[0].choices, ['w', 'CHANGED', 'y', 'z']), JSON.stringify(upd[0].choices));

  const essay = await fails(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
      question_text, question_type, choice_a, correct_answer)
      VALUES ($1,$1,9,'An essay','essay',NULL,NULL)`, [PAPER]);
  ck('an essay row with no choices at all is still accepted', essay === null, (essay || '').slice(0, 70));
}

console.log('\n=== MARKING AND REVIEW ===');
{
  const [{ id }] = await q(`SELECT id FROM public.questions WHERE exam_id=$1 AND question_number=4`, [PAPER]);
  const right = await q(`SELECT * FROM public.score_answers($1,$2::jsonb)`, [PAPER, JSON.stringify({ [id]: 6 })]);
  ck('picking the seventh choice marks correct', right[0].score === 1, `${right[0].score}`);
  const wrong = await q(`SELECT * FROM public.score_answers($1,$2::jsonb)`, [PAPER, JSON.stringify({ [id]: 5 })]);
  ck('picking the sixth marks wrong', wrong[0].score === 0);

  await q(`INSERT INTO public.results (student_id, exam_id, assessment_id, score, total_items, answers_json)
           VALUES ($1,$2,$2,1,3,$3::jsonb)`,
          [STU, PAPER, JSON.stringify({ [id]: { chosen: 6, is_correct: true } })]);
  const rev = await q(`SELECT public.get_answer_review($1,$2,NULL) AS j`, [STU, PAPER]);
  const item = rev[0].j.find(r => r.question_number === 4);
  ck('answer review returns all seven choices', item && item.choices.length === 7,
     JSON.stringify(item?.choices));
  ck('with the seventh marked correct and chosen',
     item.choices[6] === 'golf' && item.correct === 6 && item.chosen === 6);
  const four = rev[0].j.find(r => r.question_number === 1);
  ck('and a four-choice item still reviews with exactly four',
     four && four.choices.length === 4 && four.correct === 2, JSON.stringify(four?.choices));
}

console.log('\n=== COPYING A PAPER ===');
{
  await q(`SET test.uid = '${INS}'`);
  const [{ copy }] = await q(
    `SELECT public.duplicate_assessment($1,'Copy','AENG 426',true,true,'latest') AS copy`, [PAPER]);
  const r = await q(`SELECT choices, correct_answer, choice_a FROM public.questions
                     WHERE assessment_id=$1 AND question_number=4`, [copy]);
  ck('the copy keeps all seven choices and the key',
     eq(r[0].choices, SEVEN) && r[0].correct_answer === 6, JSON.stringify(r[0].choices));
  ck('and the trigger filled the copy\'s mirror too', r[0].choice_a === 'alpha');
}

console.log('\n=== GRANTS ===');
{
  const g = await q(`SELECT string_agg(column_name, ',' ORDER BY column_name) cols
                     FROM information_schema.column_privileges
                     WHERE grantee='anon' AND table_name='questions' AND privilege_type='SELECT'`);
  const cols = (g[0].cols || '').split(',');
  ck('anon may read choices', cols.includes('choices'), g[0].cols);
  ck('anon still may NOT read correct_answer', !cols.includes('correct_answer'));
}

console.log('\n=== IDEMPOTENCY: RE-RUNNING MUST NOT NARROW A GROWN ITEM ===');
{
  await x(fs.readFileSync(P + '/sql/016_unlimited_choices.sql', 'utf8'));
  await x(fs.readFileSync(P + '/sql/016_unlimited_choices.sql', 'utf8'));
  const r = await q(`SELECT choices, correct_answer FROM public.questions
                     WHERE exam_id=$1 AND question_number=4`, [PAPER]);
  ck('the seven-choice item is still seven after two more runs',
     eq(r[0].choices, SEVEN) && r[0].correct_answer === 6, JSON.stringify(r[0].choices));
  const four = await q(`SELECT choices FROM public.questions WHERE exam_id=$1 AND question_number=1`, [PAPER]);
  ck('and the backfilled four-choice item is unchanged',
     eq(four[0].choices, ['w', 'x', 'y', 'z']), JSON.stringify(four[0].choices));
}

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
