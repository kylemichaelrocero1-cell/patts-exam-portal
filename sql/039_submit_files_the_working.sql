-- =====================================================================
-- 039 — handing a paper in files its working, in the same call
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- No frontend change depends on it: run it whenever, before or after the
-- matching deploy.
--
-- THE BUG THIS FIXES
-- A paper with worked items was handed in by TWO calls:
--     submit_assessment()    the picked items — no session token asked
--     save_worked_answers()  the working      — session token required (026)
-- So the working could be refused on its own while the picked items went
-- through. On 2026-09-30 it was: Pelaez's account was signed in somewhere
-- else mid-paper, the clone guard (one check a minute) had not caught up, and
-- his MATH 117 RETAKE was filed as 3/9 — picked items only, no work_total, so
-- not even a "to mark" flag on a paper worth 67. His working was sitting in
-- live_sessions.work_answers_json the whole time.
--
-- And the instructor's Force Submit, and the automatic sweep of timed-out
-- practice sittings, never made the second call at all: every sitting they
-- filed on a worked paper went in without its working.
--
-- THE FIX
-- submit_assessment() now files the working itself, from the live session
-- the exam board has been writing every two seconds throughout the sitting,
-- and marks it with score_worked_answers() (027). One call, no second
-- identity check to fail, and every path that hands a paper in — the
-- student's button, the clock, Force Submit, the sweep — gets it.
--
-- save_worked_answers() is unchanged, and the student's own browser still
-- calls it straight after with its in-memory copy, which is the freshest
-- there is. When that succeeds it simply re-marks the same working; when it
-- is refused, what submit filed stands.
--
-- WHAT IS NOT CHANGED
--   * The picked items are marked and filed exactly as in 025.
--   * A paper already on file is not touched: the working is filed only when
--     THIS call wrote the row, so a repeated submit never overwrites marks.
--   * Filing the working can never stop the paper being handed in. Any error
--     in it is caught and the submission goes through as it did before.
--   * No new trust: submit_assessment() has never asked who is calling, and
--     live_sessions was already the source Force Submit filed answers from.
--
-- REHEARSE IT FIRST
--   1. Change  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file and read the VERIFY output.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'score_worked_answers') THEN
    RAISE EXCEPTION 'score_worked_answers() not found — run sql/027 first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='live_sessions'
                   AND column_name='work_answers_json') THEN
    RAISE EXCEPTION 'live_sessions.work_answers_json not found — run sql/024 first.';
  END IF;
END $$;

