// Letting students in from the live monitor (sql/115).
//
// A paper with requires_admission on hands its questions only to an ENTRY
// the instructor has allowed. An entry is one opening of the paper in one
// page: the id below is made fresh each time the waiting screen opens and
// lives only in that page's memory, so a reload, a second login or another
// phone is a new entry and waits again. The server decides; this file only
// names the states the waiting screen shows and the rules the monitor uses.

/** A fresh entry id. crypto.randomUUID needs a secure context; the fallback is for old phones. */
export function newEntryId(rand = () => Math.random()) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const h = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16));
  h[12] = '4';
  h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** How often the waiting screen asks where it stands. */
export const ADMISSION_POLL_MS = 3000;

/**
 * A waiting request still has a student behind it while their screen keeps
 * asking (it refreshes seen_at every 15 s at most); one not heard from in
 * this long is a closed tab and leaves the monitor.
 */
export const WAITING_STALE_MS = 45000;

export function isWaitingNow(row, now = Date.now()) {
  if (!row || row.status !== 'waiting') return false;
  const seen = new Date(row.seen_at || row.requested_at || 0).getTime();
  return now - seen <= WAITING_STALE_MS;
}

/** What the waiting screen says for each answer request_admission() gives. */
export function admissionView(status) {
  switch (status) {
    case 'admitted':     return { tone: 'ok',   enter: true, title: 'Let in', text: 'Opening the paper…' };
    case 'not_required': return { tone: 'ok',   enter: true };
    case 'waiting':      return { tone: 'wait', title: 'Waiting for your instructor',
      text: 'Your instructor will let you in from the live monitor. Keep this screen open.' };
    case 'denied':       return { tone: 'bad',  title: 'Not let in',
      text: 'Your instructor did not let you in. If this is a mistake, talk to your instructor and ask again.', again: true };
    case 'withdrawn':    return { tone: 'bad',  title: 'Opened somewhere else',
      text: 'You asked to enter from another tab or device, so this one stopped waiting.', again: true };
    case 'expired':      return { tone: 'bad',  title: 'Your turn lapsed',
      text: 'You were let in but did not enter in time. Ask again.', again: true };
    default:             return { tone: 'wait', title: 'Waiting for your instructor',
      text: 'Checking with the server…' };
  }
}

/** "1 min 05 s" — how long someone has been waiting. */
export function waitedFor(since, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}
