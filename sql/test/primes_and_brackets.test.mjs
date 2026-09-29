// sql/036: four primes, brackets round a numerator, more kinds of space —
// right answers that were marked wrong on a real paper. The dashboard's
// marker is checked against the database on every case, because saving a
// script from the dashboard overwrites the database's mark.
//
//   npm run test:primes-brackets
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

await x(fs.readFileSync(`${P}/sql/033_a_minus_may_sit_on_the_numerator.sql`, 'utf8'));
const { labelOf } = await import('../../src/lib/mathLabel.js');
const label = a => one(`SELECT public.math_label($1) l`, [a]);

const FOURTH = 'k^{\\prime\\prime\\prime\\prime}\\left(s\\right)=0';
const BRACKETS = 'q^{\\prime}\\left(w\\right)=\\frac{\\left(4-w^2\\right)}{\\left(w^2+4\\right)^2}';
const QW = ["q'(w)=\\frac{4-w^2}{(w^2+4)^2}"];

console.log('=== before 036: the bugs, as a real paper met them ===');
ck("k''''(s) = 0 as the keyboard writes it was WRONG against 0", (await verdict(FOURTH, ['0'])) !== null);
ck('brackets round the numerator were WRONG', (await verdict(BRACKETS, QW)) !== null);

const MIG = fs.readFileSync(P + '/sql/036_four_primes_and_brackets.sql', 'utf8');
await x(MIG);
await x(MIG);
ck('036 applies, twice', true);

// [student, accepted, right?, why]
const CASES = [
  [FOURTH, ['0'], true, "k''''(s) = 0, a fourth derivative as the keyboard writes it"],
  ["k''''(s)=0", ['0'], true, 'typed with apostrophes'],
  ['k^{\\prime\\prime\\prime\\prime}(s)=5', ['0'], false, 'a wrong value is still wrong'],
  ['f^{\\prime\\prime\\prime\\prime}(x)=24', ["f''''(x)=24"], true, 'four primes against a four-prime key'],
  ['f^{\\prime\\prime\\prime}(x)=24', ["f''''(x)=24"], false, 'three primes is not a fourth derivative'],
  ['f^{\\prime\\prime\\prime\\prime\\prime}(x)=24', ["f''''(x)=24"], false, 'nor is five'],
  ['f^{(4)}(x)=24', ["f''''(x)=24"], true, 'f^{(4)} is a fourth derivative too'],
  ['f^{\\prime\\prime}(x)=6x^2-2x', ["f''(x)=6x^2-2x"], true, 'second derivatives unchanged'],
  ['f^{\\prime}(x)=6x^2-2x', ["f''(x)=6x^2-2x"], false, 'and a first is still not a second'],
  ["y^{\\prime\\prime\\prime}=24x", ["\\frac{d^3y}{dx^3}=24x"], true, "y''' for d3y/dx3, unchanged"],
  [BRACKETS, QW, true, 'brackets round the whole numerator'],
  ["q'(w)=\\frac{4-w^2}{((w^2+4)^2)}", QW, false, 'brackets that do not span a whole denominator with none inside are left'],
  ['\\frac{9}{(3u+2)}', ['\\frac{9}{3u+2}'], true, 'brackets round the whole denominator'],
  ['\\frac{(x+1)^2}{x}', ['\\frac{x+1^2}{x}'], false, '(x+1)^2 keeps its brackets — they do not span the numerator'],
  ['\\frac{(a)(b)}{c}', ['\\frac{a)(b}{c}'], false, '(a)(b) is not unwrapped into nonsense'],
  ['\\frac{(-9)}{(3u+2)^4}', ['-\\frac{9}{(3u+2)^4}'], true, 'brackets and a minus on top together'],
  ['3y^2~y^{\\prime}', ["3y^2y'"], true, 'a ~ space'],
  ['3y^2\\thinspace y^{\\prime}', ["3y^2y'"], true, 'a \\thinspace'],
  ['3y^2\\hspace{2pt}y^{\\prime}', ["3y^2y'"], true, 'an \\hspace'],
  ['3y^2\\negthinspace y^{\\prime}', ["3y^2y'"], true, 'a negative space'],
];

console.log('\n=== the verdict, as the scorer calls it ===');
for (const [a, acc, right, why] of CASES) {
  const v = await verdict(a, acc);
  ck(why, (v === null) === right, v || 'right');
}

console.log('\n=== the dashboard agrees ===');
const labelsDisagree = [];
for (const s of [FOURTH, "k''''(s)=0", 'f^{\\prime\\prime\\prime\\prime\\prime}(x)=1', 'f^{(4)}(x)=1',
  'F^{\\prime\\prime\\prime\\prime}(t)=1', "y^\\prime=2", 'y^{\\doubleprime}=2', 'q^{\\prime}\\left(w\\right)=1',
  '\\frac{d^4y}{dx^4}=0', 'h^{\\prime\\prime\\prime\\prime}(2)=0']) {
  const sql = await label(s);
  const l = labelOf(s);
  const js = l ? `${l.fn}|${l.order}|${l.at}` : null;
  if (sql !== js) labelsDisagree.push(`${s}: sql=${sql} js=${js}`);
}
ck('the label reader gives the same answer in both, on every case', labelsDisagree.length === 0, labelsDisagree.join('; '));
ck("and reads k''''(s) as a fourth derivative", (await label(FOURTH)) === 'k|4|s');
const markDisagree = [];
for (const [a, acc, right] of CASES.filter(c => !/nonsense|keeps its brackets|do not span/.test(c[3]))) {
  const js = markAnswer([a], { variable: 'x', marks: 2, steps: [{ latex: acc[0], marks: 2 }], accept: acc.slice(1) }).correct;
  if (js !== right) markDisagree.push(`${a}: js=${js} want=${right}`);
}
ck('the dashboard marker gives the database\'s verdict', markDisagree.length === 0, markDisagree.join('; '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
