-- =====================================================================
-- 102 — re-mark under 101's rule (a factor of one is nothing), raise-only
--
-- Run in the Supabase SQL editor (runs as postgres) AFTER sql/101, and only
-- if 101's VERIFY row counted sittings with a (1) in them. RUN IT AGAIN
-- until both counts in the result are 0 — each run re-marks for about 35
-- seconds (the editor gives up after about a minute). Graded results go
-- first, then practice attempts. Not while a paper is being sat.
--
-- Only sittings whose answers hold a (1) are marked again, through
-- score_worked_answers(), as a submission is marked. RAISE-ONLY, item by
-- item: an item the re-mark would lower keeps the mark it had — an older
-- paper may hold marks today's rules would not give (the dashboard's own
-- check credited them, or a rule since changed), and a re-mark never takes
-- a mark away — while every other item that rises, rises. Anything an
-- instructor marked by hand is skipped and not counted as left.
-- =====================================================================

BEGIN;

DO $$
DECLARE r record; v_new jsonb; v_total numeric; k text; v_kept int;
        v_start timestamptz := clock_timestamp(); n_done int := 0; n_up int := 0; n_kept int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'remark_101_since') THEN
    RAISE EXCEPTION 'Run sql/101 first.';
  END IF;
  FOR r IN
    SELECT * FROM (
      SELECT 1 AS pass, res.student_id, a.id AS assessment_id, NULL::int AS attempt_no,
             res.answers_json, coalesce(res.work_marks, 0) AS old
      FROM public.results res
      JOIN public.assessments a ON a.id = res.assessment_id AND NOT a.allow_retakes
      WHERE coalesce(res.work_marked_at, '-infinity') < public.remark_101_since()
        AND res.answers_json::text ~ '\\+left\(1\\+right\)|[^a-z]\(1\)'
        AND EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = a.id AND q.work_rubric IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM jsonb_each(coalesce(res.answers_json, '{}'::jsonb)) e
                        WHERE jsonb_typeof(e.value) = 'object' AND e.value ->> 'reason' LIKE 'Marked by instructor%')
      UNION ALL
      SELECT 2, ra.student_id, ra.assessment_id, ra.attempt_no, ra.answers_json, coalesce(ra.work_marks, 0)
      FROM public.review_attempts ra
      JOIN public.assessments a ON a.id = ra.assessment_id AND a.allow_retakes
      WHERE coalesce(ra.work_marked_at, '-infinity') < public.remark_101_since()
        AND ra.answers_json::text ~ '\\+left\(1\\+right\)|[^a-z]\(1\)'
        AND EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = a.id AND q.work_rubric IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM jsonb_each(coalesce(ra.answers_json, '{}'::jsonb)) e
                        WHERE jsonb_typeof(e.value) = 'object' AND e.value ->> 'reason' LIKE 'Marked by instructor%')
    ) todo
    ORDER BY pass, assessment_id, student_id, attempt_no
  LOOP
    EXIT WHEN clock_timestamp() - v_start > interval '35 seconds';
    PERFORM public.score_worked_answers(r.student_id, r.assessment_id, r.attempt_no);
    IF r.attempt_no IS NULL THEN
      SELECT answers_json, coalesce(work_marks, 0) INTO v_new, v_total FROM public.results
      WHERE student_id = r.student_id AND assessment_id = r.assessment_id;
    ELSE
      SELECT answers_json, coalesce(work_marks, 0) INTO v_new, v_total FROM public.review_attempts
      WHERE student_id = r.student_id AND assessment_id = r.assessment_id AND attempt_no = r.attempt_no;
    END IF;
    -- An item the re-mark would lower keeps what it had.
    v_kept := 0;
    FOR k IN SELECT jsonb_object_keys(coalesce(r.answers_json, '{}'::jsonb)) LOOP
      CONTINUE WHEN jsonb_typeof(r.answers_json -> k) <> 'object' OR NOT (r.answers_json -> k ? 'marks');
      IF coalesce((v_new -> k ->> 'marks')::numeric, 0) < (r.answers_json -> k ->> 'marks')::numeric THEN
        v_total := v_total + (r.answers_json -> k ->> 'marks')::numeric - coalesce((v_new -> k ->> 'marks')::numeric, 0);
        v_new := jsonb_set(v_new, ARRAY[k], r.answers_json -> k);
        v_kept := v_kept + 1;
      END IF;
    END LOOP;
    IF v_kept > 0 THEN
      n_kept := n_kept + v_kept;
      IF r.attempt_no IS NULL THEN
        UPDATE public.results SET answers_json = v_new, work_marks = v_total
        WHERE student_id = r.student_id AND assessment_id = r.assessment_id;
      ELSE
        UPDATE public.review_attempts SET answers_json = v_new, work_marks = v_total
        WHERE student_id = r.student_id AND assessment_id = r.assessment_id AND attempt_no = r.attempt_no;
      END IF;
    END IF;
    IF v_total < r.old THEN
      RAISE EXCEPTION 'Would go DOWN from % to % (student %, attempt %). Nothing in this run was changed.',
        r.old, v_total, r.student_id, coalesce(r.attempt_no::text, 'graded');
    END IF;
    n_done := n_done + 1;
    IF v_total > r.old THEN n_up := n_up + 1; END IF;
  END LOOP;
  RAISE NOTICE '% re-marked in this run, % went up, % items kept a mark the re-mark would have lowered.', n_done, n_up, n_kept;
END $$;

COMMIT;

-- =====================================================================
-- VERIFY — one row. Run this file again until both are 0.
-- =====================================================================
SELECT
  (SELECT count(*) FROM public.results res
   JOIN public.assessments a ON a.id = res.assessment_id AND NOT a.allow_retakes
   WHERE coalesce(res.work_marked_at, '-infinity') < public.remark_101_since()
     AND res.answers_json::text ~ '\\+left\(1\\+right\)|[^a-z]\(1\)'
     AND EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = a.id AND q.work_rubric IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM jsonb_each(coalesce(res.answers_json, '{}'::jsonb)) e
                     WHERE jsonb_typeof(e.value) = 'object' AND e.value ->> 'reason' LIKE 'Marked by instructor%'))
  AS graded_left,
  (SELECT count(*) FROM public.review_attempts ra
   JOIN public.assessments a ON a.id = ra.assessment_id AND a.allow_retakes
   WHERE coalesce(ra.work_marked_at, '-infinity') < public.remark_101_since()
     AND ra.answers_json::text ~ '\\+left\(1\\+right\)|[^a-z]\(1\)'
     AND EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = a.id AND q.work_rubric IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM jsonb_each(coalesce(ra.answers_json, '{}'::jsonb)) e
                     WHERE jsonb_typeof(e.value) = 'object' AND e.value ->> 'reason' LIKE 'Marked by instructor%'))
  AS practice_left;
