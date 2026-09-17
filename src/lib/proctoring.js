// Reading the proctoring trail a sitting leaves behind.
//
// ExamBoard writes one string per incident into live_sessions.violation_log:
//
//   "[3:45:12 PM] Tab hidden or switched to another app"
//
// A clock time and a sentence, nothing else. That format is on file in every
// finished paper's results.violation_logs as well, so it is parsed rather than
// changed — the whole history would otherwise have to be migrated to show a
// feed of the last few incidents.

/** Incident sentences, longest-standing first. Order matters: first match wins. */
const TYPES = [
  { match: /screenshot|print/i,                     label: 'Screenshot / print', tone: 'bad'  },
  { match: /tab hidden|another app|tab switch/i,    label: 'Tab switch',         tone: 'bad'  },
  { match: /refresh/i,                              label: 'Page refresh',       tone: 'warn' },
  { match: /lost focus|split-?screen|notification/i,label: 'Lost focus',         tone: 'warn' },
];

/** 12-hour or 24-hour, with or without seconds — toLocaleTimeString is locale-dependent. */
const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])\.?[Mm]\.?)?/;

/**
 * Turn a clock-time string back into a moment, anchored on `now`.
 *
 * The log carries no date, so the day comes from `now`. A sitting that runs
 * across midnight would otherwise put its last incidents ~24h in the future,
 * which is what the rollback below catches.
 *
 * @returns epoch ms, or null when the string is not a clock time at all
 */
export function clockToMs(stamp, now = Date.now()) {
  const m = CLOCK.exec(String(stamp || '').trim());
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = Number(m[3] || 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const meridiem = m[4]?.toLowerCase();
  if (meridiem === 'p' && hours < 12) hours += 12;
  if (meridiem === 'a' && hours === 12) hours = 0;

  const ref = new Date(now);
  const at = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), hours, minutes, seconds, 0);
  // More than two hours ahead is a yesterday stamp read after midnight, not a
  // clock running fast.
  if (at.getTime() > now + 2 * 60 * 60 * 1000) at.setDate(at.getDate() - 1);
  return at.getTime();
}

/** Split one log line into its stamp, its sentence and the type it belongs to. */
export function parseViolation(entry, now = Date.now()) {
  const raw = String(entry ?? '');
  const close = raw.indexOf('] ');
  const stamp = raw.startsWith('[') && close >= 0 ? raw.slice(1, close) : '';
  const reason = close >= 0 ? raw.slice(close + 2) : raw;
  const type = TYPES.find(t => t.match.test(reason));
  return {
    raw,
    stamp,
    reason,
    label: type?.label || 'Flagged activity',
    tone: type?.tone || 'warn',
    at: stamp ? clockToMs(stamp, now) : null,
  };
}

/**
 * Every incident across a set of live sessions, newest first.
 *
 * A session whose stamps cannot be read still appears, ordered by when the row
 * was last written — better a row slightly out of place than a violation the
 * instructor never sees.
 *
 * @param sessions live_sessions rows, each with violation_log
 * @returns rows of { key, sessionId, studentId, studentName, examId, stamp,
 *                    reason, label, tone, at }
 */
export function violationFeed(sessions, { now = Date.now(), limit = 8 } = {}) {
  const rows = [];

  (sessions || []).forEach(session => {
    const logs = Array.isArray(session?.violation_log) ? session.violation_log : [];
    if (logs.length === 0) return;
    const touched = new Date(session.updated_at || session.created_at || 0).getTime();
    const fallback = Number.isFinite(touched) ? touched : 0;

    logs.forEach((entry, index) => {
      const v = parseViolation(entry, now);
      rows.push({
        key: `${session.id}:${index}`,
        sessionId: session.id,
        studentId: session.student_id,
        studentName: session.student_name || 'Unknown student',
        examId: session.exam_id,
        index,
        stamp: v.stamp,
        reason: v.reason,
        label: v.label,
        tone: v.tone,
        at: v.at ?? fallback,
      });
    });
  });

  // Ties fall back to log order, so two incidents logged in the same second
  // still read in the order they happened.
  rows.sort((a, b) => (b.at - a.at) || (b.index - a.index));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

/** Has this sitting got anything in it worth submitting? */
export function hasSavedWork(session) {
  return Object.keys(session?.answers_json || {}).length > 0 ||
         Object.keys(session?.essay_answers_json || {}).length > 0;
}

/**
 * May this row be dismissed?
 *
 * Dismiss takes a row off the monitor without filing anything. It was written
 * back when a locked or timed-out sitting had no other way out; force submit
 * and the auto-sweep cover that now, so the only thing left for it is a ghost:
 * a row whose paper is already on file, or one the student opened and walked
 * away from without answering anything.
 *
 * Offering it on a sitting that has answers in it is how work gets lost — the
 * student vanishes from the monitor and nothing is ever submitted for them.
 */
export function canDismissSession(session, { hasResult = false } = {}) {
  if (hasResult) return true;
  return !hasSavedWork(session);
}
