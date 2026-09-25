-- =====================================================================
-- 024 — questions that are WORKED, not picked
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Safe to run before the code that uses it is deployed: additive, and no
-- existing item can become a worked item by accident.
--
-- WHY
-- Every item so far is answered by choosing: a radio (011), a set of
-- checkboxes (018), or free prose that is never marked at all (essay). None
-- of those can ask a student to DIFFERENTIATE something and show the working,
-- which is most of what a maths paper is.
--
-- WHAT THIS ADDS
--   question_type 'worked_solution'. The student types a stack of maths
--   lines and each is checked against the one above it. The item is worth
--   `marks` — 3, say — and partial credit is real: working that applies the
--   power rule but never simplifies earns some of the three, not none.
--
-- THE FOUR NEW COLUMNS, AND WHICH SIDE OF THE GATE EACH IS ON
--   marks          int   — what the item is worth. PUBLIC. A student is
--                          entitled to know a question carries 3 marks.
--   work_given     text  — the problem, as LaTeX (y = 5x). PUBLIC; it is the
--                          question. Seeds the first line so the student's
--                          opening step has something to follow from.
--   work_variable  text  — what to differentiate or solve with respect to.
--                          PUBLIC, for the same reason.
--   work_rubric    jsonb — THE KEY. The instructor's own working, line by
--                          line, with the marks each line carries. Revoked
--                          from anon below and absent from
--                          get_exam_questions() by construction.
--
-- HOW IT IS MARKED, AND WHERE
-- Not in Postgres. Deciding that 5(1)x^{1-1} and 5 are the same number needs
-- a computer algebra system, and there is no usable one inside this database.
-- So marking happens in JavaScript — and specifically in the INSTRUCTOR's
-- browser, when they open the paper, because that browser already holds the
-- answer key legitimately and a student's browser must never compute the mark
-- it is graded on. The result is written back through record_work_marks()
-- below, which re-checks ownership of the paper before it writes.
--
-- The honest consequence: a worked item's mark is PENDING between submission
-- and the instructor opening the paper. That is stated on screen rather than
-- papered over, and it is how work-shown questions are marked on paper too.
--
-- WHAT IS NOT TOUCHED
--   * score_answers() still returns a count of ITEMS, unchanged, and still
--     ignores essays. Worked items join essays in being ignored there — their
--     marks live in their own columns and are never folded into `score`,
--     so every existing result, export and average means exactly what it
--     meant yesterday.
--   * No existing item is converted. An item is worked only if its
--     question_type says so.
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
                   AND column_name='correct_answers') THEN
    RAISE EXCEPTION 'questions.correct_answers not found — run sql/018 first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                 WHERE routine_schema='public' AND routine_name='get_exam_questions') THEN
    RAISE EXCEPTION 'get_exam_questions() not found — run sql/020 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. The fourth question type
-- ---------------------------------------------------------------------
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_type_chk;
ALTER TABLE public.questions ADD CONSTRAINT questions_type_chk
  CHECK (question_type IN ('multiple_choice','multi_select','essay','worked_solution'));

-- ---------------------------------------------------------------------
-- 2. The columns
-- ---------------------------------------------------------------------
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS marks         integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS work_given    text,
  ADD COLUMN IF NOT EXISTS work_variable text,
  ADD COLUMN IF NOT EXISTS work_rubric   jsonb;

COMMENT ON COLUMN public.questions.marks IS
  'What this item is worth. 1 for every item that is not a worked solution, which keeps score_answers() (a count of items) and a sum of marks identical for existing papers.';
COMMENT ON COLUMN public.questions.work_given IS
  'The problem as LaTeX, e.g. y = 5x. Public: it is the question. Seeds the first line of the student''s working so their opening step is checkable.';
COMMENT ON COLUMN public.questions.work_variable IS
  'The variable to work with respect to. Public. Defaults to x when blank.';
COMMENT ON COLUMN public.questions.work_rubric IS
  'THE KEY for a worked item: {"steps":[{"latex":"y''=5","marks":2,"label":"Final answer"}],"penaltyPerBrokenStep":1}. The last step is the answer and is held to a stricter test (it must be written out, not merely equivalent). Never readable by anon.';

