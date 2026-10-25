// Runs sql/094 against real PostgreSQL (PGlite), on the policies and grants
// production has (supabase_setup.sql + 001 + 002 + 009), and replays what
// happened: an instructor deletes their class list, and students who are
// also in a colleague's section must come through with their account, their
// colleague's section and their colleague's results intact.
//   npm run test:remove-students
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
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`);

const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);
await x(setup.slice(setup.indexOf('ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY'),
                    setup.indexOf('-- 6. REALTIME')));
await x(fs.readFileSync(P + '/sql/001_assessments_and_lessons.sql', 'utf8'));
await x(fs.readFileSync(P + '/sql/002_review_mode_and_server_scoring.sql', 'utf8'));
await x(fs.readFileSync(P + '/sql/009_section_ownership.sql', 'utf8'));

// Look-alike people and papers, not the real ones.
const KAI = 'a0000000-0000-0000-0000-0000000000a1';   // teaches ESCI 316 -1
const BEA = 'b0000000-0000-0000-0000-0000000000b1';   // teaches AENG 223L
const COL = 'c0000000-0000-0000-0000-0000000000c1';   // teaches nothing yet
const KAI_QUIZ = 'a1000000-0000-0000-0000-000000000001';
const BEA_QUIZ = 'b1000000-0000-0000-0000-000000000001';
const BOTH  = '11111111-0000-0000-0000-000000000001'; // ESCI + AENG, sat Kai's quiz
const ONLYB = '11111111-0000-0000-0000-000000000002'; // AENG only, sat Bea's quiz
const LEFTK = '11111111-0000-0000-0000-000000000003'; // AENG only now, but sat Kai's quiz
const ONLYK = '11111111-0000-0000-0000-000000000004'; // ESCI only

await x(`INSERT INTO auth.users VALUES ('${KAI}','kai@p.ph'),('${BEA}','bea@p.ph'),('${COL}','col@p.ph');
  INSERT INTO public.instructors (id,email,full_name) VALUES
    ('${KAI}','kai@p.ph','Kai'),('${BEA}','bea@p.ph','Bea'),('${COL}','col@p.ph','Col');
  INSERT INTO public.section_instructors (section_name,instructor_id,added_by) VALUES
    ('ESCI 316 -1','${KAI}','${KAI}'), ('AENG 223L','${BEA}','${BEA}');
  INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,duration_minutes) VALUES
    ('${KAI_QUIZ}','exam','Look-alike Quiz','ESCI 316 -1','${KAI}',false,60),
    ('${BEA_QUIZ}','exam','Look-alike Lab Quiz','AENG 223L','${BEA}',false,60);
  INSERT INTO public.users (id,full_name,section,student_email,student_code) VALUES
    ('${BOTH}','Both Courses','ESCI 316 -1, AENG 223L','both@s.ph','S-1'),
    ('${ONLYB}','Lab Only','AENG 223L','lab@s.ph','S-2'),
    ('${LEFTK}','Left Kai','AENG 223L','left@s.ph','S-3'),
    ('${ONLYK}','Esci Only','ESCI 316 -1','esci@s.ph','S-4');
  INSERT INTO public.results (student_id,exam_id,assessment_id,score,total_items) VALUES
    ('${BOTH}','${KAI_QUIZ}','${KAI_QUIZ}',20,30),
    ('${ONLYB}','${BEA_QUIZ}','${BEA_QUIZ}',9,10),
    ('${LEFTK}','${KAI_QUIZ}','${KAI_QUIZ}',15,30),
    ('${ONLYK}','${KAI_QUIZ}','${KAI_QUIZ}',17,30);
  INSERT INTO public.live_sessions (student_id,exam_id,assessment_id,status) VALUES
    ('${BOTH}','${KAI_QUIZ}','${KAI_QUIZ}','finished');`);

const as = async (role, uid, sql, params) => {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid || '']);
  await x(`SET ROLE ${role}`);
  try { return await q(sql, params); }
  finally { await x(`RESET ROLE`); }
};
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const count = async (sql) => (await q(sql))[0].c;

console.log('\n=== BEFORE 094: the delete that did the damage ===');
await x('BEGIN');
await as('authenticated', BEA, `DELETE FROM public.results WHERE student_id='${BOTH}'`);
await as('authenticated', BEA, `DELETE FROM public.users WHERE id='${BOTH}'`);
ck("Bea's dashboard could delete Kai's student and Kai's result",
   (await count(`SELECT count(*)::int c FROM public.results WHERE student_id='${BOTH}'`)) === 0);
await x('ROLLBACK');

const mig = fs.readFileSync(P + '/sql/094_removing_a_student_keeps_other_instructors_students.sql', 'utf8');
await x(mig);
console.log('\n094 applied');
try { await x(mig); ck('re-runs without error', true); }
catch (e) { ck('re-runs without error', false, e.message); }

console.log('\n=== VERIFY ===');
{
  const v = (await q(mig.slice(mig.lastIndexOf('SELECT\n'))))[0];
  ck('every VERIFY column is true', Object.values(v).every(b => b === true), JSON.stringify(v));
}

console.log('\n=== DIRECT WRITES ARE CLOSED ===');
ck('an instructor can no longer delete a student row',
   /permission denied/i.test(await fails(() => as('authenticated', BEA, `DELETE FROM public.users WHERE id='${BOTH}'`)) || ''));
ck('nor can a student (anon)',
   /permission denied/i.test(await fails(() => as('anon', null, `DELETE FROM public.users WHERE id='${BOTH}'`)) || ''));

let r = await as('authenticated', BEA, `DELETE FROM public.results WHERE student_id='${BOTH}' RETURNING id`);
ck("Bea cannot delete a result on Kai's paper", r.length === 0, `rows=${r.length}`);
r = await as('authenticated', BEA, `DELETE FROM public.live_sessions WHERE student_id='${BOTH}' RETURNING id`);
ck("nor a sitting on Kai's paper", r.length === 0, `rows=${r.length}`);

ck("Bea cannot take Kai's section off a student",
   /ESCI 316 -1/.test(await fails(() => as('authenticated', BEA,
     `UPDATE public.users SET section='AENG 223L' WHERE id='${BOTH}'`)) || ''));
await as('authenticated', BEA, `UPDATE public.users SET section='ESCI 316 -1, AENG 223L, AENG 223L-B' WHERE id='${BOTH}'`);
ck('adding a section is still free (the import, the roster)',
   (await q(`SELECT section FROM public.users WHERE id='${BOTH}'`))[0].section.endsWith('AENG 223L-B'));
r = await fails(() => as('authenticated', BEA, `UPDATE public.users SET section='ESCI 316 -1' WHERE id='${BOTH}'`));
ck('she may take off her own section, and one nobody holds', r === null, r || '');
await x(`UPDATE public.users SET section='ESCI 316 -1, AENG 223L' WHERE id='${BOTH}'`);

r = await fails(() => as('anon', null, `UPDATE public.users SET session_token='t-1' WHERE id='${ONLYK}'`));
ck('a student still logs in (anon writes session_token)', r === null, r || '');
ck('the SQL editor (postgres) is not held to the section rule',
   await fails(() => q(`UPDATE public.users SET section='ESCI 316 -1' WHERE id='${ONLYK}'`)) === null);

console.log('\n=== OWN PAPERS STILL WORK ===');
await x(`INSERT INTO public.results (student_id,exam_id,assessment_id,score,total_items)
         VALUES ('${ONLYB}','${KAI_QUIZ}','${KAI_QUIZ}',1,30)`);
r = await as('authenticated', KAI, `DELETE FROM public.results WHERE student_id='${ONLYB}' AND exam_id='${KAI_QUIZ}' RETURNING id`);
ck("Kai can delete a result on his own paper (Results tab)", r.length === 1, `rows=${r.length}`);
await x(`INSERT INTO public.section_instructors (section_name,instructor_id,added_by) VALUES ('ESCI 316 -1','${COL}','${KAI}')`);
await x(`INSERT INTO public.results (student_id,exam_id,assessment_id,score,total_items)
         VALUES ('${ONLYB}','${KAI_QUIZ}','${KAI_QUIZ}',1,30)`);
r = await as('authenticated', COL, `DELETE FROM public.results WHERE student_id='${ONLYB}' AND exam_id='${KAI_QUIZ}' RETURNING id`);
ck('a co-instructor Kai granted can too', r.length === 1, `rows=${r.length}`);
await x(`DELETE FROM public.section_instructors WHERE instructor_id='${COL}'`);

console.log('\n=== THE REPLAY: Bea removes her whole class list ===');
const out = await as('authenticated', BEA,
  `SELECT student, outcome FROM public.remove_students_from_my_sections($1::uuid[]) ORDER BY student`,
  [[BOTH, ONLYB, LEFTK, ONLYK]]);
const got = Object.fromEntries(out.map(o => [o.student, o.outcome]));
ck('a student also in Kai\'s section: only AENG 223L comes off', got[BOTH] === 'section_removed', got[BOTH]);
ck('her own-only student with nothing elsewhere: deleted', got[ONLYB] === 'deleted', got[ONLYB]);
ck('her student who sat Kai\'s quiz: account kept', got[LEFTK] === 'kept', got[LEFTK]);
ck('Kai\'s student she does not teach: untouched', got[ONLYK] === 'not_yours', got[ONLYK]);

const sec = Object.fromEntries((await q(`SELECT id, section FROM public.users`)).map(u => [u.id, u.section]));
ck('BOTH keeps ESCI 316 -1', sec[BOTH] === 'ESCI 316 -1', sec[BOTH]);
ck('LEFTK is in no section', sec[LEFTK] === null, String(sec[LEFTK]));
ck('ONLYK is unchanged', sec[ONLYK] === 'ESCI 316 -1', sec[ONLYK]);
ck('ONLYB is gone', !(ONLYB in sec));
ck("every result on Kai's paper survived",
   (await count(`SELECT count(*)::int c FROM public.results WHERE exam_id='${KAI_QUIZ}'`)) === 3);
ck("and Kai's sitting", (await count(`SELECT count(*)::int c FROM public.live_sessions WHERE student_id='${BOTH}'`)) === 1);
ck("ONLYB's result on Bea's paper went with the account",
   (await count(`SELECT count(*)::int c FROM public.results WHERE exam_id='${BEA_QUIZ}'`)) === 0);

console.log('\n=== WHO MAY CALL IT ===');
ck('a student (anon) cannot',
   /permission denied/i.test(await fails(() => as('anon', null,
     `SELECT * FROM public.remove_students_from_my_sections(ARRAY['${ONLYK}']::uuid[])`)) || ''));
ck('a signed-in account that is not an instructor cannot',
   /instructor/i.test(await fails(() => as('authenticated', 'd0000000-0000-0000-0000-000000000000',
     `SELECT * FROM public.remove_students_from_my_sections(ARRAY['${ONLYK}']::uuid[])`)) || ''));
r = await as('authenticated', KAI, `SELECT outcome FROM public.remove_students_from_my_sections(ARRAY['${ONLYK}']::uuid[])`);
ck("Kai removing his own ESCI-only student, who has only his work: deleted", r[0]?.outcome === 'deleted', r[0]?.outcome);
r = await as('authenticated', KAI, `SELECT outcome FROM public.remove_students_from_my_sections('{}'::uuid[])`);
ck('an empty list does nothing', r.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
