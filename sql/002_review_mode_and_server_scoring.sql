-- =====================================================================
-- PHASE 5a — review mode, unlimited retakes, server-side scoring
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- ADDITIVE ONLY. Nothing is dropped, no grant is revoked, and the
-- currently deployed app keeps working untouched. The revoke that
-- actually closes the answer-key hole lives in 003, which must not be
-- run until the new app is deployed — see the note at the bottom.
--
-- WHAT THIS ADDS
--   1. assessments.allow_review — unlimited retakes + answers revealed.
--   2. review_attempts — every practice take. Deliberately NOT results:
--      results is the graded record, has UNIQUE(student_id, exam_id) so
--      it physically cannot hold retakes, and practice scores must never
--      move a student's real average or the Class Review numbers.
--   3. submit_exam() / submit_review_attempt() — scoring moves to the
--      server so the answer key no longer has to be shipped to the
--      browser. Today ExamBoard.jsx fetches every correct_answer to mark
--      the paper client-side, which is why the key is currently readable
--      by anyone with the anon key.
--   4. get_attempt_review() — lets a student re-open a past attempt and
--      see which ones they got wrong.
--   5. The Pre-Boards PATTS cohort and its review material.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Review flag
-- ---------------------------------------------------------------------
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS allow_review boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.assessments.allow_review IS
  'Unlimited retakes, and correct answers revealed after submitting. Never enable on a paper still being used for marks.';

