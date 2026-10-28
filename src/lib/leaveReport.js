// What a proctoring flag says. It used to be one of two sentences for
// everything — "Tab hidden or switched to another app", "Screen lost focus"
// — whatever the device and whatever happened. Now each flag says what the
// page saw, in the words that fit the device it was sat on, which device
// and browser that was, and, once the student is back, how long they were
// away:
//
//   [10:42:07 AM] Left the exam page — home screen, another app, another tab
//                 or the screen locked (iPhone · Safari) — away 48 s
//
// A page cannot see other apps, so it says what it can know: that it was
// hidden (another tab, app or the lock screen), that something took the
// focus while it stayed on screen (a chat bubble, a split screen, another
// window), or that the browser stopped running it altogether (iOS freezes a
// page the moment Safari leaves the screen, sometimes before any event
// reaches it). src/lib/proctoring.js reads these back for the dashboard.

// The page's clock jumping this far means the browser was not running it.
// Well beyond anything the page itself does: the maths keyboard loading on
// a slow phone takes a second or two.
export const PAUSE_MS = 8000;

/** The device and browser, from the user agent: { kind, os, browser, label }. */
export function deviceOf({ userAgent = '', maxTouchPoints = 0 } = {}) {
  const ua = String(userAgent);
  let os = 'device', kind = 'computer';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) { os = 'iPad'; kind = 'tablet'; }
  else if (/iPhone|iPod/.test(ua)) { os = 'iPhone'; kind = 'phone'; }
  else if (/Android/.test(ua)) { os = 'Android'; kind = /Mobile/.test(ua) ? 'phone' : 'tablet'; }
  else if (/CrOS/.test(ua)) os = 'Chromebook';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'Mac';
  else if (/Linux/.test(ua)) os = 'Linux';

  let browser = 'browser';
  if (/FBAN\/Messenger|MessengerForiOS|FB_IAB\/MESSENGER|Orca-Android/i.test(ua)) browser = 'Messenger in-app browser';
  else if (/FBAN|FBAV|FB_IAB|FBIOS/.test(ua)) browser = 'Facebook in-app browser';
  else if (/Instagram/.test(ua)) browser = 'Instagram in-app browser';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/EdgA|EdgiOS|Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|OPiOS|Opera/.test(ua)) browser = 'Opera';
  else if (/FxiOS|Firefox\//.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return { kind, os, browser, label: `${os} · ${browser}` };
}

const PHONE = d => d?.kind === 'phone' || d?.kind === 'tablet';

/**
 * The sentence for a leave of this kind on this device:
 *   'hidden' — the page was hidden;
 *   'blur'   — something took the focus while the page stayed on screen;
 *   'paused' — the browser stopped running the page, no event seen.
 */
export function leaveText(kind, device) {
  const phone = PHONE(device);
  const what = {
    hidden: phone
      ? 'Left the exam page — home screen, another app, another tab or the screen locked'
      : 'Switched to another tab or minimised the browser',
    blur: phone
      ? 'A window opened over the exam — a notification, Control Centre, the app switcher, a chat bubble or split screen'
      : 'Clicked away from the browser — another app or window was in front of the exam',
    paused: phone
      ? 'The browser stopped running the exam — the screen locked, or the phone went to another app'
      : 'The browser stopped running the exam — the computer slept or the screen locked',
  }[kind] || 'Left the exam';
  return device?.label ? `${what} (${device.label})` : what;
}

/** "48 s", "3 min 5 s", "1 h 2 min". */
export function formatAway(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** A logged flag with how long the student was away added — once. */
export function withAway(entry, ms, note = '') {
  const text = String(entry ?? '');
  if (/ — away \d/.test(text) || !(ms >= 1000)) return text;
  return `${text} — away ${formatAway(ms)}${note ? ` (${note})` : ''}`;
}

/**
 * A leave that ended on the check-in screen (sql/115). The student was back
 * the moment they asked to enter again; the wait for the instructor to let
 * them in is not time away, so it is reported beside it, not inside it.
 * `admission` is { askedAt, letInAt } from the waiting screen. Returns
 * { ms, note } for withAway, or null when there is nothing to split — no
 * check-in, or a leave that began after they asked.
 */
export function awayUntilCheckIn(leftAt, admission) {
  const asked = admission?.askedAt;
  if (!Number.isFinite(leftAt) || !Number.isFinite(asked) || asked <= leftAt) return null;
  const waited = Math.max(0, (Number.isFinite(admission.letInAt) ? admission.letInAt : asked) - asked);
  return {
    ms: Math.max(1000, asked - leftAt),
    note: `the page was reloaded on return; then waited ${waited >= 1000 ? formatAway(waited) : 'under a second'} to be let in`,
  };
}

/**
 * Send the count and the log straight to the live session, in a request the
 * browser finishes even if the page is frozen or closed a moment later
 * (keepalive). The debounced push in ExamBoard only runs once the page is
 * running again — on iOS, that can be never, if Safari throws the page away
 * while the student is in another app.
 */
export function pushViolationsNow({ url, key, sessionId, count, logs, fetchFn = globalThis.fetch }) {
  if (!url || !key || !sessionId || typeof fetchFn !== 'function') return false;
  try {
    fetchFn(`${url}/rest/v1/live_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      keepalive: true,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ violation_count: count, violation_log: logs, updated_at: new Date().toISOString() }),
    }).catch(() => { /* the debounced push tries again */ });
    return true;
  } catch {
    return false;
  }
}
