-- =====================================================================
-- 016 — any number of choices per item
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Safe to run before the code that uses it is deployed.
--
-- WHY
-- The ceiling has moved twice already and each move cost a migration and a
-- deploy: four choices in the original schema, then choice_e in 012 when
-- ESCI 316 arrived with five, and now a CSV with seven. Adding choice_f,
-- choice_g and choice_h would just put the wall three columns further out.
--
-- So the choices stop being columns. `questions.choices` is a jsonb ARRAY of
-- strings, in order, of any length. correct_answer stays exactly what it was
-- — a 0-based index — and is now constrained against the array's length, so
-- a key can never point past the end whatever that length is.
--
-- WHAT HAPPENS TO choice_a..choice_e
-- They stay, and they stay CORRECT. A trigger mirrors the first five entries
-- of `choices` back into them on every write. That is not tidiness: a
-- student's browser may be running the previous build for as long as their
-- tab is open, and that build reads choice_a..choice_e. Without the mirror,
-- an item edited after this deploy would go blank mid-exam for anyone who
-- had not reloaded.
--
-- `choices` is the truth whenever it is given. When it is NOT given — an older
-- client, or one of the content loader scripts, writing choice_a..e alone —
-- the columns become the array instead, so a legacy-shaped INSERT still
-- produces a working item rather than one with no choices at all. Drop the
-- trigger and the columns in a later migration, once no such writer remains.
--
-- WHAT IS NOT TOUCHED
--   * score_answers() compares the submitted index against correct_answer and
--     never enumerates columns. It already marks any number of choices.
--   * shuffle_choices (012) still decides whether the order is randomised.
--   * The answer key is still withheld from anon; `choices` is granted, in
--     the same allow-list style 003 established.
--
-- ---------------------------------------------------------------------
-- REHEARSE IT FIRST (recommended)
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
                   AND column_name='choice_e') THEN
    RAISE EXCEPTION 'questions.choice_e not found — run sql/012 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. The array
-- ---------------------------------------------------------------------
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS choices jsonb;

COMMENT ON COLUMN public.questions.choices IS
  'Ordered jsonb array of choice strings, any length. correct_answer indexes into it. choice_a..choice_e are a mirror of the first five, kept only until every client reads this column.';

-- ---------------------------------------------------------------------
-- 2. Backfill from the columns
-- ---------------------------------------------------------------------
-- Only rows that have not been converted, so re-running never clobbers an
-- array that has since grown past five.
UPDATE public.questions
   SET choices = (
     SELECT coalesce(jsonb_agg(c ORDER BY ord), '[]'::jsonb)
     FROM unnest(ARRAY[choice_a, choice_b, choice_c, choice_d, choice_e])
          WITH ORDINALITY AS t(c, ord)
     WHERE c IS NOT NULL AND btrim(c) <> ''
   )
 WHERE choices IS NULL;

ALTER TABLE public.questions ALTER COLUMN choices SET DEFAULT '[]'::jsonb;

UPDATE public.questions SET choices = '[]'::jsonb WHERE choices IS NULL;
ALTER TABLE public.questions ALTER COLUMN choices SET NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Constraints
-- ---------------------------------------------------------------------
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_choices_is_array_chk;
ALTER TABLE public.questions ADD CONSTRAINT questions_choices_is_array_chk
  CHECK (jsonb_typeof(choices) = 'array');

-- The key must index into the array that actually exists. This replaces both
-- the 0..3 range from the original schema and the 0..4 from 012 — neither is
-- meaningful once the length varies per item.
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_correct_chk;
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_key_has_choice_chk;
ALTER TABLE public.questions ADD CONSTRAINT questions_correct_chk
  CHECK (
    correct_answer IS NULL
    OR (correct_answer >= 0 AND correct_answer < jsonb_array_length(choices))
  );

-- ---------------------------------------------------------------------
-- 4. Mirror the first five back into the old columns
-- ---------------------------------------------------------------------
-- So a browser still running the previous build keeps rendering a question
-- that has been edited since. `choices` wins when it is given; when it is not,
-- the columns are read as the array instead (see inside).
CREATE OR REPLACE FUNCTION public.sync_choice_columns()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF NEW.choices IS NULL THEN NEW.choices := '[]'::jsonb; END IF;

  -- Which side is the source?
  --   * INSERT with no array but with columns — an older client, or one of the
  --     content loader scripts in ~/patts-exam-content, which INSERT
  --     choice_a..e alone. Without this they would produce an item with no
  --     choices at all, and the key constraint would reject the row outright.
  --   * UPDATE that touched a column and left `choices` alone. Mirroring would
  --     silently revert the edit, so read the columns instead.
  -- In every other case `choices` is the truth and the columns follow it.
  IF (jsonb_array_length(NEW.choices) = 0
      AND coalesce(NEW.choice_a, NEW.choice_b, NEW.choice_c, NEW.choice_d, NEW.choice_e) IS NOT NULL)
     OR (TG_OP = 'UPDATE'
         AND NEW.choices IS NOT DISTINCT FROM OLD.choices
         AND (NEW.choice_a, NEW.choice_b, NEW.choice_c, NEW.choice_d, NEW.choice_e)
             IS DISTINCT FROM
             (OLD.choice_a, OLD.choice_b, OLD.choice_c, OLD.choice_d, OLD.choice_e))
  THEN
    NEW.choices := (
      SELECT coalesce(jsonb_agg(c ORDER BY ord), '[]'::jsonb)
      FROM unnest(ARRAY[NEW.choice_a, NEW.choice_b, NEW.choice_c, NEW.choice_d, NEW.choice_e])
           WITH ORDINALITY AS t(c, ord)
      WHERE c IS NOT NULL AND btrim(c) <> ''
    );
  END IF;

  n := jsonb_array_length(NEW.choices);
  NEW.choice_a := CASE WHEN n > 0 THEN NEW.choices ->> 0 END;
  NEW.choice_b := CASE WHEN n > 1 THEN NEW.choices ->> 1 END;
  NEW.choice_c := CASE WHEN n > 2 THEN NEW.choices ->> 2 END;
  NEW.choice_d := CASE WHEN n > 3 THEN NEW.choices ->> 3 END;
  NEW.choice_e := CASE WHEN n > 4 THEN NEW.choices ->> 4 END;
  RETURN NEW;
