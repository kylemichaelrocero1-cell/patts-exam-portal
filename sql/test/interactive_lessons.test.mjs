// Runs sql/147 against real PostgreSQL (PGlite), on top of the lesson tables
// and bucket it changes. Interactive joins the two kinds a lesson could already
// be, without disturbing them, and the bucket's other rules stay as they were.
//   npm run test:interactive-sql
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const db = new PGlite();
const x = s => db.exec(s);
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };

await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, bucket_id text, name text);`);
const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);
await x(fs.readFileSync(`${P}/sql/001_assessments_and_lessons.sql`, 'utf8'));
await x(fs.readFileSync(`${P}/sql/006_lesson_pdf_material.sql`, 'utf8'));

const insert = (id, kind) => db.query(
  `INSERT INTO public.lessons (id, title, content_md, material_type) VALUES ($1, 'Look-alike', '', $2)`, [id, kind]);
const refused = async (id, kind) => { try { await insert(id, kind); return false; } catch (e) { return e.code === '23514'; } };
const U = n => `00000000-0000-0000-0000-00000000000${n}`;

ck('before 147, interactive is refused', await refused(U(1), 'interactive'));
await insert(U(2), 'pdf');

const sql = fs.readFileSync(`${P}/sql/147_interactive_lessons.sql`, 'utf8');
await x(sql);
await x(sql);
ck('runs twice without error', true);

await insert(U(3), 'interactive');
ck('an interactive lesson saves', true);
await insert(U(4), 'typed');
await insert(U(5), 'pdf');
ck('typed and pdf still save', true);
ck('an unknown kind is still refused', await refused(U(6), 'video'));
ck('the pdf lesson from before is untouched',
  (await db.query(`SELECT material_type FROM public.lessons WHERE id = $1`, [U(2)])).rows[0].material_type === 'pdf');

const b = (await db.query(`SELECT file_size_limit, allowed_mime_types, public FROM storage.buckets WHERE id = 'lesson-files'`)).rows[0];
ck('bucket takes html', b.allowed_mime_types.includes('text/html'));
ck('bucket still takes pdf', b.allowed_mime_types.includes('application/pdf'));
ck('bucket takes nothing else', b.allowed_mime_types.length === 2);
ck('bucket size limit unchanged', Number(b.file_size_limit) === 20971520);
ck('bucket still public', b.public === true);

const verify = sql.slice(sql.lastIndexOf('SELECT\n  (SELECT pg_get_constraintdef'));
const v = (await db.query(verify)).rows[0];
ck('the VERIFY query says both true', v.lessons_accept_interactive === true && v.bucket_accepts_html === true, JSON.stringify(v));
ck('the file ends on the VERIFY query, so the editor shows it',
  sql.trimEnd().endsWith('bucket_accepts_html;'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
