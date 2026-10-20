// How far to scroll the page so the maths field being typed in can be seen
// — and, above all, NOT to scroll when it already can.
//
// MathLive scrolls the page on every keystroke: the field into view
// "nearest", then again if its bottom is under the on-screen keyboard. On an
// iPhone both measurements move as Safari's toolbar grows and shrinks, and a
// fraction makes the field taller and sends the caret up to the numerator
// and down to the denominator, so typing one made the whole page jump up and
// down. The field now scrolls only when it is actually hidden — behind the
// keyboard or under the exam header — by just enough, and a few pixels
// either way are left alone so nothing can rock back and forth.

const SLACK = 6;     // a move this small is not worth making
const GAP = 12;      // room left between the field and what was hiding it

/**
 * The scroll (positive = down) that brings a field at `field` {top, bottom}
 * into the visible band `view` {top, bottom}, or 0 when it is visible. A field
 * taller than the band is lined up by its top: what is being typed starts
 * there, and lining up the bottom as well would pull it back and forth.
 */
export function scrollNeeded(field, view) {
  const room = view.bottom - view.top;
  if (!(room > 0) || !field) return 0;
  if (field.top < view.top - SLACK) return field.top - view.top - GAP;
  if (field.bottom - field.top > room - GAP) {
    return field.top > view.top + SLACK ? field.top - view.top - GAP : 0;
  }
  if (field.bottom > view.bottom + SLACK) return field.bottom - view.bottom + GAP;
  return 0;
}

/** The band of the screen a field can be seen in: below the sticky header, above the keyboard. */
export function visibleBand() {
  const kb = typeof window !== 'undefined' ? window.mathVirtualKeyboard : null;
  const vv = window.visualViewport;
  let bottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
  if (kb?.visible) {
    const r = kb.boundingRect;
    if (r && r.height > 0) bottom = Math.min(bottom, r.top);
  }
  const header = document.querySelector('.exam-header');
  const top = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  return { top, bottom };
}

/** Scroll the page, only if it must, so `el` can be seen. */
export function keepInView(el) {
  if (!el?.isConnected) return;
  const delta = scrollNeeded(el.getBoundingClientRect(), visibleBand());
  if (delta) window.scrollBy({ top: delta, behavior: 'instant' });
}
