// A phone's keyboard taking focus for a moment is not "Screen lost focus";
// a focus loss that lasts still is.
//
//   npm run test:focus-loss

import {
  createFocusLossWatcher, isTypingTarget, FOCUS_LOSS_MS, KEYBOARD_GRACE_MS, COVER_MS, COVER_GRACE_MS,
} from '../focusLoss.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// A clock and timers the test moves by hand.
function world(waits = {}) {
  let t = 0, seq = 0;
  const timers = new Map();
  const w = {
    focused: true, hidden: false, losses: 0,
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); t = due[1].at; due[1].fn();
      }
      t = end;
    },
    pending: () => timers.size,
  };
  w.watcher = createFocusLossWatcher({
    onLoss: () => { w.losses++; },
    hasFocus: () => w.focused,
    isHidden: () => w.hidden,
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: id => { timers.delete(id); },
    ...waits,
  });
  // What the page does: blur → watcher.blur(), focus → watcher.cancel().
  w.blur = () => { w.focused = false; w.watcher.blur(); };
  w.focus = () => { w.focused = true; w.watcher.cancel(); };
  return w;
}

console.log('=== the keyboard is not a violation ===');
{
  const w = world();
  w.watcher.typing();            // student taps an answer box
  w.blur(); w.advance(400); w.focus();
  w.advance(10_000);
  check('focus gone for 400 ms while the keyboard slides up: not counted', w.losses === 0);
}
{
  const w = world();
  w.watcher.typing();
  w.blur(); w.advance(KEYBOARD_GRACE_MS - 100); w.focus();
  w.advance(10_000);
  check('a slow keyboard, back within the grace: not counted', w.losses === 0);
}
{
  const w = world();
  w.watcher.typing();
  w.blur(); w.advance(300);
  w.focused = true;              // focus came back without a focus event
  w.advance(10_000);
  check('focus back without a focus event: the check at the end of the wait sees it', w.losses === 0);
}
{
  const w = world();
  for (let i = 0; i < 10; i++) {   // ten answer boxes, ten keyboards
    w.watcher.typing(); w.blur(); w.advance(250); w.focus(); w.advance(20_000);
  }
  check('ten keyboards in a sitting: nothing counted, nothing left pending', w.losses === 0 && w.pending() === 0);
}
{
  const w = world();
  w.blur(); w.advance(FOCUS_LOSS_MS - 100); w.focus(); w.advance(10_000);
  check('any blur that comes back inside the wait: not counted', w.losses === 0);
}

console.log('\n=== a focus loss that lasts still is ===');
{
  const w = world();
  w.blur(); w.advance(FOCUS_LOSS_MS + 1);
  check('notification shade or split screen, nowhere near typing: counted once', w.losses === 1);
  w.advance(60_000);
  check('…and only once for that one loss', w.losses === 1);
}
{
  const w = world();
  w.watcher.typing(); w.advance(100);
  w.blur(); w.advance(KEYBOARD_GRACE_MS + 1);
  check('a split screen opened straight after tapping a box: still counted, just later', w.losses === 1);
}
{
  const w = world();
  w.watcher.typing(); w.advance(KEYBOARD_GRACE_MS + 500);
  w.blur(); w.advance(FOCUS_LOSS_MS + 1);
  check('long after the last tap, the normal wait applies', w.losses === 1);
}
{
  const w = world();
  w.blur(); w.advance(FOCUS_LOSS_MS + 1); w.focus();
  w.blur(); w.advance(FOCUS_LOSS_MS + 1);
  check('two separate losses: two counts', w.losses === 2);
}
{
  const w = world();
  w.blur(); w.advance(200);
  w.hidden = true; w.watcher.cancel();   // switched app: the tab-switch check counts it
  w.advance(10_000);
  check('the page went hidden: left to the tab-switch check, not counted twice', w.losses === 0);
}
{
  const w = world();
  w.blur(); w.advance(200); w.hidden = true;  // hidden, but no event reached us
  w.advance(10_000);
  check('hidden by the end of the wait: not counted here', w.losses === 0);
}

console.log('\n=== a window over the page that sends no blur (chat bubbles) ===');
{
  const w = world();
  // The once-a-second poll: no blur event, just document.hasFocus() false.
  w.focused = false;
  for (let i = 0; i < 10; i++) { w.watcher.check(); w.advance(1000); }
  check('the poll alone finds it: counted once, not once a second', w.losses === 1, String(w.losses));
  w.focused = true; w.watcher.cancel();
  w.focused = false;
  for (let i = 0; i < 5; i++) { w.watcher.check(); w.advance(1000); }
  check('…and a second bubble, after coming back, is a second count', w.losses === 2, String(w.losses));
}
{
  const w = world();
  w.blur(); w.advance(500);
  w.watcher.check(); w.advance(500); w.watcher.check(); w.advance(600);
  check('a poll during a blur\'s wait does not restart it', w.losses === 1);
}
{
  const w = world();
  w.focused = false; w.watcher.check(); w.advance(300); w.focus(); w.advance(10_000);
  check('a poll that finds focus back in time: not counted', w.losses === 0);
}

console.log('\n=== the cover: sooner than a count, never for a keyboard ===');
{
  const w = world({ lossMs: COVER_MS, graceMs: COVER_GRACE_MS });
  w.blur(); w.advance(COVER_MS + 1);
  check('a bubble opened: the paper is covered within a second', w.losses === 1 && COVER_MS < FOCUS_LOSS_MS);
}
{
  const w = world({ lossMs: COVER_MS, graceMs: COVER_GRACE_MS });
  w.watcher.typing(); w.blur(); w.advance(400); w.focus(); w.advance(10_000);
  check('a keyboard\'s blur: no cover', w.losses === 0);
}

console.log('\n=== what raises a keyboard ===');
check('a text box', isTypingTarget({ tagName: 'INPUT', type: 'text' }));
check('an input with no type', isTypingTarget({ tagName: 'INPUT' }));
check('a textarea (essay)', isTypingTarget({ tagName: 'TEXTAREA' }));
check('the maths field', isTypingTarget({ tagName: 'MATH-FIELD' }));
check('contenteditable', isTypingTarget({ tagName: 'DIV', isContentEditable: true }));
check('a radio choice does not', !isTypingTarget({ tagName: 'INPUT', type: 'radio' }));
check('a checkbox does not', !isTypingTarget({ tagName: 'INPUT', type: 'checkbox' }));
check('a button does not', !isTypingTarget({ tagName: 'BUTTON' }));
check('nothing does not', !isTypingTarget(null) && !isTypingTarget(undefined));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