-- ---------------------------------------------------------------------
-- 2. review_attempts — practice takes, kept away from the graded record
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_attempts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES public.users(id)       ON DELETE CASCADE,
  assessment_id      uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  attempt_no         integer NOT NULL,
  score              integer NOT NULL DEFAULT 0,
  total_items        integer NOT NULL DEFAULT 0,
  answers_json       jsonb   NOT NULL DEFAULT '{}'::jsonb,
  time_taken_seconds integer,
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_attempts_no_key UNIQUE (student_id, assessment_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS review_attempts_student_idx
  ON public.review_attempts (student_id, assessment_id, submitted_at DESC);

COMMENT ON TABLE public.review_attempts IS
  'Practice retakes. Separate from results on purpose: results is the graded record and must not be moved by revision.';

-- ---------------------------------------------------------------------
-- 3. Scoring, server-side
-- ---------------------------------------------------------------------
-- Shared marker. p_answers is { "<question_id>": <chosen index 0-3> }.
-- Returns the stored answers_json shape the dashboard already renders
-- ({ chosen, is_correct }), so existing views keep working unchanged.
CREATE OR REPLACE FUNCTION public.score_answers(
  p_assessment_id uuid,
  p_answers       jsonb
) RETURNS TABLE (score int, total_items int, answers_json jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mc AS (
    SELECT q.id, q.correct_answer
    FROM public.questions q
    WHERE q.exam_id = p_assessment_id
      AND coalesce(q.question_type, 'multiple_choice') <> 'essay'
  ),
  marked AS (
    SELECT mc.id,
           (p_answers ->> mc.id::text) AS chosen_raw,
           CASE
             WHEN (p_answers ->> mc.id::text) IS NULL THEN NULL
             ELSE ((p_answers ->> mc.id::text)::int = mc.correct_answer)
           END AS is_correct
    FROM mc
  )
  SELECT
    coalesce(count(*) FILTER (WHERE is_correct), 0)::int,
    (SELECT count(*) FROM mc)::int,
    coalesce(
      jsonb_object_agg(
        id::text,
        jsonb_build_object('chosen', chosen_raw::int, 'is_correct', is_correct)
      ) FILTER (WHERE chosen_raw IS NOT NULL),
      '{}'::jsonb
    )
  FROM marked;
$$;

-- Official submission. Writes the graded record, once per student per
-- assessment, mirroring the existing UNIQUE constraint.
CREATE OR REPLACE FUNCTION public.submit_exam(
  p_student_id         uuid,
  p_assessment_id      uuid,
  p_answers            jsonb,
  p_time_taken_seconds integer DEFAULT NULL,
  p_tab_switches       integer DEFAULT 0,
  p_violation_logs     jsonb   DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE s int; t int; a jsonb;
BEGIN
  SELECT score, total_items, answers_json INTO s, t, a
  FROM public.score_answers(p_assessment_id, p_answers);

  INSERT INTO public.results
    (student_id, exam_id, assessment_id, score, total_items, answers_json,
     time_taken_seconds, tab_switches, violation_logs, submitted_at)
  VALUES
    (p_student_id, p_assessment_id, p_assessment_id, s, t, a,
     p_time_taken_seconds, coalesce(p_tab_switches, 0),
     coalesce(p_violation_logs, '[]'::jsonb), now())
  ON CONFLICT ON CONSTRAINT results_student_exam_key DO NOTHING;

  RETURN jsonb_build_object('score', s, 'total_items', t);
END $$;

-- Practice submission. Unlimited, and only where review is switched on.
CREATE OR REPLACE FUNCTION public.submit_review_attempt(
  p_student_id         uuid,
  p_assessment_id      uuid,
  p_answers            jsonb,
  p_time_taken_seconds integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE s int; t int; a jsonb; n int; new_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.assessments
    WHERE id = p_assessment_id AND allow_review
  ) THEN
    RAISE EXCEPTION 'Review is not enabled for this assessment';
  END IF;

  SELECT score, total_items, answers_json INTO s, t, a
  FROM public.score_answers(p_assessment_id, p_answers);

  SELECT coalesce(max(attempt_no), 0) + 1 INTO n
  FROM public.review_attempts
  WHERE student_id = p_student_id AND assessment_id = p_assessment_id;

  INSERT INTO public.review_attempts
    (student_id, assessment_id, attempt_no, score, total_items, answers_json, time_taken_seconds)
  VALUES (p_student_id, p_assessment_id, n, s, t, a, p_time_taken_seconds)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('attempt_id', new_id, 'attempt_no', n, 'score', s, 'total_items', t);
END $$;

-- The only route to a correct answer. Returns the key for one attempt the
-- student has already submitted, and only on a review-enabled assessment —
-- so answers can never be pulled before sitting the paper.
CREATE OR REPLACE FUNCTION public.get_attempt_review(
  p_attempt_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'question_number'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
             'question_id',     q.id,
             'question_number', q.question_number,
             'question_text',   q.question_text,
             'choices',    jsonb_build_array(q.choice_a, q.choice_b, q.choice_c, q.choice_d),
             'correct',    q.correct_answer,
             'chosen',     (ra.answers_json -> q.id::text ->> 'chosen')::int,
             'is_correct', coalesce((ra.answers_json -> q.id::text ->> 'is_correct')::boolean, false)
           ) AS x
    FROM public.review_attempts ra
    JOIN public.assessments a ON a.id = ra.assessment_id AND a.allow_review
    JOIN public.questions   q ON q.exam_id = ra.assessment_id
    WHERE ra.id = p_attempt_id
      AND coalesce(q.question_type, 'multiple_choice') <> 'essay'
  ) s;
$$;

GRANT EXECUTE ON FUNCTION public.submit_exam(uuid, uuid, jsonb, integer, integer, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_review_attempt(uuid, uuid, jsonb, integer)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_attempt_review(uuid)                                  TO anon, authenticated;
-- score_answers is an internal helper; it is never called directly by the client.
REVOKE EXECUTE ON FUNCTION public.score_answers(uuid, jsonb) FROM anon;

-- ---------------------------------------------------------------------
-- 4. RLS for review_attempts
-- ---------------------------------------------------------------------
-- Follows the existing posture: students are not in Supabase Auth, so rows
-- cannot be scoped per student. Writes go through the RPC above rather than
-- a direct INSERT grant, which is a little tighter than results.
ALTER TABLE public.review_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS review_attempts_anon_select ON public.review_attempts;
DROP POLICY IF EXISTS review_attempts_auth_all    ON public.review_attempts;

CREATE POLICY review_attempts_anon_select ON public.review_attempts
  FOR SELECT TO anon USING (true);
CREATE POLICY review_attempts_auth_all ON public.review_attempts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT ON public.review_attempts TO anon;
GRANT ALL    ON public.review_attempts TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Pre-Boards PATTS cohort
-- ---------------------------------------------------------------------
-- Appended, never replacing: keeping AENG 426 preserves every existing
-- result, grade and Class Review row for this cohort.
UPDATE public.users u
SET section = btrim(coalesce(u.section, '')) || ', Pre-Boards PATTS'
WHERE EXISTS (
        SELECT 1 FROM unnest(string_to_array(coalesce(u.section, ''), ',')) AS t(x)
        WHERE btrim(t.x) = 'AENG 426'
      )
  AND NOT EXISTS (
        SELECT 1 FROM unnest(string_to_array(coalesce(u.section, ''), ',')) AS t(x)
        WHERE btrim(t.x) = 'Pre-Boards PATTS'
      );

-- Every AENG 426 paper becomes review material, and is targeted at the new
-- section so it shows up for the cohort. is_open is set so they can reach it.
UPDATE public.assessments a
SET allow_review   = true,
    is_open        = true,
    target_section = CASE
      WHEN EXISTS (
        SELECT 1 FROM unnest(string_to_array(coalesce(a.target_section, ''), ',')) AS t(x)
        WHERE btrim(t.x) = 'Pre-Boards PATTS')
      THEN a.target_section
      ELSE btrim(coalesce(a.target_section, '')) || ', Pre-Boards PATTS'
    END
WHERE EXISTS (
  SELECT 1 FROM unnest(string_to_array(coalesce(a.target_section, ''), ',')) AS t(x)
  WHERE btrim(t.x) = 'AENG 426'
);

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================
SELECT 'cohort' AS check,
       count(*) FILTER (WHERE section LIKE '%Pre-Boards PATTS%') AS in_preboards,
       count(*) FILTER (WHERE section LIKE '%AENG 426%')         AS still_in_426
FROM public.users;

SELECT 'review material' AS check,
       count(*) FILTER (WHERE allow_review) AS review_enabled,
       count(*) FILTER (WHERE allow_review AND is_open) AS reachable
FROM public.assessments;

-- Scoring sanity: mark a real paper with an empty answer set. score must be
-- 0 and total_items must equal its multiple-choice question count.
SELECT 'scorer' AS check, s.score, s.total_items,
       (SELECT count(*) FROM public.questions q
        WHERE q.exam_id = a.id AND coalesce(q.question_type,'multiple_choice') <> 'essay') AS expected_total
FROM public.assessments a
CROSS JOIN LATERAL public.score_answers(a.id, '{}'::jsonb) s
WHERE a.allow_review
LIMIT 3;

-- =====================================================================
-- NEXT: 003_lock_answer_key.sql revokes anon's access to
-- questions.correct_answer. DO NOT run it until the app that uses these
-- RPCs is deployed — the currently live build scores in the browser and
-- would break the moment the key is withdrawn.
-- =====================================================================
