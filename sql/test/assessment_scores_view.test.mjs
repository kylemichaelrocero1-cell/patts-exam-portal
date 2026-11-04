// sql/140: the assessment_scores view reads with the caller's permissions and
// is not offered to the API roles. Runs against real PostgreSQL (PGlite): the
// tables keep their own rules, the view still works for reports in the SQL
// editor, and 140 runs twice with its VERIFY row all true.
//   npm run test:scores-view
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
for (const f of ['001_assessments_and_lessons', '002_review_mode_and_server_scoring'])
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));

// Look-alike people and papers, not the real ones.
const INS = 'a0000000-0000-0000-0000-0000000000a1', QUIZ = 'a1000000-0000-0000-0000-000000000001';
const STU = '11111111-0000-0000-0000-000000000001';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,duration_minutes)
    VALUES ('${QUIZ}','exam','Look-alike Quiz','AERO 101','${INS}',false,60);
  INSERT INTO public.exams (id,title,target_section,instructor_id,is_open,duration_minutes)
    SELECT id,title,target_section,instructor_id,is_open,duration_minutes FROM public.assessments;
  INSERT INTO public.users (id,full_name,section) VALUES ('${STU}','Test Student','AERO 101');
  INSERT INTO public.results (student_id,exam_id,assessment_id,score,total_items,answers_json)
    VALUES ('${STU}','${QUIZ}','${QUIZ}',8,10,'{"q":1}');`);

const as = async (role, sql) => {
  await x(`SET ROLE ${role}`);
  try { return { ok: true, rows: await q(sql) }; }
  catch (e) { return { ok: false, message: e.message }; }
  finally { await x('RESET ROLE'); }
};
const read = 'SELECT student_id, answers_json FROM public.assessment_scores';

const M = fs.readFileSync(P + '/sql/140_assessment_scores_is_not_for_the_api.sql', 'utf8');
await x(M);
await x(M);
ck('140 applies, twice', true);
{
  const [v] = await q(M.slice(M.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim());
  ck("140's VERIFY row is all true", Object.values(v).every(b => b === true), JSON.stringify(v));
}
{
  const a = await as('anon', read);
  ck('a student (anon) cannot read the view', !a.ok && /permission denied/i.test(a.message), a.message);
  const i = await as('authenticated', read);
  ck('nor can a signed-in role', !i.ok && /permission denied/i.test(i.message), i.message);
  const own = await q(read);
  ck('a report in the SQL editor still reads it', own.length === 1 && own[0].answers_json.q === 1, JSON.stringify(own));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
