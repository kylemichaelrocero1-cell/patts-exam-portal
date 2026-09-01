// Runs 001 + 002 + 008 against real PostgreSQL (PGlite) and asserts what 008
// is actually for: every Pre-Boards paper ends up in review mode whatever
// state it started in, papers for other sections are untouched, and a paper
// that is only PARTLY Pre-Boards still counts as Pre-Boards.
//   npm run test:preboards
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const db = new PGlite();
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };

await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;`);
const setup = fs.readFileSync('supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);

const INS = 'd24df77e-309a-4ed8-988f-da3ee1c76408';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.exams (id,title,target_section,instructor_id,is_open,duration_minutes)
    VALUES ('67d25e6e-a4d7-45eb-96d2-01bb22241274','Seed','AENG 426','${INS}',false,60);`);
await x(fs.readFileSync('sql/001_assessments_and_lessons.sql', 'utf8'));
await x(fs.readFileSync('sql/002_review_mode_and_server_scoring.sql', 'utf8'));

// The default that makes 008 worth running at all.
{
  await x(`INSERT INTO public.assessments (kind,title,target_section,instructor_id,is_open,duration_minutes)
           VALUES ('exam','Default Probe','Pre-Boards PATTS','${INS}',false,60);`);
  const r = (await q(`SELECT allow_retakes,show_answers,score_policy FROM public.assessments WHERE title='Default Probe'`))[0];
  ck("a fresh row defaults to score_policy 'first'", r.score_policy === 'first', r.score_policy);
  ck('a fresh row defaults to no retakes and no answers',
     r.allow_retakes === false && r.show_answers === false, `${r.allow_retakes}/${r.show_answers}`);
}

const mk = (title, section, ar, sa, sp) =>
  x(`INSERT INTO public.assessments (kind,title,target_section,instructor_id,is_open,duration_minutes,
       allow_retakes,show_answers,score_policy)
     VALUES ('exam','${title}','${section}','${INS}',true,60,${ar},${sa},'${sp}');`);

await mk('Already Right',    'Pre-Boards PATTS',            true,  true,  'latest');
await mk('Policy Wrong',     'Pre-Boards PATTS',            true,  true,  'first');   // the quiet one
await mk('Answers Off',      'Pre-Boards PATTS',            true,  false, 'latest');
await mk('Retakes Off',      'Pre-Boards PATTS',            false, true,  'latest');
await mk('Multi Section',    'AENG 426, Pre-Boards PATTS',  false, false, 'first');
await mk('Padded Section',   'AENG 426 ,  Pre-Boards PATTS', false, false, 'highest');
await mk('Real Exam 426',    'AENG 426',                    false, false, 'first');   // must NOT change
await mk('Real Exam 325',    'AENG 325 - 1',                false, false, 'first');   // must NOT change
await mk('Lookalike',        'Pre-Boards PATTS Extra',      false, false, 'first');   // must NOT change

const before = await q(`SELECT title,allow_retakes,show_answers,score_policy FROM public.assessments ORDER BY title`);

// Apply the migration proper. The VERIFY queries after COMMIT are for a human
// reading the SQL editor output, so run only the part up to and including it.
const SQL008 = fs.readFileSync('sql/008_preboards_review_settings.sql', 'utf8');
const migration = SQL008.slice(0, SQL008.indexOf('COMMIT;') + 'COMMIT;'.length);
await x(migration);

const after = Object.fromEntries((await q(
  `SELECT title,allow_retakes,show_answers,score_policy FROM public.assessments`)).map(r => [r.title, r]));

const inReview = t => after[t].allow_retakes === true && after[t].show_answers === true && after[t].score_policy === 'latest';

console.log('\n=== PRE-BOARDS PAPERS ARE PUT INTO REVIEW MODE ===');
for (const t of ['Default Probe','Already Right','Policy Wrong','Answers Off','Retakes Off','Multi Section','Padded Section'])
  ck(`${t} -> retakes+answers+latest`, inReview(t),
     `${after[t].allow_retakes}/${after[t].show_answers}/${after[t].score_policy}`);

console.log('\n=== EVERYTHING ELSE IS LEFT ALONE ===');
for (const t of ['Real Exam 426','Real Exam 325','Lookalike']) {
  const b = before.find(r => r.title === t), a = after[t];
  ck(`${t} untouched`, b.allow_retakes === a.allow_retakes && b.show_answers === a.show_answers
     && b.score_policy === a.score_policy, `${a.allow_retakes}/${a.show_answers}/${a.score_policy}`);
}
ck('no answer key opened outside Pre-Boards',
   (await q(`SELECT count(*)::int c FROM public.assessments a WHERE a.show_answers
             AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(coalesce(a.target_section,''),',')) t(x)
                             WHERE btrim(t.x)='Pre-Boards PATTS')`))[0].c === 0);

console.log('\n=== IDEMPOTENCY ===');
{
  await x(migration);
  const n = (await q(`SELECT count(*)::int c FROM public.assessments a WHERE
      EXISTS (SELECT 1 FROM unnest(string_to_array(coalesce(a.target_section,''),',')) t(x) WHERE btrim(t.x)='Pre-Boards PATTS')
      AND (a.allow_retakes IS DISTINCT FROM true OR a.show_answers IS DISTINCT FROM true
           OR a.score_policy IS DISTINCT FROM 'latest')`))[0].c;
  ck('re-running leaves nothing out of review mode', n === 0, String(n));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