-- marks must be a real, positive number of marks.
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_marks_chk;
ALTER TABLE public.questions ADD CONSTRAINT questions_marks_chk
  CHECK (marks >= 1 AND marks <= 100);

-- A worked item needs a rubric with at least one step; nothing else may carry
-- one, so there is never a question about which column marks an item.
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_rubric_matches_type_chk;
ALTER TABLE public.questions ADD CONSTRAINT questions_rubric_matches_type_chk
  CHECK (
    CASE WHEN coalesce(question_type,'multiple_choice') = 'worked_solution'
         THEN work_rubric IS NOT NULL
              AND jsonb_typeof(work_rubric -> 'steps') = 'array'
              AND jsonb_array_length(work_rubric -> 'steps') > 0
         ELSE work_rubric IS NULL
    END
  );

-- A worked item keys on neither of the choice columns.
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_key_matches_type_chk;
ALTER TABLE public.questions ADD CONSTRAINT questions_key_matches_type_chk
  CHECK (
    CASE coalesce(question_type,'multiple_choice')
         WHEN 'multi_select'    THEN correct_answers IS NOT NULL AND correct_answer IS NULL
         WHEN 'worked_solution' THEN correct_answers IS NULL     AND correct_answer IS NULL
         ELSE correct_answers IS NULL
    END
  );

-- ---------------------------------------------------------------------
-- 3. The rubric stays out of a student's browser
-- ---------------------------------------------------------------------
-- 003 left anon with a column allow-list, which a new column does not join.
-- Said out loud anyway, so a later GRANT SELECT on the whole table cannot
-- quietly hand the working over.
REVOKE SELECT (work_rubric) ON public.questions FROM anon;
GRANT ALL ON public.questions TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Where a student's working is kept
-- ---------------------------------------------------------------------
-- While the paper is being sat: alongside the essay column it mirrors.
ALTER TABLE public.live_sessions
  ADD COLUMN IF NOT EXISTS work_answers_json jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.live_sessions.work_answers_json IS
  'Working in progress: { "<question_id>": { "lines": ["y=5x", "y''=5"] } }. Autosaved like essay_answers_json so a reload mid-paper loses nothing.';

-- After submission: the marks, on the row that carries the rest of the result.
ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS work_marks     numeric,
  ADD COLUMN IF NOT EXISTS work_total     numeric,
  ADD COLUMN IF NOT EXISTS work_marked_at timestamptz;

ALTER TABLE public.review_attempts
  ADD COLUMN IF NOT EXISTS work_marks     numeric,
  ADD COLUMN IF NOT EXISTS work_total     numeric,
  ADD COLUMN IF NOT EXISTS work_marked_at timestamptz;

COMMENT ON COLUMN public.results.work_marks IS
  'Marks earned on worked items. NULL means not marked yet — deliberately distinct from 0, which means marked and earned nothing.';
COMMENT ON COLUMN public.results.work_total IS
  'Marks available on worked items in this paper, as it stood when marked.';

