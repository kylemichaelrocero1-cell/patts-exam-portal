-- =====================================================================
-- 018 — questions with more than one right answer
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Safe to run before the code that uses it is deployed: additive, and no
-- existing item can become a multi-answer one by accident.
--
-- WHY
-- Every item so far has had exactly one key — correct_answer, an index into
-- choices — so a question with several right answers had to be folded into
-- one choice ("A and C only") or split into a run of true/false items.
--
-- WHAT THIS ADDS
--   question_type 'multi_select'. The student ticks checkboxes instead of
--   picking one radio, and questions.correct_answers holds the key: a jsonb
--   ARRAY of 0-based indices into choices.
--
-- HOW IT IS MARKED — ALL OR NOTHING
-- The set a student ticks must equal the key EXACTLY. Three right answers
-- and they tick two: no point. All three plus a wrong fourth: no point.
-- There is no partial credit, and that is the whole definition of the item
-- type rather than a setting. It is enforced here, in Postgres, inside
-- score_answers(), so no client can award itself a point by sending a
-- different shape.
--
-- WHAT IS NOT TOUCHED
--   * correct_answer keeps its exact meaning for every item that exists
--     today. An item is multi_select only if its question_type says so, and
--     nothing is converted by this migration.
--   * The answer key is still withheld from anon. 003 replaced anon's
--     table-wide SELECT with an allow-list, so a new column is unreadable
--     until it is named — correct_answers is not named, and the REVOKE
--     below says so out loud rather than relying on that.
--   * choices, shuffle_choices and shuffle_questions all behave the same.
--     A multi_select item shuffles like any other: the key is a set of
--     STORED indices, so the order on screen cannot affect marking.
--
-- WHAT CHANGES SHAPE
-- answers_json.chosen has always been an integer. For a multi_select item
-- it is an ARRAY of integers. Readers must branch on question_type — the
-- client does this in src/lib/answers.js.
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
                   AND column_name='choices') THEN
    RAISE EXCEPTION 'questions.choices not found — run sql/016 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. The third question type
-- ---------------------------------------------------------------------
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_type_chk;
ALTER TABLE public.questions ADD CONSTRAINT questions_type_chk
  CHECK (question_type IN ('multiple_choice','multi_select','essay'));

-- ---------------------------------------------------------------------
-- 2. The key
-- ---------------------------------------------------------------------
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS correct_answers jsonb;

COMMENT ON COLUMN public.questions.correct_answers IS
  'Key for a multi_select item: jsonb array of 0-based indices into choices, sorted and distinct (normalised by trigger). NULL for every other question type, which key on correct_answer instead.';

