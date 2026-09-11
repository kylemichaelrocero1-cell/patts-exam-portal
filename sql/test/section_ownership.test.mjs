// Runs sql/009_section_ownership.sql against real PostgreSQL (PGlite) and
// asserts the thing the migration exists for: a self-claim records that an
// instructor teaches a section WITHOUT handing them write access to a
// colleague's exam in that same section, while a genuine co-instructor grant
// still does.
//   npm run test:sections
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
// RLS + policies + grants, exactly as production has them.
await x(setup.slice(setup.indexOf('ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY'),
                    setup.indexOf('-- 6. REALTIME')));

const ANA = 'd24df77e-309a-4ed8-988f-da3ee1c76408';   // owns the AENG 426 exam
const BEN = 'c1000000-0000-0000-0000-0000000000b1';   // also teaches AENG 426
const CAS = 'c1000000-0000-0000-0000-0000000000c1';   // teaches nothing
const EX_ANA = '67d25e6e-a4d7-45eb-96d2-01bb22241274';   // targets two sections
const EX_SOLO = 'aaaaaaaa-0000-0000-0000-000000000001'; // targets one

await x(`INSERT INTO auth.users VALUES ('${ANA}','ana@p.ph'),('${BEN}','ben@p.ph'),('${CAS}','cas@p.ph');
  INSERT INTO public.instructors (id,email,full_name) VALUES
    ('${ANA}','ana@p.ph','Ana'),('${BEN}','ben@p.ph','Ben'),('${CAS}','cas@p.ph','Cas');
  INSERT INTO public.exams (id,title,target_section,instructor_id,is_open,duration_minutes) VALUES
    ('${EX_ANA}','Aero Finals','AENG 426, AENG 223L','${ANA}',false,60),
    ('${EX_SOLO}','Aero Quiz','AENG 426','${ANA}',false,30);
  -- Ben's roster lives in a section no exam points at: the case that used to vanish.
  INSERT INTO public.users (id,full_name,section) VALUES
    ('11111111-1111-1111-1111-111111111111','Roster Only','AENG 999');`);

const asInstructor = async (uid, sql, params) => {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid]);
  await x(`SET ROLE authenticated`);
  try { return await q(sql, params); }
  finally { await x(`RESET ROLE`); }
};

// ── before the migration ───────────────────────────────────────────────
console.log('\n=== BASELINE (self-claim under the original policy) ===');
await x(`INSERT INTO public.section_instructors (section_name,instructor_id,added_by)
         VALUES ('AENG 426','${BEN}','${BEN}');`);
// Whole-string equality in the shipped policy, so the single-section exam is
// the one that shows the widening. (After fix_rls_section_match_and_stray_comma.sql
// splits the list, the two-section exam would be reachable as well.)
let r = await asInstructor(BEN,
  `UPDATE public.exams SET title='Hijacked' WHERE id='${EX_SOLO}' RETURNING id`);
ck("a self-claim used to reach Ana's exam — the widening this file closes", r.length === 1,
   `rows=${r.length}`);
await x(`UPDATE public.exams SET title='Aero Quiz' WHERE id='${EX_SOLO}'`);

// ── the migration ──────────────────────────────────────────────────────
const mig = fs.readFileSync(P + '/sql/009_section_ownership.sql', 'utf8');
await x(mig);

console.log('\n=== IDEMPOTENCY ===');
try { await x(mig); ck('re-runs without error', true); }
catch (e) { ck('re-runs without error', false, e.message); }

console.log('\n=== WRITE ACCESS ===');
r = await asInstructor(BEN, `UPDATE public.exams SET title='Hijacked' WHERE id='${EX_SOLO}' RETURNING id`);
ck("a self-claim no longer reaches Ana's exam", r.length === 0, `rows=${r.length}`);

r = await asInstructor(ANA, `UPDATE public.exams SET title='Aero Finals v2' WHERE id='${EX_ANA}' RETURNING id`);
ck('the owner can still update their own exam', r.length === 1, `rows=${r.length}`);

