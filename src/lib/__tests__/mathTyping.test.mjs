// The typing rules of the maths field (src/lib/mathTyping.js): where a key
// lands after ^, and what Backspace does at the start of a denominator. The
// glue to MathLive was checked with real keys in headless Chrome; these are
// the decisions themselves.
//
//   npm run test:math-typing
import { baseKind, exponentAction, backspaceAction, placeNote, slashTakesRun, equalsAction, spaceIsSwallowed } from '../mathTyping.js';

let pass = 0, fail = 0;
const ck = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ' — ' + detail}`); };

console.log('\nWhat an exponent sits on');
for (const [base, want] of [
  [{ command: '\\sin', value: 'sin', isOperator: true }, 'function'],
  [{ command: '\\tanh', value: 'tanh', isOperator: true }, 'function'],
  [{ command: '\\ln', value: 'ln', isOperator: true }, 'function'],
  [{ command: '\\operatorname', value: '', isOperator: true }, 'function'],
  [{ command: '\\int', value: '∫', isOperator: true }, 'other'],
  [{ value: 'e' }, 'e'], [{ command: '\\exponentialE', value: 'e' }, 'e'],
  [{ value: '3' }, 'number'], [{ value: 'x' }, 'other'], [{ value: 't' }, 'other'], [null, 'other'],
]) ck(`${JSON.stringify(base)} → ${want}`, baseKind(base) === want, baseKind(base));

console.log('\nWhere the next key goes');
const at = (kind, sup, atEnd = true) => ({ kind, sup, atEnd });
for (const [ctx, ch, want, why] of [
  [at('function', '2'), 'x', 'exit', 'sin^2x is sin²x'],
  [at('function', '3'), '(', 'exit', 'cos^3(t) is cos³(t)'],
  [at('function', '−1'), 'x', 'exit', 'tanh^-1x is tanh⁻¹x'],
  [at('function', '2'), '\\', 'exit', 'sin^2\\theta'],
  [at('function', '2'), '3', null, 'sin^23 — a longer power, typed on'],
  [at('function', '2x'), 'y', null, 'a power that is not a number is left alone'],
  [at('function', '2', false), 'x', null, 'not at the end of the exponent'],
  [at('e', ''), '2', 'stay', 'e^2t is e^(2t)'],
  [at('number', ''), '2', 'stay', '3^2x is 3^(2x)'],
  [at('other', ''), '2', null, 'x^2 leaps out as before'],
  [at('e', ''), '-', null, 'e^-t'],
  [at('e', '2t'), '(', 'exit', 'e^{2t}(1+t)'],
  [at('e', 't'), '(', 'exit', 'e^{t}(1+t)'],
  [at('e', '-'), '(', null, 'e^{-(…)} — the bracket belongs to the exponent'],
  [at('e', '2t'), '+', null, 'e^{2t+1}: left to the student'],
  [at('e', '2t'), '-', null, 'e^{2t-1}: left to the student'],
  [at('e', '2t'), '=', 'exit', '= never belongs in an exponent'],
  [at('e', ''), '=', null, 'nothing to step out of yet'],
  [at('other', 't'), ')', 'exit', '(e^t) closes the bracket opened before the power'],
  [at('other', '(2t'), ')', null, 'a bracket opened in the exponent closes there'],
  [at('other', '(2t)'), '(', 'exit', 'balanced, then a new bracket'],
  [at('other', '(2t'), '(', null, 'inside an open bracket'],
  [at('other', '2'), '+', 'exit', 'x^2+1 on the maths keyboard'],
  [at('other', '2'), '-', 'exit', 'x^2-1 on the maths keyboard'],
  [at('other', 'n'), '+', null, 'x^{n+1}'],
  [at('number', '2'), '+', null, '3^{2+x}: left to the student'],
  [at('function', '2'), 'xy', null, 'more than one character is not a key'],
]) {
  const got = exponentAction(ctx, ch);
  ck(`${why}`, got === want, `got ${got}`);
}

console.log('\nBackspace at the start of a denominator');
ck('steps back into the numerator when the denominator holds something',
  backspaceAction({ inDenominatorStart: true, denominatorEmpty: false }) === 'numerator');
ck('an empty denominator is left to MathLive (a stray / undone)',
  backspaceAction({ inDenominatorStart: true, denominatorEmpty: true }) === null);
ck('anywhere else, nothing changes', backspaceAction({ inDenominatorStart: false, denominatorEmpty: false }) === null);

console.log('\nWhat / takes as the numerator');
const D = { type: 'macro', command: '\\differentialD' }, Y = { type: 'mord' }, COS = { type: 'operator', command: '\\cos' };
ck('d y → the whole run (dy/dx)', slashTakesRun([D, Y]));
ck('d ² y → the whole run (d²y/dx²)', slashTakesRun([D, { type: 'subsup' }, Y]));
ck('cos t → the whole run', slashTakesRun([COS, Y]));
ck('2 t → left to MathLive (it takes 2t already)', !slashTakesRun([Y, Y]));
ck('a single atom → left to MathLive', !slashTakesRun([Y]) && !slashTakesRun([]) && !slashTakesRun(null));

console.log('\n= and space');
ck('= at the end of a fraction part steps out', equalsAction({ atRoot: false, atEnd: true }) === 'exit');
ck('= on the main line, or mid-way through a part, is typed where it is',
  equalsAction({ atRoot: true, atEnd: true }) === null && equalsAction({ atRoot: false, atEnd: false }) === null);
ck('a space in a numerator, denominator, bracket or root does nothing',
  ['above', 'below', 'root', ''].every(place => spaceIsSwallowed({ place })));
ck('a space in an exponent or subscript still steps out', !spaceIsSwallowed({ place: 'superscript' }) && !spaceIsSwallowed({ place: 'subscript' }));

console.log('\nThe note on the field');
ck('exponent, denominator, numerator, root and subscript each have a note',
  ['superscript', 'below', 'above', 'root', 'subscript'].every(p => placeNote(p).length > 0 && placeNote(p).length <= 50));
ck('the main line has none', placeNote('') === '' && placeNote('body') === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
