// Primes all on one level, whatever the student pressed to get them.
//
//   npm run test:prime-typing
import { canonicalPrimes } from '../primeTyping.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const c = s => canonicalPrimes(s).latex;
const P2 = 'f^{\\prime\\prime}(x)=0', P3 = 'f^{\\prime\\prime\\prime}(x)=0', P4 = 'f^{\\prime\\prime\\prime\\prime}(x)=0';

console.log('=== every route the editor took, as it wrote them ===');
for (const [input, want, how] of [
  ['f^{\\prime}^{\\prime}(x)=0', P2, 'prime twice at the base'],
  ['f^{\\prime}^{\\prime}^{\\prime}(x)=0', P3, 'three times'],
  ['f^{\\prime}^{\\prime}^{\\prime}^{\\prime}(x)=0', P4, 'four times'],
  ['f^{\\prime^{\\prime}}(x)=0', P2, 'prime, left arrow, prime — the prime on a prime'],
  ['f^{^{\\prime}^{\\prime}}(x)=0', P2, 'exponent button, then prime twice'],
  ['f^{\\prime^{^{\\prime}}}(x)=0', P2, 'prime, into its superscript, prime'],
  ['f^{\\prime}^{^{\\prime}}(x)=0', P2, 'prime, exponent button, prime'],
  ['f^{\\prime^{}\\prime}(x)=0', P2, 'an empty box left between two primes'],
  ['f^{\\doubleprime}(x)=0', P2, 'the editor\'s double prime'],
  ['f^{\\prime}{}^{\\prime}(x)=0', P2, 'a second prime on an empty base'],
  ['f^{\\prime\\prime}(x)=0', P2, 'already right: unchanged'],
]) check(how, c(input) === want, c(input));

console.log('\n=== what it must never touch ===');
for (const s of ['x^{2}', 'x^2+1', 'e^{-x}', 'f^{(4)}(x)', 'x^{\\prime x}', 'y^{2}\\frac{dy}{dx}', '3^{\\primes}', "f'(x)", '']) {
  check(`unchanged: ${JSON.stringify(s)}`, c(s) === s, c(s));
}
check('a prime run followed by a real power keeps the power', c('f^{\\prime}^{2}') === 'f^{\\prime}^{2}');
check('two separate functions each keep their own primes',
  c('f^{\\prime}^{\\prime}(x)+g^{\\prime}(x)') === 'f^{\\prime\\prime}(x)+g^{\\prime}(x)');
check('inside a fraction too', c('\\frac{f^{\\prime}^{\\prime}(x)}{2}') === '\\frac{f^{\\prime\\prime}(x)}{2}');

console.log('\n=== where the caret goes ===');
{
  const r = canonicalPrimes('f^{\\prime^{\\prime}}');
  check('just past the fixed primes, so (x) is typed at the base', r.changedEnd === r.latex.length && r.latex === 'f^{\\prime\\prime}');
  check('nothing changed: no caret move', canonicalPrimes('f^{\\prime\\prime}(x)').changedEnd === -1);
  const m = canonicalPrimes('f^{\\prime}^{\\prime}(x)=3');
  check('mid-expression: the index is just after the run', m.latex.slice(0, m.changedEnd) === 'f^{\\prime\\prime}');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