-- ---------------------------------------------------------------------
-- 5. The paper a student is served
-- ---------------------------------------------------------------------
-- 020 defined this most recently; this is that body with the three PUBLIC
-- worked-item columns added. work_rubric is absent, and absent by
-- construction rather than by filter: this function names the columns a
-- student may see, so a column nobody added here is withheld.
DROP FUNCTION IF EXISTS public.get_exam_questions(uuid, uuid, text);
CREATE FUNCTION public.get_exam_questions(
  p_assessment_id uuid,
  p_student_id    uuid,
  p_session_token text
) RETURNS TABLE (
  id              uuid,
  exam_id         uuid,
  assessment_id   uuid,
  question_number integer,
  question_text   text,
  question_type   text,
  category        text,
  choices         jsonb,
  choice_a        text,
  choice_b        text,
  choice_c        text,
  choice_d        text,
  choice_e        text,
  image_url       text,
  created_at      timestamptz,
  marks           integer,
  work_given      text,
  work_variable   text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student  uuid;
  v_paper    public.assessments%ROWTYPE;
  v_sections text;
  v_sitting  boolean;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_paper FROM public.assessments a WHERE a.id = p_assessment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That assessment no longer exists.' USING ERRCODE = '42704';
  END IF;

  SELECT u.section INTO v_sections FROM public.users u WHERE u.id = v_student;
  IF NOT public.sections_overlap(v_sections, v_paper.target_section) THEN
    RAISE EXCEPTION 'This assessment is not for your section.' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.live_sessions ls
    WHERE ls.student_id = v_student
      AND ls.exam_id = p_assessment_id
      AND ls.status IS DISTINCT FROM 'finished'
  ) INTO v_sitting;

  IF NOT v_sitting AND NOT public.assessment_is_available(
       v_paper.is_open, v_paper.opens_at, v_paper.closes_at, v_paper.archived_at) THEN
    RAISE EXCEPTION 'This assessment is not open.' USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_paper.has_password, false) AND NOT v_sitting THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.exam_unlocks x
      WHERE x.assessment_id = p_assessment_id AND x.student_id = v_student
    ) THEN
      RAISE EXCEPTION 'Enter the exam password first.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT q.id, q.exam_id, q.assessment_id, q.question_number, q.question_text,
         coalesce(q.question_type, 'multiple_choice'), q.category, q.choices,
         q.choice_a, q.choice_b, q.choice_c, q.choice_d, q.choice_e,
         q.image_url, q.created_at,
         coalesce(q.marks, 1), q.work_given, coalesce(q.work_variable, 'x')
  FROM public.questions q
  WHERE q.exam_id = p_assessment_id OR q.assessment_id = p_assessment_id
  ORDER BY q.question_number NULLS LAST, q.id;
END $$;

GRANT EXECUTE ON FUNCTION public.get_exam_questions(uuid, uuid, text) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. A worked item is not a picked one
-- ---------------------------------------------------------------------
-- 018 defined score_answers() most recently; this is that body with worked
-- items excluded alongside essays. Without this they would count towards
-- total_items and be permanently wrong, dragging every score down.
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
      AND coalesce(q.question_type,'multiple_choice') NOT IN ('essay','worked_solution')
  ), judged AS (
    SELECT mc.id, mc.is_multi,
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
           'is_correct', is_correct
         )) FILTER (WHERE chosen_set IS NOT NULL), '{}'::jsonb)
  FROM judged;
$$;

REVOKE EXECUTE ON FUNCTION public.score_answers(uuid,jsonb) FROM anon;

