// Runs supabase_setup's verify_exam_password + 001 + 019 against real
// PostgreSQL (PGlite). The function read `exams`; 001 moved every paper to
// `assessments` and syncs only one way, so a paper created after the cutover
// had no legacy row and the check returned TRUE for any password at all.
//   npm run test:exam-password
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

// The original function, lifted verbatim from supabase_setup.sql.
const original = setup.match(
  /CREATE OR REPLACE FUNCTION public\.verify_exam_password[\s\S]*?END; \$\$;/);
if (!original) { console.error('could not find verify_exam_password in supabase_setup.sql'); process.exit(1); }
await x(original[0]);

const INS = 'd24df77e-309a-4ed8-988f-da3ee1c76408';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');`);
await x(fs.readFileSync(P + '/sql/001_assessments_and_lessons.sql', 'utf8'));

// LEGACY — written to `exams`, so the sync trigger mirrors it into assessments.
const LEGACY = '67d25e6e-a4d7-45eb-96d2-01bb22241274';
await x(`INSERT INTO public.exams (id, title, target_section, instructor_id,
           is_open, duration_minutes, exam_password, has_password)
         VALUES ('${LEGACY}','Midterms 2024','AENG 426','${INS}',true,60,'ALPHA',true);`);

// NEW — exactly what AdminDashboard.createExam() does after the cutover:
// straight into `assessments`, no legacy row anywhere.
const NEW = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b33';
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id,
           is_open, duration_minutes, exam_password, has_password)
         VALUES ('${NEW}','exam','Finals 2025','AENG 426','${INS}',true,60,'BRAVO',true);`);

// OPEN — a paper with no password at all.
const OPEN = '3f2b6c88-7d41-4e55-b0a9-8c7e5d4f3a21';
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id,
           is_open, duration_minutes)
         VALUES ('${OPEN}','seatwork','Seatwork 1','AENG 426','${INS}',true,30);`);

const check = async (id, pw) => (await q(`SELECT public.verify_exam_password($1,$2) AS ok`, [id, pw]))[0].ok;

console.log('=== BEFORE 019 — the bug as students met it ===');
{
  ck('a legacy paper still refuses a wrong password', await check(LEGACY, 'nope') === false);
  ck('a legacy paper accepts the right one',          await check(LEGACY, 'ALPHA') === true);
  // The report: "a student clicked an exam and got in even though there's a password."
  ck('BUG — a paper created after 001 takes ANY password',
     await check(NEW, 'literally-anything') === true);
  ck('BUG — and an id that does not exist is waved through',
     await check('00000000-0000-0000-0000-000000000000', '') === true);
}

console.log('\n=== AFTER 019 ===');
await x(fs.readFileSync(P + '/sql/019_exam_password_on_assessments.sql', 'utf8'));
{
  ck('a paper created after 001 now refuses a wrong password',
     await check(NEW, 'literally-anything') === false);
  ck('and accepts the right one',                await check(NEW, 'BRAVO') === true);
  ck('a legacy paper still refuses a wrong one', await check(LEGACY, 'nope') === false);
  ck('a legacy paper still accepts the right one', await check(LEGACY, 'ALPHA') === true);
  ck('an unlocked paper still lets everyone in', await check(OPEN, '') === true);
  ck('an unknown id is refused',                 await check('00000000-0000-0000-0000-000000000000', 'x') === false);
  ck('a null id is refused',                     await check(null, 'x') === false);
  ck('a null password never matches a set one',  await check(NEW, null) === false);

  // Broken data: locked with nothing behind it. Fail closed — the student is
  // being shown a gate, so the gate must not be a formality.
  const BROKEN = '5d7e9f11-3a2b-4c6d-8e0f-1a2b3c4d5e6f';
  await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id,
             is_open, duration_minutes, has_password)
           VALUES ('${BROKEN}','exam','Half-set','AENG 426','${INS}',true,60,true);`);
  ck('a paper claiming a password with none stored is refused, not opened',
     await check(BROKEN, 'anything') === false);

  // Rerunning a migration must be safe.
  await x(fs.readFileSync(P + '/sql/019_exam_password_on_assessments.sql', 'utf8'));
  ck('019 is idempotent', await check(NEW, 'BRAVO') === true && await check(NEW, 'no') === false);

  const g = await q(`SELECT count(*)::int c FROM information_schema.role_routine_grants
                     WHERE routine_name='verify_exam_password' AND grantee IN ('anon','authenticated')`);
  ck('anon and authenticated may still call it', g[0].c >= 2, `${g[0].c}`);
}

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
