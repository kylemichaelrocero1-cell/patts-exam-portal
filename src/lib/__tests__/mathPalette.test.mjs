// Accepted-answer suggestions. These go straight into a rubric, so a wrong
// suggestion hands out marks for a wrong answer and a malformed one puts
// garbage in the database — both worse than suggesting nothing.
//
//   npm run test:palette

import { fracToSlash, suggestVariants, MATH_PALETTE } from '../mathPalette.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('=== a fraction written as a slash ===');
check('the simple case', fracToSlash('\\frac{x}{y}') === 'x/y');
check('a leading minus stays outside', fracToSlash('-\\frac{x}{y}') === '-x/y');
check('a sum in the numerator gets brackets',
  fracToSlash('\\frac{x+1}{y}') === '(x+1)/y', fracToSlash('\\frac{x+1}{y}'));
check('nested braces are read whole, not cut at the first closing brace',
  fracToSlash('\\frac{x^{2}+1}{y}') === '(x^{2}+1)/y', fracToSlash('\\frac{x^{2}+1}{y}'));
check('a command in the denominator survives',
  fracToSlash('\\frac{2}{\\sqrt{x}}') === '2/\\sqrt{x}', fracToSlash('\\frac{2}{\\sqrt{x}}'));
check('brackets in the denominator are kept',
  fracToSlash('\\frac{1}{(w+1)^2}') === '1/(w+1)^2', fracToSlash('\\frac{1}{(w+1)^2}'));
check('the limit definition converts',
  fracToSlash('\\frac{f(x+h)-f(x)}{h}') === '(f(x+h)-f(x))/h',
  fracToSlash('\\frac{f(x+h)-f(x)}{h}'));
check('something with no fraction is returned unchanged',
  fracToSlash('2x+3') === '2x+3' && fracToSlash('') === '');
check('a minus INSIDE a power does not trigger brackets',
  fracToSlash('\\frac{x^{-1}}{y}') === 'x^{-1}/y', fracToSlash('\\frac{x^{-1}}{y}'));

console.log('\n=== suggestions are never malformed ===');
const BALANCED = v =>
  (v.match(/\{/g) || []).length === (v.match(/\}/g) || []).length &&
  (v.match(/\(/g) || []).length === (v.match(/\)/g) || []).length;
const SAMPLES = [
  "y'=5", "y'=2x+3", "y'=\\frac{1}{x}", "q'(w)=\\frac{1}{(w+1)^2}",
  "f'(u)=3u^2-4u+1", "\\frac{dy}{dx}=-\\frac{x}{y}", "s'(t)=8(2t-1)^3",
  "g'(x)=\\frac{2}{\\sqrt{x}}", 'x=\\frac{1}{2}', "h''(2)=12",
];
for (const a of SAMPLES) {
  const v = suggestVariants(a);
  check(`${a} yields only balanced strings`, v.every(BALANCED), JSON.stringify(v.filter(x => !BALANCED(x))));
}
check('the denominator bug is gone — a + inside braces is not a term boundary',
  !suggestVariants("q'(w)=\\frac{1}{(w+1)^2}").some(v => v.includes('1)^2}+')),
  JSON.stringify(suggestVariants("q'(w)=\\frac{1}{(w+1)^2}")));

console.log('\n=== and they say the right thing ===');
check('a subject is offered with and without',
  suggestVariants("y'=5").includes('5'));
check('Leibniz for Lagrange', suggestVariants("y'=5").includes('\\frac{dy}{dx}=5'));
check('1/x for x^{-1}', suggestVariants("y'=x^{-1}").includes("y'=\\frac{1}{x}"));
check('and the slash form of a fraction',
  suggestVariants("y'=\\frac{1}{x}").includes('1/x'));
check('a two-term sum may be written the other way round',
  suggestVariants("y'=2x+3").includes('3+2x'));
check('a three-term sum is left alone rather than half-swapped',
  !suggestVariants("y'=x^2+2x+1").some(v => v.split('+').length !== 3),
  JSON.stringify(suggestVariants("y'=x^2+2x+1")));
check('a fraction of integers offers its decimal',
  suggestVariants('x=\\frac{1}{2}').includes('x=0.5'));
check('nothing is suggested for nothing', eq(suggestVariants(''), []) && eq(suggestVariants(null), []));
check('the answer itself is never suggested back',
  !suggestVariants("y'=5").includes("y'=5"));

console.log('\n=== the palette is still sane ===');
check('every entry has a label, an insertion and a title',
  MATH_PALETTE.every(s => s.label && s.insert && s.title));
check('it offers a limit, a fraction and a prime',
  MATH_PALETTE.some(s => s.label.includes('lim'))
  && MATH_PALETTE.some(s => s.label.includes('frac'))
  && MATH_PALETTE.some(s => s.title.toLowerCase().includes('prime')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
