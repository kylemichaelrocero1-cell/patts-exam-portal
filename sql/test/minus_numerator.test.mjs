// sql/033: a minus may sit on the numerator. -\frac{6}{(2u+1)^4} was the
// key and \frac{-6}{(2u+1)^4} was marked wrong — the same number, spelt with
// the sign one place to the right.
//
// The rule has two edges that would hand out marks for wrong answers if they
// slipped, and both are tested: a numerator of more than one term, and a
// fraction written straight after a factor it multiplies. The dashboard's
// marker is checked against the database on every case, because saving a
// script from the dashboard overwrites the database's mark.
//
//   npm run test:minus
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputeEngine } from '@cortex-js/compute-engine';
import { useEngine } from '../../src/lib/mathCheck.js';
import { markAnswer } from '../../src/lib/workedSolution.js';
useEngine(new ComputeEngine());
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const one = async (sql, p) => Object.values((await q(sql, p))[0])[0];
const match = (a, b) => one(`SELECT public.math_answers_match($1,$2) m`, [a, b]);
const verdict = (a, acc) => one(`SELECT public.worked_answer_verdict($1, $2::text[]) v`, [a, acc]);

// ── The schema, exactly as labels.test builds it ───────────────────────
await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;`);
const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);
await x(setup.match(/ALTER TABLE public\.\w+\s+ENABLE ROW LEVEL SECURITY;/g).join('\n'));
await x(setup.match(/^(DROP POLICY IF EXISTS|CREATE POLICY)[\s\S]*?;/gm).filter(s => !/storage\./.test(s)).join('\n'));
await x(setup.match(/CREATE OR REPLACE FUNCTION public\.verify_exam_password[\s\S]*?END; \$\$;/)[0]);
await x(setup.match(/^(GRANT|REVOKE)[\s\S]*?;/gm).filter(g => /public\./.test(g) && !/storage|FUNCTION/.test(g)).join('\n'));
for (const f of ['001_assessments_and_lessons','002_review_mode_and_server_scoring','003_lock_answer_key',
  '012_five_option_items','002b_grant_new_columns','015_archive_assessments','016_unlimited_choices',
  '017_shuffle_questions_switch','018_multi_select_items','019_exam_password_on_assessments',
  '020_exam_content_behind_the_gate','024_worked_solution_items','025_points_per_item',
  '026_worked_answers_are_saved_and_scored','027_score_worked_in_the_database',
  '030_primes_as_the_editor_writes_them','031_any_function_name_is_a_subject',
  '032_a_label_is_part_of_the_answer']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

console.log('=== before 033: the bug ===');
ck('\\frac{-6}{(2u+1)^4} did NOT match -\\frac{6}{(2u+1)^4}',
  !(await match('\\frac{-6}{(2u+1)^4}', '-\\frac{6}{(2u+1)^4}')));
ck('\\frac{-1}{2} did NOT match -\\frac{1}{2} — it was not read as a number at all',
  !(await match('\\frac{-1}{2}', '-\\frac{1}{2}')));
ck('and \\frac{12}{5} did not match 2.4', !(await match('\\frac{12}{5}', '2.4')));

const MIG = fs.readFileSync(P + '/sql/033_a_minus_may_sit_on_the_numerator.sql', 'utf8');
await x(MIG);
await x(MIG);
ck('033 applies, twice', true);

// [student, key, same answer?, why]
const CASES = [
  // What it is for.
  ['\\frac{-6}{(2u+1)^4}', '-\\frac{6}{(2u+1)^4}', true, 'one digit on top'],
  ['-\\frac{6}{(2u+1)^4}', '\\frac{-6}{(2u+1)^4}', true, 'and the other way round'],
  ['\\frac{-6}{\\left(2u+1\\right)^{4}}', '-\\frac{6}{(2u+1)^4}', true, 'as the editor writes it'],
  ["p^{\\prime}(u)=\\frac{-6}{(2u+1)^4}", "p'(u)=-\\frac{6}{(2u+1)^4}", true, 'with a label'],
  ['\\frac{dy}{dx}=\\frac{-x}{y}', '\\frac{dy}{dx}=-\\frac{x}{y}', true, 'one letter on top'],
  ['\\frac{-2x}{3y^{2}}', '-\\frac{2x}{3y^2}', true, 'one term on top'],
  ['\\frac{-x^{2}}{y}', '-\\frac{x^2}{y}', true, 'a power on top'],
  ['3+\\frac{-1}{x}', '3-\\frac{1}{x}', true, 'after a plus'],
  ['3-\\frac{-1}{x}', '3+\\frac{1}{x}', true, 'after a minus, the two cancel'],
  ['(\\frac{-1}{x})', '-\\frac{1}{x}', true, 'inside brackets'],
  ['\\dfrac{-6}{7x}', '-\\frac{6}{7x}', true, 'a \\dfrac'],
  // A number with the sign on top: the number reader, not the normaliser.
  ['\\frac{-1}{2}', '-\\frac{1}{2}', true, 'a number: one digit on top'],
  ['\\frac{-1}{2}', '-0.5', true, 'and as a decimal'],
  ['\\frac{-3}{4}', '-\\frac{3}{4}', true, 'three quarters'],
  ['\\frac{-12}{5}', '-2.4', true, 'two digits on top'],
  ['\\frac{12}{5}', '2.4', true, 'twelve fifths, which 030 had broken'],
  ['\\frac{-1}{12}', '-\\frac{1}{12}', true, 'two digits underneath'],
  ['L=\\frac{-1}{2}', '-\\frac{1}{2}', true, 'a limit with a label'],
  // What it must never do.
  ['\\frac{-1-w^2}{(w^2+1)^2}', '-\\frac{1-w^2}{(w^2+1)^2}', false, 'two terms on top: not the same'],
  ['\\frac{-1-w^2}{(w^2+1)^2}', '\\frac{1-w^2}{(w^2+1)^2}', false, 'nor the same without the sign'],
  ['x\\frac{-1}{2}', 'x-\\frac{1}{2}', false, 'after a factor the sign cannot move out'],
  ['\\frac{6}{(2u+1)^4}', '-\\frac{6}{(2u+1)^4}', false, 'a lost sign is still wrong'],
  ['\\frac{-6}{(2u+1)^4}', '\\frac{6}{(2u+1)^4}', false, 'an added sign is still wrong'],
  ['-\\frac{-6}{(2u+1)^4}', '-\\frac{6}{(2u+1)^4}', false, 'two signs are not one'],
  ['\\frac{-6}{(2u+1)^3}', '-\\frac{6}{(2u+1)^4}', false, 'a wrong denominator is still wrong'],
  ['\\frac{1}{2}', '-\\frac{1}{2}', false, 'a number with its sign lost is wrong'],
  ['\\frac{-1}{2}', '\\frac{1}{2}', false, 'and with a sign added'],
  ['\\frac{-1}{3}', '-\\frac{1}{2}', false, 'and a different number'],
];

console.log('\n=== the database ===');
for (const [a, k, same, why] of CASES) {
  ck(`${why}: ${a}  vs  ${k}`, (await match(a, k)) === same);
}

console.log('\n=== the full verdict, as the scorer calls it ===');
for (const [a, k, same, why] of CASES) {
  const v = await verdict(a, [k]);
  ck(`${why}`, (v === null) === same, v || 'right');
}

console.log('\n=== the dashboard marker agrees ===');
const disagree = [];
for (const [a, k, same] of CASES) {
  const js = markAnswer([a], { variable: 'x', marks: 2, steps: [{ latex: k, marks: 2 }] }).correct;
  if (js !== same) disagree.push(`${a} vs ${k}: js=${js} db=${same}`);
}
ck('markAnswer gives the database\'s verdict on every case', disagree.length === 0, disagree.join('; '));

console.log('\n=== nothing else moved ===');
for (const [a, k, same] of [
  ["y'=\\frac{1}{x}", "y'=x^{-1}", false],
  ["f^{\\prime\\prime}(x)=12x^2-12x", "f''(x)=12x^2-12x", true],
  ['\\frac{1}{2}', '0.5', true],
  ['\\frac{-1}{2}', '-0.5', true],
  ["3y^{2}y^{\\prime}", "3y^2y'", true],
]) ck(`${a} vs ${k} is still ${same}`, (await match(a, k)) === same);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
