// The student's home tabs — Summary, Seatwork, Exams — are different views of
// the same few rows: the open papers, this student's results and practice
// attempts, the sittings they have under way, the lessons they have finished.
// Each tab used to fetch its own copy every time it was opened, and every
// tab switch remounts the tab, so a student going in and out of papers read
// all of it again on every click — about a third of the project's log lines
// in a quiet hour. The tabs share one copy here instead.
//
// A copy is good until the first of:
//   - HOME_MAX_AGE_MS passes, which catches what the student cannot see
//     change (an instructor switching retakes on, a force submit);
//   - the student comes back from a paper or logs out — App calls forget(),
//     because what they just sat must show;
//   - the exam list hears a paper open or appear, and asks with fresh: true,
//     as it always has.
// A read that failed is never kept, so the next tab to open asks again.
//
// No supabase import, so it can be tested in Node: the caller passes the
// reads in.

export const HOME_MAX_AGE_MS = 60 * 1000;

export const HOME_RESULT_COLUMNS =
  'exam_id, score, total_items, points_earned, points_total, work_marks, work_total, submitted_at';
export const HOME_ATTEMPT_COLUMNS =
  'assessment_id, attempt_no, score, total_items, points_earned, points_total, work_marks, work_total, submitted_at';
export const HOME_LIVE_COLUMNS = 'exam_id, exam_set, answers_count, status, created_at';

/**
 * from(table)             — a PostgREST query builder for that table.
 * selectOpenAssessments() — a promise of the open papers; may throw.
 * Every read resolves to { data, error } and never rejects.
 */
export function makeHomeReads({ from, selectOpenAssessments, now = Date.now, maxAgeMs = HOME_MAX_AGE_MS }) {
  const copies = new Map();   // key -> { at, promise }
  const claimed = new Set();

  const remember = (key, read, fresh) => {
    const had = copies.get(key);
    if (!fresh && had && now() - had.at < maxAgeMs) return had.promise;
    // Through a real promise, never the builder itself: a PostgREST builder
    // sends its request again every time .then is called on it, so handing
    // the builder to two tabs would have been two requests after all.
    const promise = Promise.resolve()
      .then(read)
      .then(r => r, error => ({ data: null, error }));
    const entry = { at: now(), promise };
    copies.set(key, entry);
    promise.then(r => { if (r?.error && copies.get(key) === entry) copies.delete(key); });
    return promise;
  };

  return {
    openAssessments: ({ fresh = false } = {}) =>
      remember('open-assessments', async () => ({ data: await selectOpenAssessments(), error: null }), fresh),

    results: (studentId, { fresh = false } = {}) =>
      remember(`results:${studentId}`, () =>
        from('results').select(HOME_RESULT_COLUMNS).eq('student_id', studentId), fresh),

    // Newest first: the exam list shows the latest attempt at the top.
    attempts: (studentId, { fresh = false } = {}) =>
      remember(`attempts:${studentId}`, () =>
        from('review_attempts').select(HOME_ATTEMPT_COLUMNS)
          .eq('student_id', studentId)
          .order('attempt_no', { ascending: false }), fresh),

    liveSittings: (studentId, { fresh = false } = {}) =>
      remember(`live:${studentId}`, () =>
        from('live_sessions').select(HOME_LIVE_COLUMNS)
          .eq('student_id', studentId)
          .in('status', ['active', 'locked']), fresh),

    lessons: ({ fresh = false } = {}) =>
      remember('lessons', () =>
        from('lessons').select('id, title, target_section, is_published').eq('is_published', true), fresh),

    lessonProgress: (studentId, { fresh = false } = {}) =>
      remember(`lesson-progress:${studentId}`, () =>
        from('lesson_progress').select('lesson_id, completed_at').eq('student_id', studentId), fresh),

    // True the first time it is asked for `key`, false after that until the
    // next forget(). For work that belongs to arriving on the home screen —
    // not to every tab switch once there.
    claim: (key) => {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },

    // Everything, or the one copy under `key`.
    forget: (key) => {
      if (key === undefined) { copies.clear(); claimed.clear(); }
      else copies.delete(key);
    },
  };
}
