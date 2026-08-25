-- =====================================================================
-- PHASE 5a — retakes, answer review, server-side scoring
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- ADDITIVE ONLY. Nothing is dropped, no grant is revoked, no existing
-- paper is opened or altered, and the deployed app keeps working.
-- The revoke that closes the answer-key hole is 003, which must not run
-- until the new app is deployed.
--
-- WHAT THIS ADDS
--   1. Three per-assessment switches the instructor controls:
--        allow_retakes — unlimited attempts
--        show_answers  — reveal correct answers AFTER submitting
--        score_policy  — which attempt the instructor is shown
--      All default OFF / 'first', so every existing paper keeps behaving
--      exactly as it does today. Nothing becomes reviewable by accident.
--   2. review_attempts — every retake. Deliberately NOT results: results
--      is the graded record, carries UNIQUE(student_id, exam_id) so it
--      cannot hold retakes, and practice must never move a real average.
--   3. Server-side marking, so the answer key stops being shipped to the
--      browser. Correct answers reach a student only through
--      get_answer_review(), only on a paper with show_answers on, and
--      only after they have submitted.
--   4. assessment_scores — one clean row per student per assessment,
--      honouring score_policy, so instructor views do not have to deal
--      with hundreds of attempt rows.
--   5. duplicate_assessment() — makes the mock-exam copies.
--   6. The Pre-Boards PATTS cohort.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Per-assessment switches
-- ---------------------------------------------------------------------
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS allow_retakes boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_answers  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS score_policy  text    NOT NULL DEFAULT 'first';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='assessments_score_policy_chk') THEN
    ALTER TABLE public.assessments ADD CONSTRAINT assessments_score_policy_chk
      CHECK (score_policy IN ('first','latest','highest'));
  END IF;
END $$;

COMMENT ON COLUMN public.assessments.allow_retakes IS
  'Unlimited attempts. Off for real exams.';
COMMENT ON COLUMN public.assessments.show_answers IS
  'Reveal correct answers after a student submits. NEVER switch on for a paper still being used for marks — it hands over the key.';
COMMENT ON COLUMN public.assessments.score_policy IS
  'Which attempt the instructor is shown when retakes are on: first, latest or highest.';

-- ---------------------------------------------------------------------
-- 2. review_attempts
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

CREATE INDEX IF NOT EXISTS review_attempts_lookup_idx
  ON public.review_attempts (assessment_id, student_id, attempt_no);

-- ---------------------------------------------------------------------
-- 2b. Point the child foreign keys at assessments
-- ---------------------------------------------------------------------
-- questions.exam_id, results.exam_id and live_sessions.exam_id still
-- reference public.exams. That was fine while every assessment was a
-- mirrored exam, but a mock exam created directly in assessments has no
-- exams row, so inserting its questions — or a student's submission —
-- fails the constraint.
--
-- Repointing at assessments is safe: migration 001 copied every exam
-- across preserving its id, and the sync trigger keeps them in step, so
-- no existing row can violate the new target. It is also a step the
-- cutover needs regardless, since exams is eventually renamed away.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, t.relname AS tbl
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_class f ON f.oid = c.confrelid
    WHERE c.contype = 'f'
      AND f.relname = 'exams'
      AND t.relname IN ('questions','results','live_sessions')
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (exam_id) '
      'REFERENCES public.assessments(id) ON DELETE CASCADE', r.tbl, r.conname);
    RAISE NOTICE 'repointed %.% -> assessments', r.tbl, r.conname;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. Marking, server-side
