// The review screens draw stored answers with KaTeX, which prints the NAME of
// any command it does not know, in red. These are the maths keyboard's own
// commands, drawn through displayLatex() by the real KaTeX, with its error
// marker looked for in the output.
//
//   npm run test:math-display
import katex from 'katex';
import { displayLatex } from '../mathDisplay.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const draw = s => katex.renderToString(s, { throwOnError: false });
const broken = html => /katex-error|#cc0000|color:\s*#cc0000/i.test(html);

// Seen on the MATH 117 RETAKE review screens.
const SEEN = [
  ['\\frac{d}{\\differentialD x}\\left(3y^2\\right)', 'd/dx written with the keyboard'],
  ['\\frac{d}{\\differentialD x}\\left(y^3\\right)=3y^2\\frac{dy}{dx}', 'the same, as an equation'],
  ['\\lim_{x\\to-2}\\placeholder{}9', 'an empty box left in an answer'],
  ['f^{\\prime}\\left(x\\right)=\\frac{\\left(x+h\\right)^2+\\left(x\\right)^2^{}}{h}',
    'an empty superscript stacked on a squared bracket'],
];
for (const [s, why] of SEEN) {
  check(`before: KaTeX prints a command name — ${why}`, broken(draw(s)));
  check(`after: drawn cleanly — ${why}`, !broken(draw(displayLatex(s))), displayLatex(s));
}

console.log('\n=== every command the keyboard writes that KaTeX lacks ===');
for (const s of ['\\exponentialE^{x}', '\\imaginaryI', '\\imaginaryJ', '\\capitalDifferentialD',
  "f^{\\doubleprime}(x)", '\\mleft(x+1\\mright)', '\\placeholder', '\\placeholder[a]{}', '\\placeholder[a]{7}']) {
  check(s, !broken(draw(displayLatex(s))), displayLatex(s));
}

console.log('\n=== stacked superscripts and subscripts ===');
for (const [s, want, why] of [
  ['x^2^{}', 'x^2', 'an empty superscript is dropped'],
  ['x_1_{ }', 'x_1', 'an empty subscript is dropped'],
  ['x^2^3', 'x^2{}^3', 'a second superscript hangs off an empty group'],
  ['x^{2}^{3}', 'x^{2}{}^{3}', 'the same with braced arguments'],
  ['x_1^2^3', 'x_1^2{}^3', 'a subscript between them does not hide the double'],
  ['e^{x^2}^3', 'e^{x^2}{}^3', 'a superscript inside the argument is its own base'],
  ['\\left(x\\right)^\\prime^2', '\\left(x\\right)^\\prime{}^2', 'a command as the first argument'],
]) {
  check(`${why}: ${s}`, displayLatex(s) === want && !broken(draw(displayLatex(s))), displayLatex(s));
  check(`and KaTeX really did refuse it: ${s}`, broken(draw(s)));
}
for (const s of ['x^2_1', 'x_1^2', '{x^2}^3', 'x^2+y^2', '\\frac{a^2}{b}^2', 'a\\_b^2', 'x^{2^{3}}', '\\lim_{h\\to0}\\frac{f(x+h)^2}{h}']) {
  check(`legal scripts are left exactly as they were: ${s}`, displayLatex(s) === s, displayLatex(s));
}

console.log('\n=== what it leaves alone ===');
check('ordinary LaTeX is untouched', displayLatex('\\frac{dy}{dx}=-\\frac{x}{y}') === '\\frac{dy}{dx}=-\\frac{x}{y}');
check('a box with something in it shows what is in it', displayLatex('\\placeholder[a]{7}+1') === '7+1');
check('an empty box shows as a box', displayLatex('x\\placeholder{}') === 'x\\square ');
check('a longer command that merely starts the same is not touched',
  displayLatex('\\differentialDx') === '\\differentialDx');
check('null and undefined are empty, not "undefined"', displayLatex(null) === '' && displayLatex(undefined) === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
