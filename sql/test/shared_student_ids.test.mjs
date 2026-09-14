// Runs 014 against real PostgreSQL (PGlite) on a replica of the production
// schema. The point of the migration is that two students may share a Student
// ID; the point of this test is that allowing it does not break the only thing
// the ID is load-bearing for — logging in.
//   npm run test:shared-ids
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
const fails = async (sql, p) => { try { await q(sql, p); return null; } catch (e) { return e.message || String(e); } };

await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);`);
const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));

const ID = '2021-1-1234';
await q(`INSERT INTO public.users (full_name, student_email, student_code, section)
         VALUES ('Ana','ana@patts.edu.ph',$1,'Esci 316 -2')`, [ID]);

console.log('=== BEFORE 014 ===');
{
  const e = await fails(
    `INSERT INTO public.users (full_name, student_email, student_code, section)
     VALUES ('Ben','ben@patts.edu.ph',$1,'Esci 316 -2')`, [ID]);
  ck('a second student with the same Student ID is refused', !!e, (e || '').slice(0, 70));
  const n = await q(`SELECT count(*)::int c FROM public.users`);
  ck('so only one of the two real students exists', n[0].c === 1, `${n[0].c}`);
}

await x(fs.readFileSync(P + '/sql/014_shared_student_ids.sql', 'utf8'));
console.log('\n014 applied\n');

console.log('=== AFTER 014 ===');
{
  await q(`INSERT INTO public.users (full_name, student_email, student_code, section)
           VALUES ('Ben','ben@patts.edu.ph',$1,'Esci 316 -2')`, [ID]);
  const both = await q(`SELECT full_name FROM public.users WHERE student_code=$1 ORDER BY full_name`, [ID]);
  ck('both students now exist under the one Student ID',
     both.length === 2 && both[0].full_name === 'Ana' && both[1].full_name === 'Ben',
     JSON.stringify(both));

  const e = await fails(
    `INSERT INTO public.users (full_name, student_email, student_code, section)
     VALUES ('Impostor','ana@patts.edu.ph','9999','X')`);
  ck('but a duplicate EMAIL is still refused — that is the identity', !!e, (e || '').slice(0, 70));

  const idx = await q(
    `SELECT count(*)::int c FROM pg_index i
     JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace s ON s.oid=t.relnamespace
     WHERE s.nspname='public' AND t.relname='users' AND i.indisunique AND NOT i.indisprimary
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM unnest(i.indkey::int[]) k
            JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k) = ARRAY['student_code']`);
  ck('no unique index or constraint is left on student_code', idx[0].c === 0, `${idx[0].c}`);

  const still = await q(
    `SELECT count(*)::int c FROM pg_index i
     JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace s ON s.oid=t.relnamespace
     WHERE s.nspname='public' AND t.relname='users' AND i.indisunique AND NOT i.indisprimary
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM unnest(i.indkey::int[]) k
            JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k) = ARRAY['student_email']`);
  ck('student_email is still unique', still[0].c === 1, `${still[0].c}`);

  const lookup = await q(
    `SELECT count(*)::int c FROM pg_indexes
     WHERE schemaname='public' AND tablename='users' AND indexname='users_student_code_idx'`);
  ck('student_code keeps a plain index so login stays fast', lookup[0].c === 1);
}

console.log('\n=== LOGIN STILL RESOLVES ONE PERSON ===');
{
  // Login.jsx matches the PAIR: student_email AND student_code.
  for (const [email, name] of [['ana@patts.edu.ph', 'Ana'], ['ben@patts.edu.ph', 'Ben']]) {
    const r = await q(
      `SELECT id, full_name FROM public.users WHERE student_email=$1 AND student_code=$2`,
      [email, ID]);
    ck(`${name} signs in to exactly one row`, r.length === 1 && r[0].full_name === name,
       JSON.stringify(r));
  }
  const wrongPair = await q(
    `SELECT id FROM public.users WHERE student_email=$1 AND student_code=$2`,
    ['ana@patts.edu.ph', 'not-her-id']);
  ck('the right email with the wrong ID still signs in to nobody', wrongPair.length === 0);
  // And the ID alone is now genuinely ambiguous — which is why nothing may use it alone.
  const byIdAlone = await q(`SELECT id FROM public.users WHERE student_code=$1`, [ID]);
  ck('(by design) the Student ID alone now matches two people', byIdAlone.length === 2);
}

console.log('\n=== IDEMPOTENCY ===');
{
  await x(fs.readFileSync(P + '/sql/014_shared_student_ids.sql', 'utf8'));
  await x(fs.readFileSync(P + '/sql/014_shared_student_ids.sql', 'utf8'));
  const n = await q(`SELECT count(*)::int c FROM public.users WHERE student_code=$1`, [ID]);
  ck('re-running twice more changes nothing', n[0].c === 2, `${n[0].c}`);
  const e = await fails(
    `INSERT INTO public.users (full_name, student_email, student_code, section)
     VALUES ('Third','third@patts.edu.ph',$1,'X')`, [ID]);
  ck('and a third sharer would still be allowed', e === null, (e || '').slice(0, 60));
}

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
