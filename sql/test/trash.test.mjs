// Runs sql/104 against real PostgreSQL (PGlite), on top of the rules it
// builds on (supabase_setup.sql + 001 + 002 + 009 + 015 + 094 + 095).
// Deleting a student or a paper puts it in the Trash; nothing is gone until
// it has waited 30 days, and restoring puts it back as it was.
//   npm run test:trash
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
for (const f of ['001_assessments_and_lessons', '002_review_mode_and_server_scoring',
                 '009_section_ownership', '015_archive_assessments'])
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
// Supabase grants the API roles every table by default; production has it.
await x(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;`);
for (const f of ['094_removing_a_student_keeps_other_instructors_students',
                 '095_writes_belong_to_the_papers_instructors'])
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));

// Look-alike people and papers, not the real ones.
const KAI = 'a0000000-0000-0000-0000-0000000000a1';   // teaches ESCI 316 -1
const BEA = 'b0000000-0000-0000-0000-0000000000b1';   // teaches AENG 223L
const KAI_QUIZ = 'a1000000-0000-0000-0000-000000000001';
const KAI_DRAFT = 'a1000000-0000-0000-0000-000000000002';
const BEA_QUIZ = 'b1000000-0000-0000-0000-000000000001';
const BOTH  = '11111111-0000-0000-0000-000000000001'; // ESCI + AENG, sat Kai's quiz
const ONLYB = '11111111-0000-0000-0000-000000000002'; // AENG only, sat Bea's quiz
const LEFTK = '11111111-0000-0000-0000-000000000003'; // AENG only now, but sat Kai's quiz
const ONLYK = '11111111-0000-0000-0000-000000000004'; // ESCI only

await x(`INSERT INTO auth.users VALUES ('${KAI}','kai@p.ph'),('${BEA}','bea@p.ph');
  INSERT INTO public.instructors (id,email,full_name) VALUES ('${KAI}','kai@p.ph','Kai'),('${BEA}','bea@p.ph','Bea');
  INSERT INTO public.section_instructors (section_name,instructor_id,added_by) VALUES
    ('ESCI 316 -1','${KAI}','${KAI}'), ('AENG 223L','${BEA}','${BEA}');
  INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,duration_minutes) VALUES
    ('${KAI_QUIZ}','exam','Look-alike Quiz','ESCI 316 -1','${KAI}',true,60),
    ('${KAI_DRAFT}','exam','Look-alike Draft','ESCI 316 -1','${KAI}',false,60),
    ('${BEA_QUIZ}','exam','Look-alike Lab Quiz','AENG 223L','${BEA}',false,60);
  INSERT INTO public.exams (id,title,target_section,instructor_id,is_open,duration_minutes)
    SELECT id,title,target_section,instructor_id,is_open,duration_minutes FROM public.assessments
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id,full_name,section,student_email,student_code) VALUES
    ('${BOTH}','Both Courses','ESCI 316 -1, AENG 223L','both@s.ph','S-1'),
    ('${ONLYB}','Lab Only','AENG 223L','lab@s.ph','S-2'),
    ('${LEFTK}','Left Kai','AENG 223L','left@s.ph','S-3'),
    ('${ONLYK}','Esci Only','ESCI 316 -1','esci@s.ph','S-4');
  INSERT INTO public.results (student_id,exam_id,assessment_id,score,total_items) VALUES
    ('${BOTH}','${KAI_QUIZ}','${KAI_QUIZ}',20,30),
    ('${ONLYB}','${BEA_QUIZ}','${BEA_QUIZ}',9,10),
    ('${LEFTK}','${KAI_QUIZ}','${KAI_QUIZ}',15,30),
    ('${ONLYK}','${KAI_QUIZ}','${KAI_QUIZ}',17,30);`);

const as = async (role, uid, sql, params) => {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid || '']);
  await x(`SET ROLE ${role}`);
  try { return await q(sql, params); }
  finally { await x(`RESET ROLE`); }
};
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const one = async (sql) => (await q(sql))[0];
const sectionOf = async (id) => (await q(`SELECT section FROM public.users WHERE id=$1`, [id]))[0]?.section;
const exists = async (table, id) => (await q(`SELECT 1 FROM public.${table} WHERE id=$1`, [id])).length === 1;
const backdate = (where) => x(`UPDATE public.trash SET purge_after = now() - interval '1 minute' WHERE ${where}`);

const mig = fs.readFileSync(P + '/sql/104_deletes_wait_thirty_days_in_trash.sql', 'utf8');
await x(mig);
console.log('\n104 applied');
try { await x(mig); ck('re-runs without error', true); }
catch (e) { ck('re-runs without error', false, e.message); }

console.log('\n=== VERIFY ===');
{
  const v = (await q(mig.slice(mig.lastIndexOf('SELECT\n'))))[0];
  ck('every VERIFY column is true', Object.values(v).every(b => b === true), JSON.stringify(v));
}

console.log('\n=== NOTHING IS DELETED ON THE SPOT ===');
ck('an instructor can no longer DELETE a paper',
   /permission denied/i.test(await fails(() => as('authenticated', KAI, `DELETE FROM public.assessments WHERE id='${KAI_DRAFT}'`)) || ''));
ck("nor call 094's instant remove",
   /permission denied/i.test(await fails(() => as('authenticated', BEA,
     `SELECT * FROM public.remove_students_from_my_sections(ARRAY['${ONLYB}']::uuid[])`)) || ''));
ck('a student (anon) cannot trash anyone',
   /permission denied/i.test(await fails(() => as('anon', null,
     `SELECT * FROM public.trash_students(ARRAY['${ONLYB}']::uuid[])`)) || ''));
ck('nor read the Trash',
   /permission denied/i.test(await fails(() => as('anon', null, `SELECT * FROM public.trash`)) || ''));
ck('an instructor cannot write the Trash directly',
   /permission denied/i.test(await fails(() => as('authenticated', BEA,
     `INSERT INTO public.trash (kind,item_id,trashed_by) VALUES ('student','${ONLYK}','${BEA}')`)) || ''));

console.log('\n=== STUDENTS: Bea removes her whole class list ===');
const out = await as('authenticated', BEA,
  `SELECT student, outcome FROM public.trash_students($1::uuid[]) ORDER BY student`, [[BOTH, ONLYB, LEFTK, ONLYK]]);
const got = Object.fromEntries(out.map(o => [o.student, o.outcome]));
ck('her three students go to the Trash', got[BOTH] === 'trashed' && got[ONLYB] === 'trashed' && got[LEFTK] === 'trashed', JSON.stringify(got));
ck("Kai's student she does not teach is untouched", got[ONLYK] === 'not_yours');
ck('BOTH keeps ESCI 316 -1', (await sectionOf(BOTH)) === 'ESCI 316 -1');
ck('ONLYB is in no section, but the account is still there', (await sectionOf(ONLYB)) === null && await exists('users', ONLYB));
ck("ONLYB's result is still there",
   (await one(`SELECT count(*)::int c FROM public.results WHERE student_id='${ONLYB}'`)).c === 1);
let rows = await as('authenticated', BEA, `SELECT item_id, detail FROM public.trash WHERE kind='student' ORDER BY item_id`);
ck('Bea sees three entries, each holding the section taken',
   rows.length === 3 && rows.every(r => JSON.stringify(r.detail.sections) === '["AENG 223L"]'), JSON.stringify(rows));
ck("Kai does not see Bea's students in his Trash",
   (await as('authenticated', KAI, `SELECT 1 FROM public.trash WHERE kind='student'`)).length === 0);
ck('the 30 days are set',
   (await one(`SELECT bool_and(purge_after BETWEEN now() + interval '29 days 23 hours' AND now() + interval '30 days 1 hour') ok FROM public.trash`)).ok === true);

console.log('\n=== STUDENTS: restore ===');
const onlyBEntry = (await q(`SELECT id FROM public.trash WHERE item_id='${ONLYB}'`))[0].id;
ck("Kai cannot restore Bea's entry",
   (await as('authenticated', KAI, `SELECT outcome FROM public.restore_from_trash($1::uuid[])`, [[onlyBEntry]]))[0]?.outcome === 'not_yours');
let r = await as('authenticated', BEA, `SELECT outcome FROM public.restore_from_trash($1::uuid[])`, [[onlyBEntry]]);
ck('Bea restores ONLYB', r[0]?.outcome === 'restored', r[0]?.outcome);
ck('ONLYB is back in AENG 223L', (await sectionOf(ONLYB)) === 'AENG 223L');
ck('and out of the Trash', (await q(`SELECT 1 FROM public.trash WHERE item_id='${ONLYB}'`)).length === 0);
const bothEntry = (await q(`SELECT id FROM public.trash WHERE item_id='${BOTH}'`))[0].id;
await as('authenticated', BEA, `SELECT * FROM public.restore_from_trash($1::uuid[])`, [[bothEntry]]);
ck("restoring BOTH adds AENG 223L back beside Kai's section",
   (await sectionOf(BOTH)) === 'ESCI 316 -1, AENG 223L', await sectionOf(BOTH));

console.log('\n=== STUDENTS: removed twice is one entry ===');
await x(`UPDATE public.users SET section='AENG 223L' WHERE id='${ONLYB}'`);
await as('authenticated', BEA, `SELECT * FROM public.trash_students($1::uuid[])`, [[ONLYB]]);
await x(`UPDATE public.users SET section='AENG 223L-B' WHERE id='${ONLYB}';
         INSERT INTO public.section_instructors (section_name,instructor_id,added_by) VALUES ('AENG 223L-B','${BEA}','${BEA}');`);
await as('authenticated', BEA, `SELECT * FROM public.trash_students($1::uuid[])`, [[ONLYB]]);
rows = await q(`SELECT detail FROM public.trash WHERE item_id='${ONLYB}'`);
ck('one entry, holding both sections',
   rows.length === 1 && JSON.stringify([...rows[0].detail.sections].sort()) === '["AENG 223L","AENG 223L-B"]', JSON.stringify(rows));

console.log('\n=== PAPERS ===');
r = await as('authenticated', BEA, `SELECT outcome FROM public.trash_papers($1::uuid[])`, [[KAI_QUIZ]]);
ck("Bea cannot trash Kai's paper", r[0]?.outcome === 'not_yours', r[0]?.outcome);
r = await as('authenticated', KAI, `SELECT outcome FROM public.trash_papers($1::uuid[])`, [[KAI_QUIZ]]);
ck('Kai trashes his sat, open quiz in one step', r[0]?.outcome === 'trashed', r[0]?.outcome);
let paper = await one(`SELECT is_open, archived_at FROM public.assessments WHERE id='${KAI_QUIZ}'`);
ck('it is closed and archived, so students no longer see it', paper.is_open === false && paper.archived_at !== null);
ck('the legacy row is closed too', (await one(`SELECT is_open FROM public.exams WHERE id='${KAI_QUIZ}'`)).is_open === false);
ck('every result is still there',
   (await one(`SELECT count(*)::int c FROM public.results WHERE exam_id='${KAI_QUIZ}'`)).c === 3);
r = await as('authenticated', KAI, `SELECT outcome FROM public.trash_papers($1::uuid[])`, [[KAI_QUIZ]]);
ck('trashing it again changes nothing', r[0]?.outcome === 'already');
const quizEntry = (await q(`SELECT id FROM public.trash WHERE item_id='${KAI_QUIZ}'`))[0].id;
r = await as('authenticated', KAI, `SELECT outcome FROM public.restore_from_trash($1::uuid[])`, [[quizEntry]]);
paper = await one(`SELECT is_open, archived_at FROM public.assessments WHERE id='${KAI_QUIZ}'`);
ck('restored as it was before: not archived, but left closed',
   r[0]?.outcome === 'restored' && paper.archived_at === null && paper.is_open === false, JSON.stringify(paper));
await x(`UPDATE public.assessments SET archived_at = '2026-10-01' WHERE id='${KAI_DRAFT}'`);
await as('authenticated', KAI, `SELECT * FROM public.trash_papers($1::uuid[])`, [[KAI_DRAFT]]);
const draftEntry = (await q(`SELECT id FROM public.trash WHERE item_id='${KAI_DRAFT}'`))[0].id;
await as('authenticated', KAI, `SELECT * FROM public.restore_from_trash($1::uuid[])`, [[draftEntry]]);
ck('a paper archived before it was trashed comes back archived',
   new Date((await one(`SELECT archived_at FROM public.assessments WHERE id='${KAI_DRAFT}'`)).archived_at).toISOString().startsWith('2026-10-01'));

console.log('\n=== PURGE: only after 30 days ===');
await as('authenticated', KAI, `SELECT * FROM public.trash_papers($1::uuid[])`, [[KAI_QUIZ]]);
r = await as('authenticated', KAI, `SELECT public.purge_expired_trash() n`);
ck('nothing under 30 days is purged', r[0].n === 0 && await exists('assessments', KAI_QUIZ));
ck('a student cannot run the purge',
   /permission denied/i.test(await fails(() => as('anon', null, `SELECT public.purge_expired_trash()`)) || ''));

await backdate(`item_id IN ('${ONLYB}','${LEFTK}')`);
r = await as('authenticated', KAI, `SELECT public.purge_expired_trash() n`);
ck('the two expired entries are purged, whoever opens the dashboard', r[0].n === 2, String(r[0].n));
ck("ONLYB, in no section with only Bea's work, is deleted", !(await exists('users', ONLYB)));
ck("LEFTK's account stays: it holds a result on Kai's quiz", await exists('users', LEFTK));
ck('the paper, not yet expired, is untouched', await exists('assessments', KAI_QUIZ));

await backdate(`item_id = '${KAI_QUIZ}'`);
r = await as('authenticated', BEA, `SELECT public.purge_expired_trash() n`);
ck('once its 30 days are up the paper is deleted with its results',
   r[0].n === 1 && !(await exists('assessments', KAI_QUIZ)) && !(await exists('exams', KAI_QUIZ))
   && (await one(`SELECT count(*)::int c FROM public.results WHERE exam_id='${KAI_QUIZ}'`)).c === 0);
ck('the Trash is empty of what was purged',
   (await q(`SELECT 1 FROM public.trash WHERE item_id IN ('${KAI_QUIZ}','${ONLYB}','${LEFTK}')`)).length === 0);

console.log('\n=== PURGE: a student re-enrolled meanwhile is kept ===');
await as('authenticated', BEA, `SELECT * FROM public.trash_students($1::uuid[])`, [[BOTH]]);
await x(`UPDATE public.users SET section='AENG 223L' WHERE id='${ONLYK}'`);
await as('authenticated', BEA, `SELECT * FROM public.trash_students($1::uuid[])`, [[ONLYK]]);
await x(`UPDATE public.users SET section='AENG 223L' WHERE id='${ONLYK}'`);   // re-imported
await backdate(`item_id IN ('${BOTH}','${ONLYK}')`);
await as('authenticated', BEA, `SELECT public.purge_expired_trash()`);
ck("BOTH, still in Kai's section, is kept", await exists('users', BOTH) && (await sectionOf(BOTH)) === 'ESCI 316 -1');
ck('ONLYK, back in a section, is kept', await exists('users', ONLYK));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
