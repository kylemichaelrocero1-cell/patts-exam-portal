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

// The paper is covered sooner than a violation is counted: a chat bubble
// (Messenger's, with Meta AI in it) or a split screen opened over the exam
// must not have the question sitting beside it. A keyboard's blink of a
// blur is shorter than this, so it never shows the cover.
export const COVER_MS = 600;
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
 * onLoss() is called once per focus loss that lasts. hasFocus() and
 * isHidden() are read when the wait is over. lossMs and graceMs are the
 * waits (normally, and just after an answer box was used).
 */
export function createFocusLossWatcher({
  onLoss, hasFocus, isHidden,
  lossMs = FOCUS_LOSS_MS, graceMs = KEYBOARD_GRACE_MS,
  now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let pending = null;
  let lastTyping = -Infinity;
  // This loss has been reported: no second report until focus comes back.
  let reported = false;
  const cancel = () => {
    if (pending !== null) { clearTimer(pending); pending = null; }
    reported = false;
  };
  const blur = () => {
    if (pending !== null) { clearTimer(pending); pending = null; }
    const wait = now() - lastTyping < graceMs ? graceMs : lossMs;
    pending = setTimer(() => {
      pending = null;
      if (isHidden() || hasFocus()) return;
      reported = true;
      onLoss();
    }, wait);
  };
  return {
    /** An answer box gained or lost focus, so a keyboard is on its way. */
    typing() { lastTyping = now(); },
    blur,
    /**
     * A poll found the page without focus. Some windows that float over the
     * browser may take focus without the page being sent a blur; this starts
     * the same wait, once, and never re-reports a loss already counted.
     */
    check() { if (pending === null && !reported) blur(); },
    /** Focus came back, or the page was hidden (counted elsewhere). */
    cancel,
  };
}
