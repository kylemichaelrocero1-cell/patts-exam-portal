// When a paper was handed in, written the way an attendance sheet needs it:
// the date and the clock time in the Philippines, whatever timezone the
// computer doing the download is set to.
//
// submitted_at is stored in UTC. Written out raw, an exam handed in at
// 11:42 AM read as 03:42, and one handed in before 8 AM landed on the
// PREVIOUS day's date — the one column an attendance record cannot get wrong.

const TZ = 'Asia/Manila';

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: 'numeric', minute: '2-digit', hour12: true,
});

/**
 * { date: '2026-09-28', time: '11:42 AM' } in Philippine time, or blanks for
 * a missing or unreadable timestamp. The date is year-month-day so it sorts
 * as text and a spreadsheet reads it as a date.
 */
export function submittedDateTime(ts) {
  if (!ts) return { date: '', time: '' };
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const p = Object.fromEntries(PARTS.formatToParts(d).map(x => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    // Built from parts rather than taken whole: newer browsers put a narrow
    // no-break space before AM/PM, which some spreadsheets will not read as
    // a time.
    time: `${p.hour}:${p.minute} ${String(p.dayPeriod || '').toUpperCase()}`.trim(),
  };
}
