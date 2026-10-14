-- =====================================================================
-- 062 — re-mark under 061's rules, 6 at a time (raise-only)
--
-- Run in the Supabase SQL editor (runs as postgres) AFTER sql/061.
-- RUN IT AGAIN until both counts in the result are 0. Graded results
-- (quizzes) go first, then practice attempts (assignments).
--
-- Every practice attempt (review_attempts) and graded result on a paper
-- with a full-solution item, last marked before 061 went live, is marked
-- again — 6 per run: a sitting takes a few seconds to mark, and the SQL
-- editor gives up after about a minute. RAISE-ONLY: if any one would go down, that run changes nothing
-- and says which. Anything an instructor marked by hand is skipped and
-- not counted as left.
-- =====================================================================

BEGIN;

DO $$
DECLARE r record; v_new numeric; n_done int := 0; n_up int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'remark_061_since') THEN
    RAISE EXCEPTION 'Run sql/061 first.';
  END IF;
  FOR r IN
    SELECT * FROM (
      SELECT 2 AS pass, ra.student_id, ra.assessment_id, ra.attempt_no, coalesce(ra.work_marks, 0) AS old
      FROM public.review_attempts ra
      JOIN public.assessments a ON a.id = ra.assessment_id AND a.allow_retakes
      WHERE coalesce(ra.work_marked_at, '-infinity') < public.remark_061_since()
        AND EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = a.id AND q.work_rubric ->> 'mode' = 'lines')
        AND NOT EXISTS (SELECT 1 FROM jsonb_each(coalesce(ra.answers_json, '{}'::jsonb)) e
                        WHERE jsonb_typeof(e.value) = 'object' AND e.value ->> 'reason' LIKE 'Marked by instructor%')
      UNION ALL
      SELECT 1, res.student_id, a.id, NULL::int, coalesce(res.work_marks, 0)
      FROM public.results res
      JOIN public.assessments a ON a.id = coalesce(res.assessment_id, res.exam_id) AND NOT a.allow_retakes
      WHERE coalesce(res.work_marked_at, '-infinity') < public.remark_061_since()
        AND EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = a.id AND q.work_rubric ->> 'mode' = 'lines')
        AND NOT EXISTS (SELECT 1 FROM jsonb_each(coalesce(res.answers_json, '{}'::jsonb)) e
                        WHERE jsonb_typeof(e.value) = 'object' AND e.value ->> 'reason' LIKE 'Marked by instructor%')
    ) todo
    ORDER BY pass
    LIMIT 6
  LOOP
    v_new := (public.score_worked_answers(r.student_id, r.assessment_id, r.attempt_no) ->> 'work_marks')::numeric;
    IF v_new < r.old THEN
      RAISE EXCEPTION 'Would go DOWN from % to % (student %, attempt %). Nothing in this run was changed.',
        r.old, v_new, r.student_id, coalesce(r.attempt_no::text, 'graded');
    END IF;
    n_done := n_done + 1;
    IF v_new > r.old THEN n_up := n_up + 1; END IF;
  END LOOP;
  RAISE NOTICE '% re-marked in this run, % went up.', n_done, n_up;
END $$;

COMMIT;

-- =====================================================================
-- VERIFY — one row. Run this file again until both are 0.
-- =====================================================================
SELECT
  (SELECT count(*) FROM public.results res
   JOIN public.assessments a ON a.id = coalesce(res.assessment_id, res.exam_id) AND NOT a.allow_retakes
   WHERE coalesce(res.work_marked_at, '-infinity') < public.remark_061_since()
     AND EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = a.id AND q.work_rubric ->> 'mode' = 'lines')
     AND NOT EXISTS (SELECT 1 FROM jsonb_each(coalesce(res.answers_json, '{}'::jsonb)) e
                     WHERE jsonb_typeof(e.value) = 'object' AND e.value ->> 'reason' LIKE 'Marked by instructor%'))
  AS graded_left,
  (SELECT count(*) FROM public.review_attempts ra
   JOIN public.assessments a ON a.id = ra.assessment_id AND a.allow_retakes
   WHERE coalesce(ra.work_marked_at, '-infinity') < public.remark_061_since()
     AND EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = a.id AND q.work_rubric ->> 'mode' = 'lines')
     AND NOT EXISTS (SELECT 1 FROM jsonb_each(coalesce(ra.answers_json, '{}'::jsonb)) e
                     WHERE jsonb_typeof(e.value) = 'object' AND e.value ->> 'reason' LIKE 'Marked by instructor%'))
  AS practice_left;
