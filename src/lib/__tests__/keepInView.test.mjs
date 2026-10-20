// When the page scrolls for the maths field being typed in
// (src/lib/keepInView.js): only when the field is hidden, by just enough,
// and never back and forth.
//
//   npm run test:keep-in-view
import { scrollNeeded } from '../keepInView.js';

let pass = 0, fail = 0;
const check = (name, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${name}`)) : (fail++, console.log(`  FAIL  ${name} ${d}`)); };
const view = { top: 60, bottom: 450 };   // under a 60px header, above a keyboard at 450

check('a field in plain sight: no scroll', scrollNeeded({ top: 200, bottom: 300 }, view) === 0);
check('a few pixels under the keyboard: still no scroll', scrollNeeded({ top: 355, bottom: 454 }, view) === 0);
check('under the keyboard: scrolls down just past it', scrollNeeded({ top: 500, bottom: 600 }, view) === 162);
check('under the header: scrolls up just past it', scrollNeeded({ top: 20, bottom: 120 }, view) === -52);
check('taller than the room: lines up its top, once', scrollNeeded({ top: 200, bottom: 700 }, view) === 128
  && scrollNeeded({ top: 72, bottom: 572 }, view) === 0);
// A fraction makes the field taller, then the caret moves: the answer to the
// same field never alternates between two scrolls.
{
  let f = { top: 300, bottom: 400 }, moves = [];
  for (let k = 0; k < 6; k++) {
    const grown = k % 2 ? { top: f.top, bottom: f.top + 140 } : { top: f.top, bottom: f.top + 100 };
    const d = scrollNeeded(grown, view);
    moves.push(d);
    f = { top: f.top - d, bottom: f.bottom - d };
  }
  check('typing a fraction does not rock the page', moves.filter(Boolean).length <= 1, JSON.stringify(moves));
}
check('nothing to see by: no scroll', scrollNeeded({ top: 0, bottom: 10 }, { top: 100, bottom: 100 }) === 0 && scrollNeeded(null, view) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
