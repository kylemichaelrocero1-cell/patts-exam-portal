-- =====================================================================
-- 025 — an item may be worth more than one point
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- WHY
-- Every item has been worth exactly one point since the first version, because
-- score_answers() COUNTS the items a student got right. That is fine for a
-- 50-item multiple-choice paper and wrong for almost anything else: a
-- three-part problem is not worth the same as a definition, and a worked
-- solution introduced in 024 already carries 3 marks of its own.
--
-- WHAT THIS ADDS
-- questions.marks (added in 024) becomes meaningful for EVERY question type,
-- not just worked ones. An item may be worth 5, 3 or 2 points.
--
-- WHAT IT DELIBERATELY DOES NOT DO — READ THIS BEFORE CHANGING IT
-- It does NOT redefine `score` or `total_items`. Those two columns are on
-- every result row ever written, they are a COUNT, and a great deal reads
-- them: the Results table, the class review, averages, the pass rate, the CSV
-- export, and the manual-score repair path. Redefining a count as a sum would
-- silently restate every exam already on file — a 40/50 from last term would
-- become 40/70 if some of those items were later reweighted.
--
-- So points are ADDITIVE:
--   score / total_items          — unchanged, still a count of items
--   points_earned / points_total — new, the weighted sum
--
-- For every paper that exists today each item is worth 1, so the two agree
-- exactly, and nothing on screen moves until somebody deliberately reweights
-- an item. Old rows are left NULL rather than backfilled; the client falls
-- back to the count when points are absent (combinedScore() in
-- src/lib/workedShape.js is the single place that decides).
--
-- ---------------------------------------------------------------------
-- REHEARSE IT FIRST
--   1. Change  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file and read the VERIFY output.
--   3. Change it back and run again for real.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Sanity
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='questions'
                   AND column_name='marks') THEN
    RAISE EXCEPTION 'questions.marks not found — run sql/024 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Where the weighted total is kept
-- ---------------------------------------------------------------------
ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS points_earned numeric,
  ADD COLUMN IF NOT EXISTS points_total  numeric;

ALTER TABLE public.review_attempts
  ADD COLUMN IF NOT EXISTS points_earned numeric,
  ADD COLUMN IF NOT EXISTS points_total  numeric;

COMMENT ON COLUMN public.results.points_earned IS
  'Weighted marks earned on PICKED items (multiple choice and multi-answer). NULL on rows written before 025, where the client falls back to `score`. Worked items are counted separately in work_marks (024) because they are marked later, by an instructor.';
COMMENT ON COLUMN public.results.points_total IS
  'Weighted marks available on picked items. NULL means fall back to total_items.';

-- marks is public, and a student is entitled to know an item carries 5 points.
COMMENT ON COLUMN public.questions.marks IS
  'What this item is worth, for EVERY question type (025). Defaults to 1, which is what makes a sum of marks equal the old count of items for every paper written before this.';

