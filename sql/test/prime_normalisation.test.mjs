// MathLive does not write an apostrophe. Whatever the student presses, it
// serialises a prime as ^{\prime} — so every derivative answer they typed was
// compared against an answer written y'=... by hand, and marked wrong.
//
// The strings below are REAL: they were read back out of the live database
// from papers students had already submitted.
//
//   npm run test:primes
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const match = async (a, b) => (await q(`SELECT public.math_answers_match($1,$2) m`, [a, b]))[0].m;

await x(`CREATE SCHEMA IF NOT EXISTS public;`);
for (const f of ['027_score_worked_in_the_database']) {
  // Only the matcher is needed; pull its three functions out of the migration.
  const sql = fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8');
  for (const m of sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(normalize_math|math_as_number|math_answers_match)[\s\S]*?\$\$;/g)) {
    await x(m[0]);
  }
}

console.log('=== before 030: what students actually typed ===');
// Straight from review_attempts on the live database.
const REAL = [
  ['y^{\\prime}=6x', "y'=6x"],
  ['y^{\\prime}=\\cos(x)', "y'=\\cos(x)"],
  ['y^{\\prime}=3x^2-4', "y'=3x^2-4"],
  ['y^{\\prime}=5', "y'=5"],
];
for (const [typed, answer] of REAL) {
  ck(`${typed} did NOT match ${answer} — the bug`, !(await match(typed, answer)));
}

await x(fs.readFileSync(P + '/sql/030_primes_as_the_editor_writes_them.sql', 'utf8'));
await x(fs.readFileSync(P + '/sql/030_primes_as_the_editor_writes_them.sql', 'utf8'));
ck('030 applies, twice', true);

console.log('\n=== after ===');
for (const [typed, answer] of REAL) {
  ck(`${typed}  =  ${answer}`, await match(typed, answer));
}
ck('and against a bare answer with no label', await match('y^{\\prime}=6x', '6x'));
ck('the editor spelling on an implicit item matches the dy/dx answer',
  await match('y^{\\prime}=-\\frac{x}{y}', '\\frac{dy}{dx}=-\\frac{x}{y}'));

console.log('\n=== higher derivatives ===');
ck("second derivative: ^{\\prime\\prime} is y''",
  await match('y^{\\prime\\prime}=12x^2-12x', "y''=12x^2-12x"));
ck("and y'' may be stripped as a subject",
  await match("y''=12x^2-12x", '12x^2-12x'));
ck("third derivative too",
  await match('y^{\\prime\\prime\\prime}=180x^2', "y'''=180x^2"));
ck("y''' is not read as y' — longest first",
  !(await match("y'''=180x^2", "y'=180x^2")) || await match("y'''=180x^2", '180x^2'));

console.log('\n=== other things the real submissions showed ===');
ck('an empty superscript is dropped: 2(x+1)^{} is 2(x+1)',
  await match('2\\left(x+1\\right)^{}', '2(x+1)'));
ck('\\left and \\right still go', await match('\\cos\\left(x\\right)', '\\cos(x)'));
ck('a thin space still goes', await match('y=\\sin(x)\\,+c', 'y=\\sin(x)+c'));
ck('an UNFINISHED answer still does not match — a placeholder is not an answer',
  !(await match('\\cos(\\placeholder{})', '\\cos(x)')));

console.log('\n=== and nothing different became the same ===');
ck("y'=6x is not y'=6", !(await match('y^{\\prime}=6x', 'y^{\\prime}=6')));
ck('2x=6 is still not x=3', !(await match('2x=6', 'x=3')));
ck('sin is still not cos', !(await match('y^{\\prime}=\\sin(x)', 'y^{\\prime}=\\cos(x)')));
ck('a number is still compared as a number', await match('2', '2.0'));
ck('and a fraction against its decimal', await match('\\frac{1}{4}', '0.25'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
