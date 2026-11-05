// What the Results tab ranks and averages on.
//
// The Score column has shown combinedScore() since worked items arrived —
// picked-item points plus worked marks, 18/67 — but the sort, the quick stats,
// the distribution and the home Pass Rate tile all still read
// score / total_items, a COUNT of the picked items alone. On MATH 117 RETAKE
// (9 picked items, 58 worked marks) that made a 9/9 + 11/58 paper rank and
// average as 100%, so "Highest first" put 20/67 above 60/67 and the class
// mean read 77.8%.
//
// No supabase import, so it can be tested in Node.

import { combinedScore, PASS_MARK } from './workedShape.js';

export { PASS_MARK };

/**
 * The fraction a row's shown percentage stands for, 0..1, unrounded and on
 * the paper's grade base. null while worked marks are still pending
 * (combinedScore() withholds the percentage for the same reason) and for a
 * paper worth nothing at all.
 */
export function scoreFraction(row) {
  const { exact } = combinedScore(row);
  return exact === null ? null : exact / 100;
}

/**
 * Sort comparator on the shown score. Rows with no fraction yet — waiting on
 * worked marks — go last whichever way the list is sorted: they are neither
 * high nor low until somebody marks them.
 */
export function compareByScore(a, b, direction = 'desc') {
  const fa = scoreFraction(a), fb = scoreFraction(b);
  if (fa === null || fb === null) return (fa === null) - (fb === null);
  return direction === 'asc' ? fa - fb : fb - fa;
}

/**
 * Sort comparator on when the paper was handed in: 'asc' puts the first to
 * submit on top, 'desc' the last. A row with no time goes last either way.
 */
export function compareBySubmitted(a, b, direction = 'asc') {
  const at = r => { const t = Date.parse(r.submitted_at); return Number.isNaN(t) ? null : t; };
  const ta = at(a), tb = at(b);
  if (ta === null || tb === null) return (ta === null) - (tb === null);
  return direction === 'asc' ? ta - tb : tb - ta;
}

export const SCORE_BRACKETS = [
  { label: '0–49%', min: 0, max: 49, color: '#E74C3C' },
  { label: '50–59%', min: 50, max: 59, color: '#E67E22' },
  { label: '60–69%', min: 60, max: 69, color: '#F39C12' },
  { label: '70–74%', min: 70, max: 74, color: '#F1C40F' },
  { label: '75–79%', min: 75, max: 79, color: '#2ECC71' },
  { label: '80–89%', min: 80, max: 89, color: '#27AE60' },
  { label: '90–100%', min: 90, max: 100, color: '#1A8A4A' },
];

/**
 * Mean, median, pass rate and distribution over the rows that have a score.
 * `pending` counts the rows left out because their marks are not in yet.
 * null when no row has a score.
 */
export function resultStatistics(rows) {
  const pcts = [];
  let pending = 0;
  for (const r of rows) {
    const m = combinedScore(r);
    if (m.exact === null) { if (m.pending > 0) pending++; }
    else pcts.push(m.exact);
  }
  const n = pcts.length;
  if (n === 0) return null;
  const sorted = [...pcts].sort((a, b) => a - b);
  const mean = pcts.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const stdDev = Math.sqrt(pcts.reduce((acc, p) => acc + (p - mean) ** 2, 0) / n);
  // Bracketed on the whole percent below. The brackets are whole-number
  // ranges, and a points total like 67 gives 33/67 = 49.25%, which a plain
  // min/max test drops between 0–49 and 50–59 — off the chart entirely.
  const distribution = SCORE_BRACKETS.map(b => ({
    ...b,
    count: pcts.filter(p => Math.floor(p) >= b.min && Math.floor(p) <= b.max).length,
  }));
  return {
    n, pending, mean, median, stdDev,
    highest: sorted[n - 1], lowest: sorted[0],
    passRate: (pcts.filter(p => p >= PASS_MARK).length / n) * 100,
    distribution,
  };
}