-- ---------------------------------------------------------------------
-- 2. Marking returns both the count and the weighted sum
-- ---------------------------------------------------------------------
-- 024 defined score_answers() most recently. The return type gains two
-- columns, so the function has to be dropped rather than replaced — which is
-- safe here because anon cannot execute it (003) and submit_assessment() is
-- its only caller, updated below inside this same transaction.
DROP FUNCTION IF EXISTS public.score_answers(uuid, jsonb);
CREATE FUNCTION public.score_answers(
  p_assessment_id uuid, p_answers jsonb
) RETURNS TABLE (
  score         int,
  total_items   int,
  answers_json  jsonb,
  points_earned numeric,
  points_total  numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mc AS (
    SELECT q.id,
           coalesce(q.question_type,'multiple_choice') = 'multi_select' AS is_multi,
           -- An item with no marks stated is worth one, exactly as before.
           coalesce(q.marks, 1)::numeric AS marks,
           CASE WHEN coalesce(q.question_type,'multiple_choice') = 'multi_select'
                THEN public.answer_index_set(q.correct_answers)
                ELSE public.answer_index_set(to_jsonb(q.correct_answer))
           END AS key_set
    FROM public.questions q
    WHERE q.exam_id = p_assessment_id
      AND coalesce(q.question_type,'multiple_choice') NOT IN ('essay','worked_solution')
  ), judged AS (
    SELECT mc.id, mc.is_multi, mc.marks,
           public.answer_index_set(p_answers -> mc.id::text) AS chosen_set,
           CASE WHEN public.answer_index_set(p_answers -> mc.id::text) IS NULL THEN NULL
                ELSE public.answer_index_set(p_answers -> mc.id::text) = mc.key_set
           END AS is_correct
    FROM mc
  )
  SELECT coalesce(count(*) FILTER (WHERE is_correct), 0)::int,
         (SELECT count(*) FROM mc)::int,
         coalesce(jsonb_object_agg(id::text, jsonb_build_object(
           'chosen', CASE WHEN is_multi THEN to_jsonb(chosen_set)
                          ELSE to_jsonb(chosen_set[1]) END,
           'is_correct', is_correct,
           -- Carried per item so a student's answer review can say "2 of 5"
           -- on the item itself rather than only in the paper's total.
           'marks', marks
         )) FILTER (WHERE chosen_set IS NOT NULL), '{}'::jsonb),
         coalesce(sum(marks) FILTER (WHERE is_correct), 0)::numeric,
         (SELECT coalesce(sum(marks), 0) FROM mc)::numeric
  FROM judged;
$$;

REVOKE EXECUTE ON FUNCTION public.score_answers(uuid,jsonb) FROM anon;

-- ---------------------------------------------------------------------
-- 3. Submitting records both
-- ---------------------------------------------------------------------
-- 002 defined this; the body is that one with the two new columns carried
-- through to whichever table the sitting lands in. The returned object gains
-- them too, so the screen a student sees straight after submitting can show
-- points without a second round trip.
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
  END IF;

  RETURN jsonb_build_object(
    'score', s, 'total_items', t, 'attempt_no', n, 'can_review', reveal,
    'points_earned', pe, 'points_total', pt
  );
END $$;

GRANT EXECUTE ON FUNCTION public.submit_assessment(uuid,uuid,jsonb,integer,integer,jsonb) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. The paper a student is served says what each item is worth
-- ---------------------------------------------------------------------
-- get_exam_questions() already returns `marks` (024). Nothing to change: it
-- was added there for worked items and is simply meaningful for all of them
-- now. Stated here so the next person does not go looking.

-- ---------------------------------------------------------------------
-- 5. Answer review carries the weight
-- ---------------------------------------------------------------------
-- 024 defined this most recently; the only change is `marks` on each item, so
-- the review screen can show "0 of 5" rather than a bare cross on a question
-- that cost five times what the one above it did.
CREATE OR REPLACE FUNCTION public.get_answer_review(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_attempt_no    integer DEFAULT NULL
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
        'question_type', coalesce(q.question_type,'multiple_choice'),
        'choices', q.choices,
        'correct', q.correct_answer,
        'marks', coalesce(q.marks, 1),
        'correct_set', CASE
          WHEN coalesce(q.question_type,'multiple_choice') = 'multi_select'
          THEN coalesce(to_jsonb(public.answer_index_set(q.correct_answers)), '[]'::jsonb)
        END,
        'chosen', ans -> q.id::text -> 'chosen',
        'is_correct', coalesce((ans -> q.id::text ->> 'is_correct')::boolean, false)
      ) AS x
      FROM public.questions q
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') NOT IN ('essay','worked_solution')
    ) s
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_answer_review(uuid,uuid,integer) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. Nothing was reweighted: every item still carries 1 mark, so a sum of
--    marks and the old count of items are still the same number.
SELECT count(*) AS questions, count(*) FILTER (WHERE coalesce(marks,1) <> 1) AS reweighted
FROM public.questions;
-- reweighted must be 0 immediately after this runs.

-- 2. Marking returns five columns now, and the two totals agree while every
--    item is worth one. Substitute one of your own assessment ids.
-- SELECT * FROM public.score_answers('<paper id>', '{}'::jsonb);
-- total_items and points_total must be equal.

-- 3. Existing result rows are untouched and carry no points yet.
SELECT count(*) AS rows, count(points_total) AS with_points FROM public.results;
-- with_points must be 0: old rows fall back to score/total_items on screen.

-- 4. The key is still withheld from anon.
SELECT string_agg(column_name, ', ' ORDER BY column_name) AS anon_readable
FROM information_schema.column_privileges
WHERE grantee='anon' AND table_name='questions' AND privilege_type='SELECT';
-- Neither correct_answer, correct_answers nor work_rubric may appear.