-- Same signature as 025, so every caller — including a browser still holding
-- an older page — reaches this body.
CREATE OR REPLACE FUNCTION public.submit_assessment(
  p_student_id         uuid,
  p_assessment_id      uuid,
  p_answers            jsonb,
  p_time_taken_seconds integer DEFAULT NULL,
  p_tab_switches       integer DEFAULT 0,
  p_violation_logs     jsonb   DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE s int; t int; a jsonb; pe numeric; pt numeric; n int;
        retakes boolean; reveal boolean;
        v_filed int := 0; v_work jsonb; v_patch jsonb; v_scored jsonb;
BEGIN
  SELECT allow_retakes, show_answers INTO retakes, reveal
  FROM public.assessments WHERE id = p_assessment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown assessment'; END IF;

  SELECT score, total_items, answers_json, points_earned, points_total
    INTO s, t, a, pe, pt
  FROM public.score_answers(p_assessment_id, p_answers);

  IF retakes THEN
    SELECT coalesce(max(attempt_no),0)+1 INTO n FROM public.review_attempts
    WHERE student_id = p_student_id AND assessment_id = p_assessment_id;

    INSERT INTO public.review_attempts
      (student_id, assessment_id, attempt_no, score, total_items, answers_json,
       time_taken_seconds, points_earned, points_total)
    VALUES (p_student_id, p_assessment_id, n, s, t, a,
            p_time_taken_seconds, pe, pt);
    GET DIAGNOSTICS v_filed = ROW_COUNT;
  ELSE
    n := 1;
    INSERT INTO public.results
      (student_id, exam_id, assessment_id, score, total_items, answers_json,
       time_taken_seconds, tab_switches, violation_logs, submitted_at,
       points_earned, points_total)
    VALUES (p_student_id, p_assessment_id, p_assessment_id, s, t, a,
            p_time_taken_seconds, coalesce(p_tab_switches,0),
            coalesce(p_violation_logs,'[]'::jsonb), now(), pe, pt)
    ON CONFLICT ON CONSTRAINT results_student_exam_key DO NOTHING;
    GET DIAGNOSTICS v_filed = ROW_COUNT;
  END IF;

  -- The working, from the live session (one row per student per paper).
  -- Only for a row this call wrote, and only on a paper with worked items.
  IF v_filed > 0 AND EXISTS (
       SELECT 1 FROM public.questions q
       WHERE q.exam_id = p_assessment_id
         AND coalesce(q.question_type,'multiple_choice') = 'worked_solution') THEN
    BEGIN
      SELECT ls.work_answers_json INTO v_work
      FROM public.live_sessions ls
      WHERE ls.student_id = p_student_id AND ls.exam_id = p_assessment_id
      LIMIT 1;

      -- Exactly the shape save_worked_answers() stores: this paper's worked
      -- items only, blank lines dropped, marks left for the marker.
      SELECT jsonb_object_agg(k, jsonb_build_object('type','worked','lines',lines,'marks',NULL))
        INTO v_patch
      FROM (
        SELECT e.key AS k,
               (SELECT jsonb_agg(l) FROM jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(e.value -> 'lines') = 'array'
                       THEN e.value -> 'lines' ELSE '[]'::jsonb END) AS l
                 WHERE btrim(l) <> '') AS lines
        FROM jsonb_each(CASE WHEN jsonb_typeof(v_work) = 'object'
                             THEN v_work ELSE '{}'::jsonb END) AS e
        WHERE EXISTS (SELECT 1 FROM public.questions q
                      WHERE q.id::text = e.key AND q.exam_id = p_assessment_id
                        AND coalesce(q.question_type,'multiple_choice') = 'worked_solution')
      ) w
      WHERE lines IS NOT NULL;

      IF v_patch IS NOT NULL THEN
        IF retakes THEN
          UPDATE public.review_attempts ra
             SET answers_json = coalesce(ra.answers_json,'{}'::jsonb) || v_patch
           WHERE ra.student_id = p_student_id AND ra.assessment_id = p_assessment_id
             AND ra.attempt_no = n;
        ELSE
          UPDATE public.results r
             SET answers_json = coalesce(r.answers_json,'{}'::jsonb) || v_patch
           WHERE r.student_id = p_student_id AND r.assessment_id = p_assessment_id;
        END IF;
      END IF;

      -- Marked even when nothing was written: a blank item is a real 0, and
      -- this is what records the marks available, so the paper reads out of
      -- its full total rather than the picked items alone.
      v_scored := public.score_worked_answers(p_student_id, p_assessment_id,
                                              CASE WHEN retakes THEN n END);
    EXCEPTION WHEN others THEN
      -- Never at the cost of the submission. The row stands as 025 filed it,
      -- and the dashboard's Recover working finds it (no work_total).
      RAISE WARNING 'submit_assessment: working not filed for % on %: %',
        p_student_id, p_assessment_id, SQLERRM;
      v_scored := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'score', s, 'total_items', t, 'attempt_no', n, 'can_review', reveal,
    'points_earned', pe, 'points_total', pt,
    'work_marks', v_scored -> 'work_marks', 'work_total', v_scored -> 'work_total'
  );
END $$;

REVOKE ALL ON FUNCTION public.submit_assessment(uuid,uuid,jsonb,integer,integer,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_assessment(uuid,uuid,jsonb,integer,integer,jsonb) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. The live function files the working (look for live_sessions and
--    score_worked_answers in the body).
SELECT position('score_worked_answers' IN prosrc) > 0 AS files_working,
       position('live_sessions' IN prosrc) > 0       AS reads_live_session
FROM pg_proc WHERE proname = 'submit_assessment' AND pronamespace = 'public'::regnamespace;
-- both true

-- 2. Graded sittings on worked papers still missing their working (the
--    dashboard's "Recover working" banner clears these; after this migration
--    no new ones should appear).
SELECT r.exam_id, count(*) AS missing
FROM public.results r
WHERE r.work_total IS NULL
  AND EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = r.exam_id
              AND q.question_type = 'worked_solution')
GROUP BY r.exam_id;