// Ana grants Ben genuine co-instructor access to one of the two sections.
await x(`INSERT INTO public.section_instructors (section_name,instructor_id,added_by)
         VALUES ('AENG 223L','${BEN}','${ANA}');`);
r = await asInstructor(BEN, `UPDATE public.exams SET is_open=true WHERE id='${EX_ANA}' RETURNING id`);
ck('a colleague-granted co-instructor still can', r.length === 1, `rows=${r.length}`);

// The comma-list match from fix_rls_section_match_and_stray_comma.sql: the
// grant is on "AENG 223L" and the exam targets "AENG 426, AENG 223L".
ck('the grant matched an entry of the list, not the whole string', r.length === 1);

r = await asInstructor(CAS, `UPDATE public.exams SET title='Nope' WHERE id='${EX_ANA}' RETURNING id`);
ck('an unrelated instructor still cannot', r.length === 0, `rows=${r.length}`);

// "AENG 223L" must not be matched by "AENG 223L-3".
await x(`INSERT INTO public.exams (id,title,target_section,instructor_id,is_open,duration_minutes)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000002','Other','AENG 223L-3','${ANA}',false,60);`);
r = await asInstructor(BEN, `UPDATE public.exams SET title='Nope' WHERE id='aaaaaaaa-0000-0000-0000-000000000002' RETURNING id`);
ck('a section name is not a prefix match', r.length === 0, `rows=${r.length}`);

console.log('\n=== BACKFILL ===');
const claimed = await q(`SELECT section_name FROM public.section_instructors
  WHERE instructor_id='${ANA}' AND added_by='${ANA}' ORDER BY section_name`);
ck("every section Ana's exams targeted at migration time is on record",
   claimed.map(c => c.section_name).join('|') === 'AENG 223L|AENG 426',
   claimed.map(c => c.section_name).join('|'));

const dupes = await q(`SELECT count(*)::int c FROM (
  SELECT section_name,instructor_id,added_by FROM public.section_instructors
  GROUP BY 1,2,3 HAVING count(*) > 1) d`);
ck('the backfill created no duplicates', dupes[0].c === 0);

console.log('\n=== THE ORIGINAL BUG ===');
// A roster is kept alive by the claim alone, with no exam pointing at it.
await x(`INSERT INTO public.section_instructors (section_name,instructor_id,added_by)
         VALUES ('AENG 999','${BEN}','${BEN}');`);
const sectionsOf = async (uid) => (await q(
  `SELECT DISTINCT s.name FROM (
     SELECT btrim(t.x) AS name FROM public.exams e,
       unnest(string_to_array(coalesce(e.target_section,''),',')) AS t(x)
     WHERE e.instructor_id=$1 AND btrim(t.x) <> ''
     UNION
     SELECT si.section_name FROM public.section_instructors si
     WHERE si.instructor_id=$1
   ) s ORDER BY 1`, [uid])).map(row => row.name);

let benSections = await sectionsOf(BEN);
ck('a section with no exam is still Ben\'s', benSections.includes('AENG 999'), benSections.join('|'));

// Delete every exam Ana has; her sections must survive.
await x(`DELETE FROM public.exams WHERE instructor_id='${ANA}'`);
const anaSections = await sectionsOf(ANA);
ck('deleting every exam does not take the sections with it',
   anaSections.includes('AENG 426') && anaSections.includes('AENG 223L'), anaSections.join('|'));

const orphans = await q(`SELECT u.section FROM public.users u
  WHERE coalesce(u.section,'') <> ''
    AND NOT EXISTS (SELECT 1 FROM public.section_instructors si,
      unnest(string_to_array(u.section,',')) AS t(x) WHERE si.section_name = btrim(t.x))`);
ck('no student is left in a section no instructor holds', orphans.length === 0,
   orphans.map(o => o.section).join('|'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