-- ---------------------------------------------------------------------
-- p_answers is { "<question_id>": <chosen index 0-3> }. Returns the stored
-- shape the dashboard already renders, so existing views keep working.
CREATE OR REPLACE FUNCTION public.score_answers(
  p_assessment_id uuid, p_answers jsonb
) RETURNS TABLE (score int, total_items int, answers_json jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mc AS (
    SELECT q.id, q.correct_answer FROM public.questions q
    WHERE q.exam_id = p_assessment_id
      AND coalesce(q.question_type,'multiple_choice') <> 'essay'
  ), marked AS (
    SELECT mc.id, (p_answers ->> mc.id::text) AS chosen_raw,
           CASE WHEN (p_answers ->> mc.id::text) IS NULL THEN NULL
                ELSE ((p_answers ->> mc.id::text)::int = mc.correct_answer) END AS is_correct
    FROM mc
  )
  SELECT coalesce(count(*) FILTER (WHERE is_correct),0)::int,
         (SELECT count(*) FROM mc)::int,
         coalesce(jsonb_object_agg(id::text,
           jsonb_build_object('chosen', chosen_raw::int, 'is_correct', is_correct)
         ) FILTER (WHERE chosen_raw IS NOT NULL), '{}'::jsonb)
  FROM marked;
$$;

-- One entry point for every submission. Routes to review_attempts when
-- retakes are on, and to the graded results table when they are not, so the
-- client never has to know which table it is writing to.
CREATE OR REPLACE FUNCTION public.submit_assessment(
  p_student_id         uuid,
  p_assessment_id      uuid,
  p_answers            jsonb,
  p_time_taken_seconds integer DEFAULT NULL,
  p_tab_switches       integer DEFAULT 0,
  p_violation_logs     jsonb   DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE s int; t int; a jsonb; n int; retakes boolean; reveal boolean;
BEGIN
  SELECT allow_retakes, show_answers INTO retakes, reveal
  FROM public.assessments WHERE id = p_assessment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown assessment'; END IF;

  SELECT score, total_items, answers_json INTO s, t, a
  FROM public.score_answers(p_assessment_id, p_answers);

  IF retakes THEN
    SELECT coalesce(max(attempt_no),0)+1 INTO n FROM public.review_attempts
    WHERE student_id = p_student_id AND assessment_id = p_assessment_id;

    INSERT INTO public.review_attempts
      (student_id, assessment_id, attempt_no, score, total_items, answers_json, time_taken_seconds)
    VALUES (p_student_id, p_assessment_id, n, s, t, a, p_time_taken_seconds);
  ELSE
    n := 1;
    INSERT INTO public.results
      (student_id, exam_id, assessment_id, score, total_items, answers_json,
       time_taken_seconds, tab_switches, violation_logs, submitted_at)
    VALUES (p_student_id, p_assessment_id, p_assessment_id, s, t, a,
            p_time_taken_seconds, coalesce(p_tab_switches,0),
            coalesce(p_violation_logs,'[]'::jsonb), now())
    ON CONFLICT ON CONSTRAINT results_student_exam_key DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'score', s, 'total_items', t, 'attempt_no', n, 'can_review', reveal
  );
END $$;

-- The ONLY route to a correct answer. Refuses unless the paper has
-- show_answers on AND this student has already submitted it, so the key
-- can never be pulled before or during a sitting.
CREATE OR REPLACE FUNCTION public.get_answer_review(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_attempt_no    integer DEFAULT NULL   -- null = most recent
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE reveal boolean; ans jsonb;
BEGIN
  SELECT show_answers INTO reveal FROM public.assessments WHERE id = p_assessment_id;
  IF NOT coalesce(reveal, false) THEN
    RAISE EXCEPTION 'Answers are not available for this assessment';
  END IF;

  SELECT ra.answers_json INTO ans
  FROM public.review_attempts ra
  WHERE ra.student_id = p_student_id AND ra.assessment_id = p_assessment_id
    AND (p_attempt_no IS NULL OR ra.attempt_no = p_attempt_no)
  ORDER BY ra.attempt_no DESC LIMIT 1;

  IF ans IS NULL THEN
    SELECT r.answers_json INTO ans FROM public.results r
    WHERE r.student_id = p_student_id AND r.assessment_id = p_assessment_id;
  END IF;

  IF ans IS NULL THEN
    RAISE EXCEPTION 'Submit this assessment before viewing the answers';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(x ORDER BY (x->>'question_number')::int NULLS LAST), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'question_id', q.id, 'question_number', q.question_number,
        'question_text', q.question_text,
        'choices', jsonb_build_array(q.choice_a,q.choice_b,q.choice_c,q.choice_d),
        'correct', q.correct_answer,
        'chosen', (ans -> q.id::text ->> 'chosen')::int,
        'is_correct', coalesce((ans -> q.id::text ->> 'is_correct')::boolean, false)
      ) AS x
      FROM public.questions q
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') <> 'essay'
    ) s
  );
END $$;

