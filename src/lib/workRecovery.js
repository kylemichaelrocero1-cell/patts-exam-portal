// Working that was typed but never reached the result.
//
// A student's worked answers are saved by save_worked_answers(), which proves
// the session token first. submit_assessment() does not take a token at all.
// So when a student's account is signed in somewhere else mid-paper, the
// picked items are submitted and marked, the working is refused with "Your
// session has expired", and the result reads 3/9 on a paper worth 67 — with
// no "to mark" flag, because work_total was never written. The working is not
// lost: the exam board keeps live_sessions.work_answers_json up to date the
// whole time (it is how a sitting resumes), and an instructor may write it
// into the result and call score_worked_answers(), which marks it exactly as
// the student's own call would have.
//
// No supabase import, so it can be tested in Node.

import { isWorkedSolution, linesOf } from './workedShape.js';

/**
 * Result rows whose worked half is missing: no work_total, on a paper where
 * another sitting has one — which is how it is known the paper has worked
 * items without fetching every paper's questions.
 */
export function rowsMissingWork(rows) {
  const worked = new Set(rows.filter(r => Number(r.work_total) > 0).map(r => r.exam_id));
  return rows.filter(r => worked.has(r.exam_id)
    && (r.work_total === null || r.work_total === undefined));
}

/**
 * What save_worked_answers() would have merged into answers_json, built from
 * the live session's copy: worked items of this paper only, blank lines
 * dropped, items with nothing written left out, marks left for the marker.
 */
export function workPatchFrom(workAnswersJson, questions) {
  const worked = new Set((questions || []).filter(isWorkedSolution).map(q => String(q.id)));
  const patch = {};
  for (const [id, value] of Object.entries(workAnswersJson || {})) {
    if (!worked.has(String(id))) continue;
    const lines = linesOf(value).map(l => l.trim()).filter(Boolean);
    if (lines.length) patch[String(id)] = { type: 'worked', lines, marks: null };
  }
  return patch;
}
