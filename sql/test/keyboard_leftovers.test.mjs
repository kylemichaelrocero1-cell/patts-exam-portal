// sql/037: the maths keyboard's leftovers — empty ^{} and _{}, and an answer
// typed inside a superscript with nothing under it — are not part of an
// answer. And src/lib/mathNormalize.js, the dashboard's copy of the
// database's comparison, gives the SAME answer as the database on every
// string in a broad list: saving a script from the dashboard overwrites the
// database's mark, so the two must never disagree about what matches.
//
// Also sql/038: any arrow in a limit is \\to.
//
//   npm run test:leftovers
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
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '\n        ' + d : ''}`)); };
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
await x(fs.readFileSync(`${P}/sql/036_four_primes_and_brackets.sql`, 'utf8'));
const { normalizeMath, mathAsNumber, mathAnswersMatch } = await import('../../src/lib/mathNormalize.js');

const LEFTOVERS = [
  ['f^{\\prime^{}\\prime}\\left(x\\right)=6x', ["f''(x)=6x"], 'an empty ^{} between two primes'],
  ["y^{\\prime}^{\\prime}^{\\prime}=^{}24x", ['\\frac{d^3y}{dx^3}=24x'], 'an empty ^{} after the ='],
  ['^{\\frac{dy}{dx}=\\frac{-2x}{y}}', ['\\frac{dy}{dx}=-\\frac{2x}{y}'], 'the answer typed inside a superscript'],
  ['p^{\\prime}\\left(u\\right)=-9\\left(3u+2_{}\\right)^{-4}', ["p'(u)=-\\frac{9}{(3u+2)^4}", '-9(3u+2)^{-4}'], 'an empty subscript'],
  ['5x^{ }', ['5x'], 'an empty superscript with a space in it'],
];
console.log('=== before 037 ===');
// The empty ^{} after an = was already dropped by normalize_math (s8); only
// the dashboard's engine tripped on it. The other three were wrong.
for (const [a, acc, why] of [LEFTOVERS[0], LEFTOVERS[2], LEFTOVERS[3]]) ck(`WRONG before: ${why}`, (await verdict(a, acc)) !== null);
ck('already right before: an empty ^{} after the =', (await verdict(LEFTOVERS[1][0], LEFTOVERS[1][1])) === null);

const MIG = fs.readFileSync(P + '/sql/037_keyboard_leftovers.sql', 'utf8');
await x(MIG);
await x(MIG);
ck('037 applies, twice', true);

console.log('\n=== after 037 ===');
for (const [a, acc, why] of LEFTOVERS) ck(`right: ${why}`, (await verdict(a, acc)) === null);
for (const [a, acc, right, why] of [
  ['x^2', ['x^2'], true, 'a real power is untouched'],
  ['x^{2}', ['x^2'], true, 'and a braced one'],
  ['^{2}', ['2'], true, 'a superscript alone round the whole answer is unwrapped'],
  ['x^{}2', ['x2'], true, 'an empty box in the middle is only removed, not turned into a power'],
  ['x_{}2', ['x^2'], false, 'so x_{}2 is not x squared'],
  ['^{a}+b^{c}', ['a+b^{c}'], false, 'a superscript that does not wrap the whole answer is not unwrapped into nonsense'],
  ['6x', ['5x'], false, 'a wrong answer is still wrong'],
]) ck(why, ((await verdict(a, acc)) === null) === right, String(await verdict(a, acc)));

console.log('\n=== 038: any arrow in a limit is \\to ===');
const LIM_KEY = ["f'(x)=\\lim_{h\\to 0}\\frac{(x+h)^3-x^3}{h}"];
const ARROWS = [
  ['\\rightarrow', 'f^{\\prime}\\left(x\\right)=\\lim_{h\\rightarrow0}\\frac{\\left(x+h\\right)^3-x^3}{h}'],
  ['\\longrightarrow', 'f^{\\prime}\\left(x\\right)=\\lim_{h\\longrightarrow0}\\frac{\\left(x+h\\right)^3-x^3}{h}'],
  ['an empty \\overrightarrow{}', 'f^{\\prime}\\left(x\\right)=\\lim_{h\\overrightarrow{}0}\\frac{\\left(x+h\\right)^3-x^3}{h}'],
];
for (const [what, a] of ARROWS) ck(`WRONG before 038: ${what}`, (await verdict(a, LIM_KEY)) !== null);
const M38 = fs.readFileSync(P + '/sql/038_any_arrow_is_to.sql', 'utf8');
await x(M38);
await x(M38);
ck('038 applies, twice', true);
for (const [what, a] of ARROWS) ck(`right after 038: ${what}`, (await verdict(a, LIM_KEY)) === null);
ck('a real vector is not an arrow', (await one(`SELECT public.normalize_math($1) n`, ['\\overrightarrow{v}'])).includes('overrightarrow'));
ck('\\Rightarrow means "implies" and is left alone', (await one(`SELECT public.normalize_math($1) n`, ['a\\Rightarrow b'])).includes('rightarrow'));
ck('a longer command that merely starts the same is not taken for an arrow',
  (await one(`SELECT public.math_drop_spaces($1) n`, ['\\rightarrowtail'])) === '\\rightarrowtail');
ck('the value still has to be right', (await verdict('f^{\\prime}(x)=\\lim_{h\\rightarrow0}\\frac{(x+h)^3+x^3}{h}', LIM_KEY)) !== null);

console.log("\n=== the dashboard copy gives the database's answer on every string ===");
// Deliberately NOT any paper's answers — the repo is public.
const CORPUS = [
  '5', '5.0', '-3', '0.5', '\\frac{1}{2}', '\\frac12', '\\frac{-1}{2}', '-\\frac{1}{2}', '\\frac{12}{5}', '2.4', '-2.4',
  '\\frac{3}{0}', '\\dfrac{3}{4}', '0.75', '\\tfrac{3}{4}', '\\frac{1}{3}', '\\frac{2}{6}', '1/3',
  "y'=5", "y^{\\prime}=5", '\\frac{dy}{dx}=5', 'dy/dx=5', 'dy/(dx)=5', "f'(x)=2x", "f^{\\prime}\\left(x\\right)=2x",
  "f''(x)=12", "f^{\\prime\\prime}(x)=12", "f^{\\doubleprime}(x)=12", "k''''(s)=0", 'k^{\\prime\\prime\\prime\\prime}\\left(s\\right)=0',
  'k^{(4)}(s)=0', 'k^{\\left(4\\right)}\\left(s\\right)=0', 'k^4(s)=0', 'h^{\\prime\\prime}\\left(2\\right)=7', 'L=6',
  "F''(x)=1", 'x=3', '2x=6', '\\frac{d^2y}{dx^2}=4', '\\frac{d^{2}y}{dx^{2}}=4', 'd^2y/dx^2=4',
  '3y^2\\cdot y^{\\prime}', "3y^2y'", "3y^2 y'", '3y^{2}\\frac{dy}{dx}', '\\frac{dy}{dx}3y^2',
  '\\frac{-9}{(3u+2)^4}', '-\\frac{9}{(3u+2)^4}', '\\frac{(-9)}{(3u+2)^4}', '\\frac{-4-w^2}{(w^2+4)^2}', '-\\frac{4-w^2}{(w^2+4)^2}',
  'x\\frac{-1}{2}', 'x-\\frac{1}{2}', '3+\\frac{-1}{x}', '3-\\frac{1}{x}', '3-\\frac{-1}{x}', '(\\frac{-1}{x})',
  '\\frac{(a+b)}{c}', '\\frac{a+b}{(c)}', '\\frac{(a)(b)}{c}', '\\frac{(x+1)^2}{x}', '((x+1))', '(x+1)(x-1)',
  'x^{-1}', '\\frac{1}{x}', '2\\times3', '2*3', '2\\cdot 3', '6', 'a\\,b', 'a~b', 'a\\thinspace b', 'a\\hspace{2pt}b', 'ab',
  'X^2', 'x^2', '\\left(x+1\\right)^2', '(x+1)^2', '\\mathrm{d}y/\\mathrm{d}x=2', '\\differentialD y/\\differentialD x=2',
  'f^{\\prime^{}\\prime}(x)=6x', '^{\\frac{dy}{dx}=\\frac{-2x}{y}}', 'x_{}+1', '1+-2', '1--2', '-1',
  '\\lim_{x\\to 3}(x+3)', '\\lim_{x\\rightarrow3}=6', '\\sqrt{x^2+4}', 'x(x^2+4)^{-1/2}', 'x\\left(x^2+4\\right)^{-\\frac12}',
  '', '   ', '\\text{2}', '=5', 'y=', "y'''=24x", "y^{\\prime}^{\\prime}^{\\prime}=^{}24x",
  '\\lim_{h\\rightarrow0}', '\\lim_{h\\to 0}', '\\lim_{h\\overrightarrow{}0}', '\\lim_{h\\longrightarrow0}',
  '\\overrightarrow{v}', 'a\\Rightarrow b', '\\rightarrowtail', 'x\\rightarrow\\infty',
];
const nd = [], numd = [];
for (const s of CORPUS) {
  const sqlN = (await q(`SELECT public.normalize_math($1) n`, [s]))[0].n;
  if (sqlN !== normalizeMath(s)) nd.push(`${JSON.stringify(s)}: sql=${JSON.stringify(sqlN)} js=${JSON.stringify(normalizeMath(s))}`);
  const sqlV = (await q(`SELECT public.math_as_number($1)::float8 v`, [s]))[0].v;
  const jsV = mathAsNumber(s);
  if (!((sqlV === null && jsV === null) || (sqlV !== null && jsV !== null && Math.abs(sqlV - jsV) < 1e-9)))
    numd.push(`${JSON.stringify(s)}: sql=${sqlV} js=${jsV}`);
}
ck(`normalize_math: same text for all ${CORPUS.length}`, nd.length === 0, nd.join('\n        '));
ck(`math_as_number: same number (or none) for all ${CORPUS.length}`, numd.length === 0, numd.join('\n        '));
const md = [];
for (const a of CORPUS) for (const b of CORPUS) {
  const sqlM = (await q(`SELECT public.math_answers_match($1,$2) m`, [a, b]))[0].m;
  if (sqlM !== mathAnswersMatch(a, b)) md.push(`${JSON.stringify(a)} vs ${JSON.stringify(b)}: sql=${sqlM}`);
}
ck(`math_answers_match: same verdict on all ${CORPUS.length ** 2} pairs`, md.length === 0, md.slice(0, 15).join('\n        '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
