-- =====================================================================
-- 083 — a paper is filed before it is marked, so a slow marking can never
--       turn a submission away
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 039. No frontend change depends on it: run it whenever.
--
-- submit_assessment() files the paper, files its working (039) and marks
-- the working (027), all inside one request — and the anon role's requests
-- are stopped after 20 s (054). Marking a full-solution paper whose items
-- accept long lists of forms takes seconds, and when a class's clock runs
-- out together their submissions are marked at the same time on the same
-- database: measured on 2026-10-20, ten half-right MATH 117 Quiz 2 sittings
-- at once took 25-31 s each. Past 20 s the request is cancelled, and 039's
-- "never at the cost of the submission" did not hold: the cancel is
-- query_canceled, which WHEN others does not catch, so it took the whole
-- submission with it — nothing filed, and the student told their exam
-- could not be saved.
--
-- Now the working is filed in a block of its own, and the marking runs in
-- another that catches query_canceled by name. A marking that runs out of
-- time is rolled back on its own; the paper and its working stay filed, with
-- the marks pending (no work_total), exactly as a refused marking always
-- was: the student's browser asks save_worked_answers() to mark it again,
-- and the dashboard's Recover working finds it.
--
-- Nothing else changes: what is marked, how, and what is returned.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'submit_assessment'
                   AND p.prosrc LIKE '%score_worked_answers%') THEN
    RAISE EXCEPTION 'Run sql/039 first.';
  END IF;
END $$;

-- 039's submit_assessment(), with the working filed and the marking run in
-- separate blocks.
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
    EXCEPTION WHEN others THEN
      -- Never at the cost of the submission. The row stands as 025 filed it,
      -- and the dashboard's Recover working finds it (no work_total).
      RAISE WARNING 'submit_assessment: working not filed for % on %: %',
        p_student_id, p_assessment_id, SQLERRM;
      v_patch := NULL;
    END;

    -- 083: marked in a block of its own, AFTER the working is filed, so a
    -- marking that runs out of time leaves the paper and its working on file
    -- with the marks pending — never the submission refused. A statement
    -- timeout is query_canceled, which WHEN others does not catch: it is
    -- named here on purpose.
    BEGIN
      -- Marked even when nothing was written: a blank item is a real 0, and
      -- this is what records the marks available, so the paper reads out of
      -- its full total rather than the picked items alone.
      v_scored := public.score_worked_answers(p_student_id, p_assessment_id,
                                              CASE WHEN retakes THEN n END);
    EXCEPTION
      WHEN query_canceled THEN
        RAISE WARNING 'submit_assessment: marking ran out of time for % on %; filed, marks pending',
          p_student_id, p_assessment_id;
        v_scored := NULL;
      WHEN others THEN
        RAISE WARNING 'submit_assessment: working not marked for % on %: %',
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
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  position('WHEN query_canceled' IN p.prosrc) > 0 AS a_timeout_leaves_the_paper_filed,
  position('score_worked_answers' IN p.prosrc) > 0 AS still_marks_the_working,
  position('v_patch := NULL' IN p.prosrc) > 0 AS working_filed_on_its_own,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS students_can_still_submit
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'submit_assessment';
