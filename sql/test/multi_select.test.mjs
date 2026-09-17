// Runs 001 + 002 + 003 + 012 + 016 + 017 + 018 against real PostgreSQL
// (PGlite). 018 adds a question type whose whole definition is a marking rule,
// so what matters is not that the column exists but that score_answers()
// refuses the point for a set that is nearly right.
//
//   npm run test:multi-select
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
const STU2 = '22222222-2222-2222-2222-222222222222';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.users (id, full_name, section) VALUES
    ('${STU}','S One','AENG 426'), ('${STU2}','S Two','AENG 426');`);
for (const f of ['001_assessments_and_lessons', '002_review_mode_and_server_scoring',
                 '003_lock_answer_key', '012_five_option_items',
                 '016_unlimited_choices', '017_shuffle_questions_switch']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

// A paper as it stands before 018: one ordinary four-choice item and an essay.
const PAPER = '67d25e6e-a4d7-45eb-96d2-01bb22241274';
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id,
           is_open, duration_minutes, show_answers, allow_retakes)
         VALUES ('${PAPER}','exam','Controls','AENG 426','${INS}',true,60,true,false);
  INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choices, correct_answer)
  VALUES
   ('${PAPER}','${PAPER}',1,'Single','multiple_choice','["w","x","y","z"]'::jsonb,2),
   ('${PAPER}','${PAPER}',9,'Write about it','essay','[]'::jsonb,NULL);`);

console.log('=== BEFORE 018: a multi-answer item cannot even be written ===');
{
  const e = await fails(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
    question_text, question_type, choices) VALUES
    ($1,$1,2,'Several','multi_select','["a","b","c"]'::jsonb)`, [PAPER]);
  ck('the type is rejected by the pre-018 CHECK', e !== null, e || 'accepted');
}

await x(fs.readFileSync(P + '/sql/018_multi_select_items.sql', 'utf8'));

console.log('\n=== NOTHING EXISTING WAS CONVERTED ===');
{
  const r = await q(`SELECT count(*)::int n,
    count(*) FILTER (WHERE question_type='multi_select')::int multi,
    count(*) FILTER (WHERE correct_answers IS NOT NULL)::int keyed
    FROM public.questions`);
  ck('every item that existed is still single-answer or an essay',
     r[0].multi === 0 && r[0].keyed === 0, JSON.stringify(r[0]));
  const s = await q(`SELECT correct_answer FROM public.questions WHERE question_number=1`);
  ck('and the four-choice item keeps its key', s[0].correct_answer === 2);
}

console.log('\n=== WRITING A MULTI-ANSWER ITEM ===');
const MULTI = (await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
    question_text, question_type, choices, correct_answers)
  VALUES ($1,$1,2,'Which are control surfaces?','multi_select',
          '["Aileron","Elevator","Rudder","Flap","Slat"]'::jsonb, '[2,0,1]'::jsonb)
  RETURNING id, correct_answers`, [PAPER]))[0];
ck('the key is stored sorted and de-duplicated by the trigger',
   eq(MULTI.correct_answers, [0, 1, 2]), JSON.stringify(MULTI.correct_answers));
{
  const r = await q(`SELECT choice_a, choice_e FROM public.questions WHERE id=$1`, [MULTI.id]);
  ck('016’s mirror still fills the legacy columns for it',
     r[0].choice_a === 'Aileron' && r[0].choice_e === 'Slat');
}

