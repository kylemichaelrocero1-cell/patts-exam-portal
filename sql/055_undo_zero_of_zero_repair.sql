-- =====================================================================
-- 055 — undo the "0/0 repair" on papers made only of typed (worked) items
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- The dashboard's old "re-score 0/0 results" tool took every result whose
-- picked-item count (total_items) is 0 for a broken row. On a paper made
-- only of typed items that 0 is right — the marks live in work_marks /
-- work_total — and the tool:
--   * set total_items to the number of typed items, so where a row has no
--     points_total the score shows out of too many (30 / 41 for 30 / 30);
--   * overwrote time_taken_seconds with the whole time limit.
-- Nothing else on the row was touched (the score, the marks, the answers).
--
-- This puts total_items back to 0 on those rows, and rebuilds the time
-- taken from the sitting: submitted_at − the live session's start, never
-- more than the time limit. Only rows on a paper with typed items and NO
-- picked items, whose total_items is not 0, are touched.
-- =====================================================================

BEGIN;

WITH typed_only AS (
  SELECT a.id, a.duration_minutes
  FROM public.assessments a
  WHERE EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = a.id
                AND q.question_type = 'worked_solution')
    AND NOT EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = a.id
                    AND coalesce(q.question_type, 'multiple_choice') NOT IN ('worked_solution', 'essay'))
),
hit AS (
  SELECT r.id, t.duration_minutes,
         (SELECT ls.created_at FROM public.live_sessions ls
          WHERE ls.student_id = r.student_id AND ls.exam_id = r.exam_id
            AND ls.created_at <= r.submitted_at
          ORDER BY ls.created_at DESC LIMIT 1) AS started_at,
         r.submitted_at
  FROM public.results r
  JOIN typed_only t ON t.id = coalesce(r.assessment_id, r.exam_id)
  WHERE r.total_items <> 0
)
UPDATE public.results r
   SET total_items = 0,
       time_taken_seconds = CASE
         WHEN h.started_at IS NULL THEN r.time_taken_seconds
         ELSE least(greatest(floor(extract(epoch FROM h.submitted_at - h.started_at))::int, 0),
                    coalesce(h.duration_minutes, 0) * 60)
       END
  FROM hit h
 WHERE r.id = h.id;

COMMIT;

-- =====================================================================
-- VERIFY — one row per typed-only paper with results:
-- rows_wrong should be 0 everywhere.
-- =====================================================================
SELECT a.title,
       count(*)                                        AS results,
       count(*) FILTER (WHERE r.total_items <> 0)      AS rows_wrong,
       round(avg(r.time_taken_seconds) / 60.0, 1)      AS avg_minutes_taken,
       a.duration_minutes                              AS time_limit
FROM public.results r
JOIN public.assessments a ON a.id = coalesce(r.assessment_id, r.exam_id)
WHERE EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = a.id AND q.question_type = 'worked_solution')
  AND NOT EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = a.id
                  AND coalesce(q.question_type, 'multiple_choice') NOT IN ('worked_solution', 'essay'))
GROUP BY a.title, a.duration_minutes
ORDER BY a.title;