GRANT EXECUTE ON FUNCTION public.submit_assessment(uuid,uuid,jsonb,integer,integer,jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_answer_review(uuid,uuid,integer)                      TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.score_answers(uuid,jsonb) FROM anon;

-- ---------------------------------------------------------------------
-- 4. One clean row per student per assessment
-- ---------------------------------------------------------------------
-- Retakes would otherwise flood the instructor's Results and Class Review
-- with hundreds of rows. This collapses them to the single attempt
-- score_policy asks for, and exposes attempt_count alongside.
CREATE OR REPLACE VIEW public.assessment_scores AS
WITH ranked AS (
  SELECT ra.*, a.score_policy,
         row_number() OVER (
           PARTITION BY ra.student_id, ra.assessment_id
           ORDER BY CASE a.score_policy
                      WHEN 'first'   THEN ra.attempt_no
                      WHEN 'latest'  THEN -ra.attempt_no
                      WHEN 'highest' THEN -ra.score
                    END,
                    ra.attempt_no
         ) AS pick,
         count(*) OVER (PARTITION BY ra.student_id, ra.assessment_id) AS attempts
  FROM public.review_attempts ra
  JOIN public.assessments a ON a.id = ra.assessment_id
)
SELECT student_id, assessment_id, score, total_items, answers_json,
       time_taken_seconds, submitted_at,
       attempts::int AS attempt_count, attempt_no AS shown_attempt_no,
       true AS is_retake
FROM ranked WHERE pick = 1
UNION ALL
SELECT r.student_id, r.assessment_id, r.score, r.total_items, r.answers_json,
       r.time_taken_seconds, r.submitted_at,
       1 AS attempt_count, 1 AS shown_attempt_no,
       false AS is_retake
FROM public.results r
WHERE r.assessment_id IS NOT NULL;

GRANT SELECT ON public.assessment_scores TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Mock-exam copies
-- ---------------------------------------------------------------------
-- Copies a paper and its questions into a new assessment. Used to turn the
-- revalida / diagnostic / pretest papers into "Mock Exam ..." practice
-- versions, so the originals are never opened or made reviewable.
CREATE OR REPLACE FUNCTION public.duplicate_assessment(
  p_source_id      uuid,
  p_new_title      text,
  p_target_section text,
  p_allow_retakes  boolean DEFAULT true,
  p_show_answers   boolean DEFAULT true,
  p_score_policy   text    DEFAULT 'latest'
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = p_source_id
      AND (a.instructor_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.exam_shares s
                      WHERE s.exam_id = a.id AND s.shared_with = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'You do not have access to this assessment';
  END IF;

  -- Created closed. Open it deliberately once the copy looks right.
  INSERT INTO public.assessments
    (kind, title, description, target_section, instructor_id, is_open,
     duration_minutes, exam_password, has_password,
     allow_retakes, show_answers, score_policy)
  SELECT a.kind, p_new_title, a.description, p_target_section, auth.uid(), false,
         a.duration_minutes, a.exam_password, a.has_password,
         p_allow_retakes, p_show_answers, p_score_policy
  FROM public.assessments a WHERE a.id = p_source_id
  RETURNING id INTO new_id;

  INSERT INTO public.questions
    (exam_id, assessment_id, question_number, question_text, question_type,
     category, choice_a, choice_b, choice_c, choice_d, correct_answer, image_url)
  SELECT new_id, new_id, q.question_number, q.question_text, q.question_type,
         q.category, q.choice_a, q.choice_b, q.choice_c, q.choice_d,
         q.correct_answer, q.image_url
  FROM public.questions q WHERE q.exam_id = p_source_id;

  RETURN new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.duplicate_assessment(uuid,text,text,boolean,boolean,text) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------
ALTER TABLE public.review_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_attempts_anon_select ON public.review_attempts;
DROP POLICY IF EXISTS review_attempts_auth_all    ON public.review_attempts;
CREATE POLICY review_attempts_anon_select ON public.review_attempts
  FOR SELECT TO anon USING (true);
CREATE POLICY review_attempts_auth_all ON public.review_attempts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Writes go through submit_assessment(), not a direct INSERT grant.
GRANT SELECT ON public.review_attempts TO anon;
GRANT ALL    ON public.review_attempts TO authenticated;

-- ---------------------------------------------------------------------
-- 7. Pre-Boards PATTS cohort
-- ---------------------------------------------------------------------
-- Appended, never replacing: keeping AENG 426 preserves every existing
-- result, grade and Class Review row for these students.
--
-- NOTE: this adds the section only. It deliberately does NOT touch any
-- existing paper — no exam is opened, made reviewable, or retargeted. The
-- mock exams are created as copies from the dashboard.
UPDATE public.users u
SET section = btrim(coalesce(u.section,'')) || ', Pre-Boards PATTS'
WHERE EXISTS (SELECT 1 FROM unnest(string_to_array(coalesce(u.section,''),',')) AS t(x)
              WHERE btrim(t.x) = 'AENG 426')
  AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(coalesce(u.section,''),',')) AS t(x)
                  WHERE btrim(t.x) = 'Pre-Boards PATTS');

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================
SELECT 'cohort' AS check,
       count(*) FILTER (WHERE section LIKE '%Pre-Boards PATTS%') AS in_preboards,
       count(*) FILTER (WHERE section LIKE '%AENG 426%')         AS still_in_426
FROM public.users;

-- Must be 0 / 0 / 0: no existing paper was altered by this migration.
SELECT 'no paper altered' AS check,
       count(*) FILTER (WHERE allow_retakes) AS retakes_on,
       count(*) FILTER (WHERE show_answers)  AS answers_on,
       count(*) FILTER (WHERE target_section LIKE '%Pre-Boards%') AS retargeted
FROM public.assessments;

-- =====================================================================
-- NEXT: 003_lock_answer_key.sql revokes anon's access to
-- questions.correct_answer. DO NOT run it until the app using
-- submit_assessment() is deployed — the live build still marks in the
-- browser and would break the moment the key is withdrawn.
-- =====================================================================
