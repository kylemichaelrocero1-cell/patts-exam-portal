// When the exam window losing focus counts as a violation.
//
// Some phones take focus off the page for a moment while their keyboard
// slides up or down, then hand it straight back. That blur is the phone, not
// the student, and counted on its own every tap into an answer box was
// "Screen lost focus", which suspended the sitting at the fourth. So a blur
// is a violation only if focus is still gone once a short wait is over and
// the page is still showing (a hidden page is the tab-switch check's job).
// The wait is longer just after an answer box gained or lost focus, which
// is when a keyboard comes or goes. A real split screen or notification
// shade still counts; it is only counted a moment later.

export const FOCUS_LOSS_MS = 1500;
export const KEYBOARD_GRACE_MS = 3000;

// The exam screen covers the paper — and logs one flag — once focus has
// been gone this long. Short, so that a glance at the app switcher or a
// notification that is over in a second is still caught; a keyboard's
// blink of a blur is shorter, and just after an answer box is used the
// longer COVER_GRACE_MS applies. (FOCUS_LOSS_MS above is the older, slower
// rule this replaced on the exam screen, kept for its tests.)
export const COVER_MS = 300;
export const COVER_GRACE_MS = 1500;

/** Is this element one the phone raises a keyboard for? */
export function isTypingTarget(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'math-field') return true;
  if (tag === 'input') {
    const type = String(el.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image', 'hidden'].includes(type);
  }
  return el.isContentEditable === true;
}

/**
 * On an iPad or iPhone the on-screen keyboard is a window of its own: while
 * it is up, Safari says the page does not have the focus (document.hasFocus()
 * is false) but sends no blur. Only the once-a-second poll sees it, and a
 * student typing for longer than the grace was flagged every time the
 * keyboard came up.
 *
 * Closing the keyboard does not end it: the answer box lets go, but Safari can
 * go on saying the page has no focus for some time after, with nothing to mark
 * when it changes. A student who closed the keyboard was flagged once the grace
 * ran out. So on these devices (holdsFocus below), from the first sign of a
 * keyboard until focus is next seen back:
 *   - a loss only the poll sees is the keyboard's, up or closed;
 *   - so is a blur within the grace of the keyboard coming or going.
 * A blur at any other time still counts, and leaving the page is the
 * tab-switch check's, which none of this touches.
 */
export function keyboardHidesFocus(device) {
  return device?.os === 'iPad' || device?.os === 'iPhone';
}

/**
 * onLoss() is called once per focus loss that lasts. hasFocus() and
 * isHidden() are read when the wait is over. lossMs and graceMs are the
 * waits (normally, and just after an answer box was used). keyboardUp()
 * says the keyboard is up. holdsFocus says this device's keyboard hides the
 * focus (see keyboardHidesFocus): check() then starts no wait while the
 * keyboard explains it, and a wait the keyboard explains ends in onForgiven()
 * rather than a loss.
 */
export function createFocusLossWatcher({
  onLoss, hasFocus, isHidden, keyboardUp = () => false, holdsFocus = false, onForgiven = () => {},
  lossMs = FOCUS_LOSS_MS, graceMs = KEYBOARD_GRACE_MS,
  now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let pending = null;
  let lastTyping = -Infinity;
  // This loss has been reported: no second report until focus comes back.
  let reported = false;
  // A keyboard has been up since focus was last seen back (holdsFocus only).
  let keyboardInPlay = false;
  const keyboardExplains = () => holdsFocus && (keyboardUp() || keyboardInPlay);
  const cancel = () => {
    if (pending !== null) { clearTimer(pending); pending = null; }
    reported = false;
  };
  const start = (fromPoll) => {
    if (pending !== null) { clearTimer(pending); pending = null; }
    const nearKeyboard = now() - lastTyping < graceMs;
    const wait = nearKeyboard ? graceMs : lossMs;
    pending = setTimer(() => {
      pending = null;
      if (isHidden() || hasFocus()) return;
      // A blur may arrive just before the answer box lets go, so the keyboard
      // is looked for both when the wait began and now it is over.
      if (fromPoll ? keyboardExplains() : holdsFocus && (nearKeyboard || now() - lastTyping < graceMs)) {
        onForgiven();
        return;
      }
      reported = true;
      onLoss();
    }, wait);
  };
  return {
    /** An answer box gained or lost focus, so a keyboard is on its way. */
    typing() { lastTyping = now(); if (holdsFocus) keyboardInPlay = true; },
    blur: () => start(false),
    /**
     * A poll found the page without focus. Some windows that float over the
     * browser may take focus without the page being sent a blur; this starts
     * the same wait, once, and never re-reports a loss already counted.
     */
    check() { if (pending === null && !reported && !keyboardExplains()) start(true); },
    /** Would a keyboard explain the page having no focus right now? */
    keyboardExplains,
    /**
     * A poll found the page with the focus. Once that is so with the keyboard
     * settled, a loss with no blur is a window over the page again.
     */
    focusSeen() {
      if (keyboardInPlay && !keyboardUp() && now() - lastTyping >= graceMs) keyboardInPlay = false;
    },
    /** Focus came back, or the page was hidden (counted elsewhere). */
    cancel,
  };
}