-- Reading any answer — a key or a submission — as a sorted set of indices.
-- One integer, an array of them, or the same written as strings all normalise
-- to the same int[]; anything else, and an empty list, come back NULL, which
-- is how "nothing was answered" is spelt everywhere below.
CREATE OR REPLACE FUNCTION public.answer_index_set(v jsonb)
RETURNS int[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN a IS NULL OR cardinality(a) = 0 THEN NULL ELSE a END
  FROM (
    SELECT array_agg(DISTINCT n ORDER BY n) AS a
    FROM (
      SELECT (e #>> '{}')::int AS n
      FROM jsonb_array_elements(
             CASE jsonb_typeof(v)
               WHEN 'array'  THEN v
               WHEN 'number' THEN jsonb_build_array(v)
               WHEN 'string' THEN CASE WHEN (v #>> '{}') ~ '^[0-9]+$'
                                       THEN jsonb_build_array(v)
                                       ELSE '[]'::jsonb END
               ELSE '[]'::jsonb
             END) AS e
      WHERE jsonb_typeof(e) = 'number'
         OR (jsonb_typeof(e) = 'string' AND (e #>> '{}') ~ '^[0-9]+$')
    ) t
  ) s
$$;

COMMENT ON FUNCTION public.answer_index_set(jsonb) IS
  'A key or a submitted answer as a sorted, distinct int[]. NULL when there is nothing usable in it.';

-- ---------------------------------------------------------------------
-- 3. Constraints
-- ---------------------------------------------------------------------
-- Deliberately free of function calls and subqueries: a CHECK cannot hold a
-- subquery at all, and one that calls a function is a restore-order hazard.
-- The basics live here; the thorough validation is the trigger below, which
-- also normalises, so a stored key is always canonical.
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_correct_answers_chk;
ALTER TABLE public.questions ADD CONSTRAINT questions_correct_answers_chk
  CHECK (
    correct_answers IS NULL
    OR (jsonb_typeof(correct_answers) = 'array'
        AND jsonb_array_length(correct_answers) > 0)
  );

-- The two keys are mutually exclusive, so there is never a question about
-- which one marks an item: a multi_select carries correct_answers and no
-- correct_answer, and everything else the reverse.
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_key_matches_type_chk;
ALTER TABLE public.questions ADD CONSTRAINT questions_key_matches_type_chk
  CHECK (
    CASE WHEN coalesce(question_type,'multiple_choice') = 'multi_select'
         THEN correct_answers IS NOT NULL AND correct_answer IS NULL
         ELSE correct_answers IS NULL
    END
  );

-- ---------------------------------------------------------------------
-- 4. Normalise and validate the key
-- ---------------------------------------------------------------------
-- Runs AFTER questions_sync_choice_columns (016) — triggers on one event fire
-- in name order, and 'v' sorts after 's' — so NEW.choices is already final
-- when the key is checked against its length.
CREATE OR REPLACE FUNCTION public.validate_multi_key()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k int[]; n int;
BEGIN
  IF coalesce(NEW.question_type,'multiple_choice') <> 'multi_select' THEN
    RETURN NEW;
  END IF;

  k := public.answer_index_set(NEW.correct_answers);
  IF k IS NULL THEN
    RAISE EXCEPTION 'A multiple-answer question needs at least one correct choice ticked';
  END IF;

  n := jsonb_array_length(NEW.choices);
  IF (SELECT max(x) FROM unnest(k) x) >= n THEN
    RAISE EXCEPTION 'The key points at choice % but this question only has % choices',
      (SELECT max(x) FROM unnest(k) x) + 1, n;
  END IF;

  -- Sorted and de-duplicated, whatever the client sent, so marking can
  -- compare the two sets directly.
  NEW.correct_answers := to_jsonb(k);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS questions_validate_multi_key ON public.questions;
CREATE TRIGGER questions_validate_multi_key
  BEFORE INSERT OR UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.validate_multi_key();

-- ---------------------------------------------------------------------
-- 5. The key stays out of the browser
-- ---------------------------------------------------------------------
-- 003 left anon with a column allow-list, which a new column does not join.
-- Said explicitly anyway, so a later GRANT SELECT on the whole table cannot
-- quietly hand it over.
REVOKE SELECT (correct_answers) ON public.questions FROM anon;
GRANT ALL ON public.questions TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Marking, all or nothing
-- ---------------------------------------------------------------------
-- p_answers is { "<question_id>": <index> | [<index>, …] }. A single-answer
-- item may be sent either way and is read as a one-element set; a
-- multi_select item is correct only when its set equals the key exactly.
CREATE OR REPLACE FUNCTION public.score_answers(
  p_assessment_id uuid, p_answers jsonb
) RETURNS TABLE (score int, total_items int, answers_json jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mc AS (
    SELECT q.id,
           coalesce(q.question_type,'multiple_choice') = 'multi_select' AS is_multi,
           CASE WHEN coalesce(q.question_type,'multiple_choice') = 'multi_select'
                THEN public.answer_index_set(q.correct_answers)
                ELSE public.answer_index_set(to_jsonb(q.correct_answer))
           END AS key_set
    FROM public.questions q
    WHERE q.exam_id = p_assessment_id
      AND coalesce(q.question_type,'multiple_choice') <> 'essay'
  ), judged AS (
    SELECT mc.id, mc.is_multi,
           public.answer_index_set(p_answers -> mc.id::text) AS chosen_set,
           -- NULL, not false, when the item was left blank or has no key:
           -- the count below filters on true, so a blank is neither right
           -- nor counted as a wrong answer that was given.
           CASE WHEN public.answer_index_set(p_answers -> mc.id::text) IS NULL THEN NULL
                ELSE public.answer_index_set(p_answers -> mc.id::text) = mc.key_set
           END AS is_correct
    FROM mc
  )
  SELECT coalesce(count(*) FILTER (WHERE is_correct), 0)::int,
         (SELECT count(*) FROM mc)::int,
         coalesce(jsonb_object_agg(id::text, jsonb_build_object(
           -- An integer for a single-answer item, exactly as before; an
           -- array for a multi_select one.
           'chosen', CASE WHEN is_multi THEN to_jsonb(chosen_set)
                          ELSE to_jsonb(chosen_set[1]) END,
           'is_correct', is_correct
         )) FILTER (WHERE chosen_set IS NOT NULL), '{}'::jsonb)
  FROM judged;
$$;

REVOKE EXECUTE ON FUNCTION public.score_answers(uuid,jsonb) FROM anon;

-- ---------------------------------------------------------------------
-- 7. Answer review carries the set
-- ---------------------------------------------------------------------
-- `correct` alone cannot describe a multi-answer item, so the row now also
-- carries question_type and correct_set. `chosen` is passed through as raw
-- jsonb rather than cast to int, because for these items it is an array.
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
        'correct_set', CASE
          WHEN coalesce(q.question_type,'multiple_choice') = 'multi_select'
          THEN coalesce(to_jsonb(public.answer_index_set(q.correct_answers)), '[]'::jsonb)
        END,
        'chosen', ans -> q.id::text -> 'chosen',
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
-- 8. Copying a paper carries the set
-- ---------------------------------------------------------------------
-- 017 defined this most recently; this is that body with correct_answers
-- added. Without it a duplicated paper's multi-answer items would arrive
-- keyless and be rejected by questions_key_matches_type_chk.
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
     allow_retakes, show_answers, score_policy, shuffle_choices, shuffle_questions)
  SELECT a.kind, p_new_title, a.description, p_target_section, auth.uid(), false,
         a.duration_minutes, a.exam_password, a.has_password,
         p_allow_retakes, p_show_answers, p_score_policy,
         a.shuffle_choices, a.shuffle_questions
  FROM public.assessments a WHERE a.id = p_source_id
  RETURNING id INTO new_id;

  -- choice_a..choice_e are left to the trigger in 016 rather than copied.
  INSERT INTO public.questions
    (exam_id, assessment_id, question_number, question_text, question_type,
     category, choices, correct_answer, correct_answers, image_url)
  SELECT new_id, new_id, q.question_number, q.question_text, q.question_type,
         q.category, q.choices, q.correct_answer, q.correct_answers, q.image_url
  FROM public.questions q WHERE q.exam_id = p_source_id;

  RETURN new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.duplicate_assessment(uuid,text,text,boolean,boolean,text) TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. Nothing was converted: every item that existed is still single-answer.
SELECT count(*)                                                    AS questions,
       count(*) FILTER (WHERE question_type = 'multi_select')       AS multi_answer,
       count(*) FILTER (WHERE correct_answers IS NOT NULL)          AS carrying_a_set
FROM public.questions;
-- multi_answer and carrying_a_set must both be 0 immediately after this runs.

-- 2. The key is still not readable by anon.
SELECT string_agg(column_name, ', ' ORDER BY column_name) AS anon_readable
FROM information_schema.column_privileges
WHERE grantee='anon' AND table_name='questions' AND privilege_type='SELECT';
-- Neither correct_answer nor correct_answers may appear.

-- 3. Reading an answer as a set.
SELECT public.answer_index_set('2'::jsonb)          AS one_number,     -- {2}
       public.answer_index_set('[2,0,2]'::jsonb)    AS sorted_deduped, -- {0,2}
       public.answer_index_set('[]'::jsonb)         AS empty_is_null,  -- NULL
       public.answer_index_set(NULL)                AS null_is_null;   -- NULL

-- 4. Both triggers are on the table, and the key one runs second.
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.questions'::regclass AND NOT tgisinternal
ORDER BY tgname;
-- questions_sync_choice_columns, then questions_validate_multi_key.