-- ---------------------------------------------------------------------
-- 7. Answer review skips worked items too
-- ---------------------------------------------------------------------
-- 018 defined this most recently; the only change is the type filter. A
-- worked item has no `correct` index to reveal, and its marking is the
-- instructor's, so it has no place on the student's answer-review screen.
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
        AND coalesce(q.question_type,'multiple_choice') NOT IN ('essay','worked_solution')
    ) s
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_answer_review(uuid,uuid,integer) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Writing the marks back
-- ---------------------------------------------------------------------
-- Called by the instructor's dashboard once it has marked the working. It is
-- authenticated-only and re-checks ownership of the paper, so the arithmetic
-- may happen in a browser without the WRITE being something any browser can
-- do: a student's anon session cannot execute this at all.
--
-- p_items is { "<question_id>": {"marks":2,"total":3,"reason":"…"} }. It is
-- merged into the stored answers_json rather than replacing it, so marking
-- one item never disturbs the multiple-choice results sitting beside it.
CREATE OR REPLACE FUNCTION public.record_work_marks(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_items         jsonb,
  p_attempt_no    integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_marks numeric; v_total numeric; v_patch jsonb; v_touched int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = p_assessment_id
      AND (a.instructor_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.exam_shares s
                      WHERE s.exam_id = a.id AND s.shared_with = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'You do not have access to this assessment';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'p_items must be an object keyed by question id';
  END IF;

  -- Each item is stamped so the dashboard can tell a mark it computed from
  -- one an instructor typed over the top of it.
  SELECT jsonb_object_agg(k, v || jsonb_build_object('type','worked')),
         sum((v ->> 'marks')::numeric),
         sum((v ->> 'total')::numeric)
    INTO v_patch, v_marks, v_total
  FROM jsonb_each(p_items) AS e(k, v);

  UPDATE public.results r
     SET answers_json   = coalesce(r.answers_json, '{}'::jsonb) || coalesce(v_patch, '{}'::jsonb),
         work_marks     = v_marks,
         work_total     = v_total,
         work_marked_at = now()
   WHERE r.student_id = p_student_id AND r.assessment_id = p_assessment_id;
  GET DIAGNOSTICS v_touched = ROW_COUNT;

  IF p_attempt_no IS NOT NULL THEN
    UPDATE public.review_attempts ra
       SET answers_json   = coalesce(ra.answers_json, '{}'::jsonb) || coalesce(v_patch, '{}'::jsonb),
           work_marks     = v_marks,
           work_total     = v_total,
           work_marked_at = now()
     WHERE ra.student_id = p_student_id AND ra.assessment_id = p_assessment_id
       AND ra.attempt_no = p_attempt_no;
    GET DIAGNOSTICS v_touched = ROW_COUNT;
  END IF;

  IF v_touched = 0 THEN
    RAISE EXCEPTION 'No submission found for that student on this assessment';
  END IF;

  RETURN jsonb_build_object(
    'marks', v_marks, 'total', v_total,
    'items', (SELECT count(*) FROM jsonb_object_keys(p_items))
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.record_work_marks(uuid,uuid,jsonb,integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.record_work_marks(uuid,uuid,jsonb,integer) TO authenticated;

-- ---------------------------------------------------------------------
-- 9. Copying a paper carries the working
-- ---------------------------------------------------------------------
-- 018 defined this most recently; this is that body with the four new
-- columns added. Without it a duplicated paper's worked items would arrive
-- without a rubric and be rejected by questions_rubric_matches_type_chk.
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

  INSERT INTO public.questions
    (exam_id, assessment_id, question_number, question_text, question_type,
     category, choices, correct_answer, correct_answers, image_url,
     marks, work_given, work_variable, work_rubric)
  SELECT new_id, new_id, q.question_number, q.question_text, q.question_type,
         q.category, q.choices, q.correct_answer, q.correct_answers, q.image_url,
         coalesce(q.marks, 1), q.work_given, q.work_variable, q.work_rubric
  FROM public.questions q WHERE q.exam_id = p_source_id;

  RETURN new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.duplicate_assessment(uuid,text,text,boolean,boolean,text) TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. Nothing was converted, and every existing item is worth exactly 1 mark,
--    which is what makes a sum of marks agree with the old count of items.
SELECT count(*)                                               AS questions,
       count(*) FILTER (WHERE question_type='worked_solution') AS worked,
       count(*) FILTER (WHERE work_rubric IS NOT NULL)         AS carrying_a_rubric,
       count(*) FILTER (WHERE marks <> 1)                      AS not_worth_one
FROM public.questions;
-- worked, carrying_a_rubric and not_worth_one must all be 0 right after this runs.

-- 2. The rubric is not readable by anon; the three public columns are not
--    granted on the table either, because students read them through
--    get_exam_questions() and nothing else.
SELECT string_agg(column_name, ', ' ORDER BY column_name) AS anon_readable
FROM information_schema.column_privileges
WHERE grantee='anon' AND table_name='questions' AND privilege_type='SELECT';
-- work_rubric must NOT appear.

-- 3. The paper a student is served carries the public columns and not the key.
SELECT string_agg(parameter_name, ', ' ORDER BY ordinal_position) AS returns
FROM information_schema.parameters
WHERE specific_schema='public' AND parameter_mode='TABLE'
  AND specific_name LIKE 'get_exam_questions%';
-- marks, work_given and work_variable present; work_rubric absent.

-- 4. Marking a paper still counts items, and ignores worked ones.
SELECT prosrc LIKE '%NOT IN (''essay'',''worked_solution'')%' AS worked_items_excluded
FROM pg_proc WHERE proname = 'score_answers';
-- must be true.

-- 5. Only an authenticated instructor can write marks.
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'record_work_marks';
-- authenticated only; anon must not appear.
