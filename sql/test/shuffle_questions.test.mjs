// Runs 001 + 002 + 012 + 016 + 017 against real PostgreSQL (PGlite). 017 adds
// the question-order switch beside the choice one, so what matters is that the
// default changes nothing, the two are independent, and a duplicated paper
// carries both rather than quietly reverting to shuffling.
//   npm run test:shuffle-questions
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
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;`);
const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);

const INS = 'd24df77e-309a-4ed8-988f-da3ee1c76408';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');`);
for (const f of ['001_assessments_and_lessons', '002_review_mode_and_server_scoring',
                 '003_lock_answer_key', '012_five_option_items', '016_unlimited_choices']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

const PAPER = '67d25e6e-a4d7-45eb-96d2-01bb22241274';
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id,
           is_open, duration_minutes)
         VALUES ('${PAPER}','exam','A paper','AENG 426','${INS}',true,60);
  INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choices, correct_answer)
  VALUES ('${PAPER}','${PAPER}',1,'One','multiple_choice','["w","x","y","z"]'::jsonb,2);`);

console.log('=== BEFORE 017 ===');
{
  let missing = false;
  try { await q(`SELECT shuffle_questions FROM public.assessments LIMIT 1`); }
  catch { missing = true; }
  ck('shuffle_questions does not exist yet', missing);
  const c = await q(`SELECT shuffle_choices FROM public.assessments WHERE id=$1`, [PAPER]);
  ck('but shuffle_choices from 012 is already there and on', c[0].shuffle_choices === true);
}

await x(fs.readFileSync(P + '/sql/017_shuffle_questions_switch.sql', 'utf8'));
console.log('\n017 applied\n');

console.log('=== THE DEFAULT CHANGES NOTHING ===');
{
  const c = await q(`SELECT column_name, is_nullable, column_default FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='assessments'
                       AND column_name='shuffle_questions'`);
  ck('shuffle_questions exists, NOT NULL, defaulting true',
     c.length === 1 && c[0].is_nullable === 'NO' && /true/.test(c[0].column_default || ''),
     JSON.stringify(c));
  const r = await q(`SELECT count(*)::int n,
                            count(*) FILTER (WHERE shuffle_questions)::int sq,
                            count(*) FILTER (WHERE shuffle_choices)::int sc
                     FROM public.assessments`);
  ck('every paper that already existed still shuffles both',
     r[0].n === r[0].sq && r[0].n === r[0].sc, JSON.stringify(r[0]));
}

console.log('\n=== THE TWO SWITCHES ARE INDEPENDENT ===');
{
  const combos = [[true, true], [false, true], [true, false], [false, false]];
  for (const [sq, sc] of combos) {
    await q(`UPDATE public.assessments SET shuffle_questions=$2, shuffle_choices=$3 WHERE id=$1`,
            [PAPER, sq, sc]);
    const r = await q(`SELECT shuffle_questions, shuffle_choices FROM public.assessments WHERE id=$1`, [PAPER]);
    ck(`questions=${sq}, choices=${sc} is stored as given`,
       r[0].shuffle_questions === sq && r[0].shuffle_choices === sc, JSON.stringify(r[0]));
  }
  const nulled = await (async () => {
    try { await q(`UPDATE public.assessments SET shuffle_questions=NULL WHERE id=$1`, [PAPER]); return null; }
    catch (e) { return e.message; }
  })();
  ck('it cannot be set to NULL — "unset" is not a third state', !!nulled, (nulled || '').slice(0, 60));
}

console.log('\n=== ANON CAN READ BOTH, AND STILL NOT THE PASSWORD ===');
{
  const g = await q(`SELECT string_agg(column_name, ',' ORDER BY column_name) cols
                     FROM information_schema.column_privileges
                     WHERE grantee='anon' AND table_name='assessments' AND privilege_type='SELECT'`);
  const cols = (g[0].cols || '').split(',');
  ck('anon may read shuffle_questions', cols.includes('shuffle_questions'), g[0].cols);
  ck('anon may read shuffle_choices', cols.includes('shuffle_choices'));
  ck('anon still may not read exam_password', !cols.includes('exam_password'));
}

console.log('\n=== A COPY CARRIES BOTH SWITCHES ===');
{
  // Without this a duplicated paper silently goes back to shuffling, which is
  // the opposite of what someone who turned it off would expect.
  await q(`UPDATE public.assessments SET shuffle_questions=false, shuffle_choices=false WHERE id=$1`, [PAPER]);
  await q(`SET test.uid = '${INS}'`);
  const [{ copy }] = await q(
    `SELECT public.duplicate_assessment($1,'Copy','AENG 426',true,true,'latest') AS copy`, [PAPER]);
  const r = await q(`SELECT shuffle_questions, shuffle_choices FROM public.assessments WHERE id=$1`, [copy]);
  ck('the copy keeps both switches off',
     r[0].shuffle_questions === false && r[0].shuffle_choices === false, JSON.stringify(r[0]));
  const qs = await q(`SELECT choices, correct_answer FROM public.questions WHERE assessment_id=$1`, [copy]);
  ck('and still carries its questions', qs.length === 1 && qs[0].correct_answer === 2);

  await q(`UPDATE public.assessments SET shuffle_questions=true, shuffle_choices=false WHERE id=$1`, [PAPER]);
  const [{ copy: c2 }] = await q(
    `SELECT public.duplicate_assessment($1,'Copy 2','AENG 426',true,true,'latest') AS copy`, [PAPER]);
  const r2 = await q(`SELECT shuffle_questions, shuffle_choices FROM public.assessments WHERE id=$1`, [c2]);
  ck('a mixed pair is copied as the mixed pair, not flattened',
     r2[0].shuffle_questions === true && r2[0].shuffle_choices === false, JSON.stringify(r2[0]));
}

console.log('\n=== IDEMPOTENCY ===');
{
  await q(`UPDATE public.assessments SET shuffle_questions=false WHERE id=$1`, [PAPER]);
  await x(fs.readFileSync(P + '/sql/017_shuffle_questions_switch.sql', 'utf8'));
  await x(fs.readFileSync(P + '/sql/017_shuffle_questions_switch.sql', 'utf8'));
  const r = await q(`SELECT shuffle_questions FROM public.assessments WHERE id=$1`, [PAPER]);
  ck('re-running twice more does not switch a paper back on', r[0].shuffle_questions === false);
}

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