console.log('\n=== A KEY THAT CANNOT BE MARKED IS REFUSED ===');
{
  let e = await fails(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
    question_text, question_type, choices, correct_answers)
    VALUES ($1,$1,3,'Nothing ticked','multi_select','["a","b"]'::jsonb,'[]'::jsonb)`, [PAPER]);
  ck('an empty key is refused', e !== null, e || 'accepted');

  e = await fails(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
    question_text, question_type, choices, correct_answers)
    VALUES ($1,$1,3,'No key at all','multi_select','["a","b"]'::jsonb,NULL)`, [PAPER]);
  ck('a multi-answer item with no key at all is refused', e !== null, e || 'accepted');

  e = await fails(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
    question_text, question_type, choices, correct_answers)
    VALUES ($1,$1,3,'Past the end','multi_select','["a","b"]'::jsonb,'[0,5]'::jsonb)`, [PAPER]);
  ck('a key pointing past the last choice is refused', e !== null, e || 'accepted');

  e = await fails(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
    question_text, question_type, choices, correct_answer, correct_answers)
    VALUES ($1,$1,3,'Both keys','multi_select','["a","b"]'::jsonb,0,'[1]'::jsonb)`, [PAPER]);
  ck('carrying BOTH keys is refused, so marking is never ambiguous', e !== null, e || 'accepted');

  e = await fails(`INSERT INTO public.questions (exam_id, assessment_id, question_number,
    question_text, question_type, choices, correct_answer, correct_answers)
    VALUES ($1,$1,3,'Set on a single item','multiple_choice','["a","b"]'::jsonb,0,'[1]'::jsonb)`, [PAPER]);
  ck('a set on a single-answer item is refused too', e !== null, e || 'accepted');

  e = await fails(`UPDATE public.questions SET choices='["a","b"]'::jsonb WHERE id=$1`, [MULTI.id]);
  ck('shrinking the choices under an existing key is refused', e !== null, e || 'accepted');
}

console.log('\n=== MARKING: ALL OR NOTHING ===');
// Question 2 keys {0,1,2} of five; question 1 keys 2 of four.
const score = async (answers) => (await q(
  `SELECT score, total_items, answers_json FROM public.score_answers($1,$2::jsonb)`,
  [PAPER, JSON.stringify(answers)]))[0];
{
  const all = await score({ [MULTI.id]: [0, 1, 2] });
  ck('every right answer and nothing else scores the point', all.score === 1, JSON.stringify(all));
  ck('the essay is not counted among the markable items', all.total_items === 2, `${all.total_items}`);
  ck('the answer is stored as an ARRAY, so a reader can tell the type',
     eq(all.answers_json[MULTI.id].chosen, [0, 1, 2]), JSON.stringify(all.answers_json));

  const order = await score({ [MULTI.id]: [2, 0, 1] });
  ck('the order they were ticked in does not matter', order.score === 1);

  const short = await score({ [MULTI.id]: [0, 1] });
  ck('MISSING ONE scores nothing — the rule that was asked for', short.score === 0);
  ck('and it is recorded as wrong, not as unanswered',
     short.answers_json[MULTI.id].is_correct === false, JSON.stringify(short.answers_json));

  const extra = await score({ [MULTI.id]: [0, 1, 2, 3] });
  ck('one extra tick scores nothing either', extra.score === 0);

  const dupes = await score({ [MULTI.id]: [0, 1, 2, 2] });
  ck('the same answer ticked twice is still one answer', dupes.score === 1);

  const blank = await score({ [MULTI.id]: [] });
  ck('every box unticked scores nothing', blank.score === 0);
  ck('and is recorded as BLANK rather than as a wrong answer given',
     !(MULTI.id in blank.answers_json), JSON.stringify(blank.answers_json));

  const wrongShape = await score({ [MULTI.id]: 0 });
  ck('one index sent for a multi-answer item is one tick, so it is wrong',
     wrongShape.score === 0);
}

console.log('\n=== SINGLE-ANSWER ITEMS ARE UNTOUCHED ===');
{
  const single = (await q(`SELECT id FROM public.questions WHERE question_number=1`))[0].id;
  const r = await score({ [single]: 2 });
  ck('a plain index still marks as it always has', r.score === 1, JSON.stringify(r));
  ck('and is still stored as a plain integer, not an array',
     r.answers_json[single].chosen === 2, JSON.stringify(r.answers_json));
  const w = await score({ [single]: 1 });
  ck('a wrong pick is still wrong', w.score === 0);
  const asArray = await score({ [single]: [2] });
  ck('a one-element array is read as that same pick', asArray.score === 1);
  const both = await score({ [single]: 2, [MULTI.id]: [0, 1, 2] });
  ck('a paper mixing both types scores both', both.score === 2 && both.total_items === 2,
     JSON.stringify(both));
}