END $$;

-- Every INSERT and UPDATE, not just those naming `choices`: an UPDATE that
-- touches only choice_a has to resync too, or the two would drift apart.
DROP TRIGGER IF EXISTS questions_sync_choice_columns ON public.questions;
CREATE TRIGGER questions_sync_choice_columns
  BEFORE INSERT OR UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.sync_choice_columns();

-- ---------------------------------------------------------------------
-- 5. Students must be able to read the array
-- ---------------------------------------------------------------------
GRANT SELECT (
  id, exam_id, assessment_id, question_number, question_text,
  question_type, category, choice_a, choice_b, choice_c, choice_d, choice_e,
  choices, image_url, created_at
) ON public.questions TO anon;
GRANT ALL ON public.questions TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Answer review returns the whole array
-- ---------------------------------------------------------------------
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
        'choices', q.choices,
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

GRANT EXECUTE ON FUNCTION public.get_answer_review(uuid,uuid,integer) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Copying a paper carries the array
-- ---------------------------------------------------------------------
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

  INSERT INTO public.assessments
    (kind, title, description, target_section, instructor_id, is_open,
     duration_minutes, exam_password, has_password,
     allow_retakes, show_answers, score_policy, shuffle_choices)
  SELECT a.kind, p_new_title, a.description, p_target_section, auth.uid(), false,
         a.duration_minutes, a.exam_password, a.has_password,
         p_allow_retakes, p_show_answers, p_score_policy, a.shuffle_choices
  FROM public.assessments a WHERE a.id = p_source_id
  RETURNING id INTO new_id;

  -- choice_a..choice_e are left to the trigger rather than copied.
  INSERT INTO public.questions
    (exam_id, assessment_id, question_number, question_text, question_type,
     category, choices, correct_answer, image_url)
  SELECT new_id, new_id, q.question_number, q.question_text, q.question_type,
         q.category, q.choices, q.correct_answer, q.image_url
  FROM public.questions q WHERE q.exam_id = p_source_id;

  RETURN new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.duplicate_assessment(uuid,text,text,boolean,boolean,text) TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. Every multiple-choice item has an array, and the mirror agrees with it.
SELECT count(*) AS items,
       count(*) FILTER (WHERE jsonb_typeof(choices) <> 'array')       AS not_an_array,
       count(*) FILTER (WHERE jsonb_array_length(choices) > 5)        AS more_than_five,
       count(*) FILTER (WHERE coalesce(question_type,'multiple_choice') <> 'essay'
                          AND jsonb_array_length(choices) < 2)        AS too_few_choices,
       count(*) FILTER (WHERE correct_answer IS NOT NULL
                          AND correct_answer >= jsonb_array_length(choices)) AS key_past_the_end
FROM public.questions;
-- not_an_array, too_few_choices and key_past_the_end must all be 0.
-- more_than_five will be 0 until you import a paper with six or more.

-- 2. The mirror matches the array for every row.
SELECT count(*) AS rows_where_the_mirror_disagrees
FROM public.questions
WHERE choice_a IS DISTINCT FROM (CASE WHEN jsonb_array_length(choices) > 0 THEN choices ->> 0 END)
   OR choice_b IS DISTINCT FROM (CASE WHEN jsonb_array_length(choices) > 1 THEN choices ->> 1 END)
   OR choice_c IS DISTINCT FROM (CASE WHEN jsonb_array_length(choices) > 2 THEN choices ->> 2 END)
   OR choice_d IS DISTINCT FROM (CASE WHEN jsonb_array_length(choices) > 3 THEN choices ->> 3 END)
   OR choice_e IS DISTINCT FROM (CASE WHEN jsonb_array_length(choices) > 4 THEN choices ->> 4 END);
-- Must be 0. Backfilled rows were written from the columns, so they agree by
-- construction; anything else means a write bypassed the trigger.

-- 3. anon reads the choices but still not the key.
SELECT string_agg(column_name, ', ' ORDER BY column_name) AS anon_readable
FROM information_schema.column_privileges
WHERE grantee='anon' AND table_name='questions' AND privilege_type='SELECT';
-- `choices` MUST appear. `correct_answer` MUST NOT.

-- 4. How wide the papers actually are.
SELECT jsonb_array_length(choices) AS n_choices, count(*) AS items
FROM public.questions
WHERE coalesce(question_type,'multiple_choice') <> 'essay'
GROUP BY 1 ORDER BY 1;
