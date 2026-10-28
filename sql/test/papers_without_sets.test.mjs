// sql/107: a paper may have no sets. Runs on the grants production has
// (001's column grants to anon, 002b, 012, 015, 017):
//
//   * before 107 the student column list cannot be read — the deploy order
//     is SQL first, or the exam list fails;
//   * after it, a student (anon) reads every column the screens select,
//     uses_sets included, and cannot change it; the owner can switch it;
//   * every existing paper keeps its sets;
//   * 107 runs twice, and its VERIFY row is all true.
//
//   npm run test:no-sets
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSESSMENT_COLUMNS } from '../../src/lib/assessmentsCore.js';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const as = async (role, uid, sql) => {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid || '']);
  await x(`SET ROLE ${role}`);
  try { return { ok: true, rows: await q(sql) }; }
  catch (e) { return { ok: false, message: e.message }; }
  finally { await x('RESET ROLE'); }
};

await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`);
const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);
await x(setup.match(/ALTER TABLE public\.\w+\s+ENABLE ROW LEVEL SECURITY;/g).join('\n'));
await x(setup.match(/^(DROP POLICY IF EXISTS|CREATE POLICY)[\s\S]*?;/gm).filter(s => !/storage\./.test(s)).join('\n'));
await x(setup.match(/^(GRANT|REVOKE)[\s\S]*?;/gm).filter(g => /public\./.test(g) && !/storage|FUNCTION/.test(g)).join('\n'));
for (const f of ['001_assessments_and_lessons', '002_review_mode_and_server_scoring', '003_lock_answer_key',
  '012_five_option_items', '002b_grant_new_columns', '015_archive_assessments', '016_unlimited_choices',
  '017_shuffle_questions_switch']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

const INS = 'a0000000-0000-0000-0000-0000000000a1';
const OTHER = 'b0000000-0000-0000-0000-0000000000b1';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph'), ('${OTHER}','o@p.ph');
  INSERT INTO public.assessments (kind, title, target_section, instructor_id, is_open, duration_minutes)
  VALUES ('exam','Look-alike Quiz','AERO 101','${INS}',true,60), ('exam','Older Paper','AERO 101','${INS}',false,30);`);
const studentRead = `SELECT ${ASSESSMENT_COLUMNS} FROM public.assessments`;

console.log('\n=== before 107 ===');
{
  const r = await as('anon', null, studentRead);
  ck('the student column list cannot be read yet — SQL goes first', !r.ok && /uses_sets|permission|does not exist/i.test(r.message), r.message);
}

console.log('\n=== 107 applies ===');
const M = fs.readFileSync(P + '/sql/107_papers_without_sets.sql', 'utf8');
await x(M);
await x(M);
ck('107 applies, twice', true);
{
  const [v] = await q(M.slice(M.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim());
  ck("107's VERIFY row is all true", Object.values(v).every(b => b === true), JSON.stringify(v));
}
ck('every existing paper keeps its sets',
   (await q(`SELECT bool_and(uses_sets) ok FROM public.assessments`))[0].ok === true);

console.log('\n=== who reads and who switches ===');
{
  const r = await as('anon', null, studentRead);
  ck('a student reads every column the screens select', r.ok && r.rows.length > 0 && 'uses_sets' in r.rows[0], r.message);
  const w = await as('anon', null, `UPDATE public.assessments SET uses_sets = false`);
  ck('a student cannot switch sets off', !w.ok && /permission/i.test(w.message), w.message);
  const o = await as('authenticated', INS, `UPDATE public.assessments SET uses_sets = false WHERE title = 'Look-alike Quiz' RETURNING uses_sets`);
  ck('the owner can switch sets off', o.ok && o.rows.length === 1 && o.rows[0].uses_sets === false, o.message);
  const b = await as('authenticated', OTHER, `UPDATE public.assessments SET uses_sets = true WHERE title = 'Look-alike Quiz' RETURNING id`);
  ck("another instructor cannot switch someone else's paper", !b.ok || b.rows.length === 0, JSON.stringify(b));
  const s = await as('anon', null, `SELECT title, uses_sets FROM public.assessments WHERE title = 'Look-alike Quiz'`);
  ck('…and the student sees it off', s.ok && s.rows[0]?.uses_sets === false, JSON.stringify(s));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