console.log('\n=== END TO END THROUGH submit_assessment() ===');
{
  const r = (await q(`SELECT public.submit_assessment($1,$2,$3::jsonb) o`,
    [STU, PAPER, JSON.stringify({ [MULTI.id]: [0, 1, 2] })]))[0].o;
  ck('a student ticking the whole key scores 1 of 2', r.score === 1 && r.total_items === 2,
     JSON.stringify(r));
  const r2 = (await q(`SELECT public.submit_assessment($1,$2,$3::jsonb) o`,
    [STU2, PAPER, JSON.stringify({ [MULTI.id]: [0, 1] })]))[0].o;
  ck('a student one tick short scores 0 of 2', r2.score === 0 && r2.total_items === 2,
     JSON.stringify(r2));
  const stored = await q(`SELECT student_id, score, answers_json FROM public.results
                          WHERE exam_id=$1 ORDER BY score DESC`, [PAPER]);
  ck('both papers are filed in results', stored.length === 2);
  ck('the near-miss is on file as a wrong answer with what was actually ticked',
     stored[1].answers_json[MULTI.id].is_correct === false
     && eq(stored[1].answers_json[MULTI.id].chosen, [0, 1]),
     JSON.stringify(stored[1].answers_json));
}

console.log('\n=== ANSWER REVIEW CARRIES THE SET ===');
{
  const rows = (await q(`SELECT public.get_answer_review($1,$2) r`, [STU2, PAPER]))[0].r;
  const item = rows.find(x => x.question_id === MULTI.id);
  ck('the review names the type, so the client knows to draw tick boxes',
     item.question_type === 'multi_select', JSON.stringify(item));
  ck('it carries the whole key, not one index',
     eq(item.correct_set, [0, 1, 2]), JSON.stringify(item.correct_set));
  ck('and what the student ticked, as a set',
     eq(item.chosen, [0, 1]), JSON.stringify(item.chosen));
  ck('marked wrong, as the student was', item.is_correct === false);
  const plain = rows.find(x => x.question_id !== MULTI.id);
  ck('a single-answer item still reports one index and no set',
     plain.correct === 2 && plain.correct_set === null, JSON.stringify(plain));
  ck('and its `chosen` is still a number', plain.chosen === null || typeof plain.chosen === 'number',
     JSON.stringify(plain.chosen));
}

console.log('\n=== THE KEY STAYS OUT OF THE BROWSER ===');
{
  const g = await q(`SELECT string_agg(column_name, ',' ORDER BY column_name) cols
                     FROM information_schema.column_privileges
                     WHERE grantee='anon' AND table_name='questions' AND privilege_type='SELECT'`);
  const cols = (g[0].cols || '').split(',');
  ck('anon may read choices', cols.includes('choices'), g[0].cols);
  ck('anon may NOT read correct_answer', !cols.includes('correct_answer'));
  ck('anon may NOT read correct_answers either', !cols.includes('correct_answers'));
}

console.log('\n=== COPYING A PAPER CARRIES THE SET ===');
{
  await x(`SET test.uid = '${INS}'`);
  const copy = (await q(`SELECT public.duplicate_assessment($1,'Mock Controls','Pre-Boards PATTS') id`,
    [PAPER]))[0].id;
  const r = await q(`SELECT question_type, correct_answer, correct_answers FROM public.questions
                     WHERE exam_id=$1 ORDER BY question_number`, [copy]);
  ck('the copy has all three items', r.length === 3, `${r.length}`);
  ck('the multi-answer item arrives with its key intact',
     r[1].question_type === 'multi_select' && eq(r[1].correct_answers, [0, 1, 2]),
     JSON.stringify(r[1]));
  ck('and the single-answer one with its index', r[0].correct_answer === 2);
  const marked = (await q(`SELECT score FROM public.score_answers($1,$2::jsonb)`,
    [copy, JSON.stringify({ [(await q(`SELECT id FROM public.questions WHERE exam_id=$1 AND question_number=2`, [copy]))[0].id]: [0, 1, 2] })]))[0];
  ck('the copy marks its own multi-answer item', marked.score === 1, JSON.stringify(marked));
  await x(`RESET test.uid`);
}

console.log('\n=== IDEMPOTENCY: RE-RUNNING CHANGES NOTHING ===');
{
  await x(fs.readFileSync(P + '/sql/018_multi_select_items.sql', 'utf8'));
  await x(fs.readFileSync(P + '/sql/018_multi_select_items.sql', 'utf8'));
  const r = await q(`SELECT correct_answers FROM public.questions WHERE id=$1`, [MULTI.id]);
  ck('the key survives two more runs', eq(r[0].correct_answers, [0, 1, 2]),
     JSON.stringify(r[0].correct_answers));
  const again = await score({ [MULTI.id]: [0, 1] });
  ck('and a near miss still scores nothing', again.score === 0);
}

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
