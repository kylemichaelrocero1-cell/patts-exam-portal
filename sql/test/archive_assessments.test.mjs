// Runs 001 + 002 + 015 against real PostgreSQL (PGlite). Archiving has to put a
// paper away WITHOUT losing anything: its questions, its results and its class
// review all have to survive, and it has to become unavailable to students.
//   npm run test:archive
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
const STU = '11111111-1111-1111-1111-111111111111';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.users (id, full_name, section) VALUES ('${STU}','S One','AENG 426');`);
await x(fs.readFileSync(P + '/sql/001_assessments_and_lessons.sql', 'utf8'));
await x(fs.readFileSync(P + '/sql/002_review_mode_and_server_scoring.sql', 'utf8'));

const OLD = '67d25e6e-a4d7-45eb-96d2-01bb22241274';
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id,
           is_open, duration_minutes)
         VALUES ('${OLD}','exam','Finals 2025','AENG 426','${INS}',true,60);
  INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choice_a, choice_b, choice_c, choice_d, correct_answer)
  VALUES ('${OLD}','${OLD}',1,'An item','multiple_choice','w','x','y','z',2);
  INSERT INTO public.results (student_id, exam_id, assessment_id, score, total_items)
  VALUES ('${STU}','${OLD}','${OLD}',1,1);`);

console.log('=== BEFORE 015 ===');
{
  let missing = false;
  try { await q(`SELECT archived_at FROM public.assessments LIMIT 1`); }
  catch { missing = true; }
  ck('archived_at does not exist yet', missing);
}

await x(fs.readFileSync(P + '/sql/015_archive_assessments.sql', 'utf8'));
console.log('\n015 applied\n');

console.log('=== THE COLUMN ===');
{
  const c = await q(`SELECT is_nullable, data_type FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='assessments' AND column_name='archived_at'`);
  ck('archived_at exists, nullable, a timestamp',
     c.length === 1 && c[0].is_nullable === 'YES' && /timestamp/.test(c[0].data_type), JSON.stringify(c));
  const n = await q(`SELECT count(*)::int c FROM public.assessments WHERE archived_at IS NOT NULL`);
  ck('nothing is archived just because the column appeared', n[0].c === 0, `${n[0].c}`);
  const g = await q(`SELECT string_agg(column_name, ',' ORDER BY column_name) cols
                     FROM information_schema.column_privileges
                     WHERE grantee='anon' AND table_name='assessments' AND privilege_type='SELECT'`);
  const cols = (g[0].cols || '').split(',');
  ck('anon may read archived_at', cols.includes('archived_at'), g[0].cols);
  ck('and still may not read exam_password', !cols.includes('exam_password'));
}

console.log('\n=== THE AVAILABILITY RULE ===');
{
  const r = await q(`SELECT
    assessment_is_available(true,  NULL, NULL, NULL)  AS open_active,
    assessment_is_available(true,  NULL, NULL, now()) AS open_archived,
    assessment_is_available(false, NULL, NULL, NULL)  AS closed_active,
    assessment_is_available(false, NULL, NULL, now()) AS closed_archived,
    assessment_is_available(true,  NULL, NULL)        AS three_arg`);
  const v = r[0];
  ck('an open, unarchived paper is available', v.open_active === true);
  ck('archiving makes an open paper unavailable', v.open_archived === false);
  ck('a closed paper is unavailable either way',
     v.closed_active === false && v.closed_archived === false);
  ck('the original three-argument form still works', v.three_arg === true);
}

console.log('\n=== ARCHIVING LOSES NOTHING ===');
{
  // What the client does: stamp archived_at and close it in one write.
  await q(`UPDATE public.assessments SET archived_at = now(), is_open = false WHERE id = $1`, [OLD]);
  const a = await q(`SELECT archived_at, is_open FROM public.assessments WHERE id=$1`, [OLD]);
  ck('the paper is archived and closed', a[0].archived_at !== null && a[0].is_open === false);

  const qs = await q(`SELECT count(*)::int c FROM public.questions WHERE assessment_id=$1`, [OLD]);
  ck('its questions are still there', qs[0].c === 1, `${qs[0].c}`);
  const rs = await q(`SELECT count(*)::int c, max(score)::int s FROM public.results WHERE assessment_id=$1`, [OLD]);
  ck('its results are still there, with the score intact', rs[0].c === 1 && rs[0].s === 1, JSON.stringify(rs));
  const mark = await q(`SELECT * FROM public.score_answers($1,'{}'::jsonb)`, [OLD]);
  ck('and it can still be marked — nothing about it is disabled',
     mark[0].total_items === 1, JSON.stringify(mark[0]));

  // This is the query the student list runs.
  const visible = await q(`SELECT count(*)::int c FROM public.assessments
                           WHERE is_open = true AND archived_at IS NULL`);
  ck('it is gone from the students\' open-paper query', visible[0].c === 0, `${visible[0].c}`);
  // ...and gone from the instructor's default list.
  const active = await q(`SELECT count(*)::int c FROM public.assessments
                          WHERE instructor_id=$1 AND archived_at IS NULL`, [INS]);
  ck('and from the instructor\'s active list', active[0].c === 0, `${active[0].c}`);
  const all = await q(`SELECT count(*)::int c FROM public.assessments WHERE instructor_id=$1`, [INS]);
  ck('but still reachable when they ask to see archived', all[0].c === 1, `${all[0].c}`);
}

console.log('\n=== RESTORING ===');
{
  await q(`UPDATE public.assessments SET archived_at = NULL WHERE id=$1`, [OLD]);
  const a = await q(`SELECT archived_at, is_open FROM public.assessments WHERE id=$1`, [OLD]);
  ck('restoring clears archived_at', a[0].archived_at === null);
  // Deliberate: coming back from the archive must not put a live exam in front
  // of a class by surprise. The instructor re-opens it themselves.
  ck('and deliberately leaves it CLOSED', a[0].is_open === false);
}

console.log('\n=== IDEMPOTENCY ===');
{
  await q(`UPDATE public.assessments SET archived_at = now() WHERE id=$1`, [OLD]);
  const before = await q(`SELECT archived_at FROM public.assessments WHERE id=$1`, [OLD]);
  await x(fs.readFileSync(P + '/sql/015_archive_assessments.sql', 'utf8'));
  await x(fs.readFileSync(P + '/sql/015_archive_assessments.sql', 'utf8'));
  const after = await q(`SELECT archived_at FROM public.assessments WHERE id=$1`, [OLD]);
  ck('re-running twice more leaves an archived paper archived',
     after[0].archived_at !== null &&
     new Date(after[0].archived_at).getTime() === new Date(before[0].archived_at).getTime());
  const idx = await q(`SELECT count(*)::int c FROM pg_indexes
                       WHERE schemaname='public' AND indexname='assessments_active_idx'`);
  ck('and there is exactly one active-papers index', idx[0].c === 1, `${idx[0].c}`);
}

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
