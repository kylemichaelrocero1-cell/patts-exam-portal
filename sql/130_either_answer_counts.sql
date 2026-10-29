-- =====================================================================
-- 130 — A one-answer question can have more than one right choice
--
-- Run once in the Supabase SQL editor, BEFORE the dashboard that writes
-- accepted_answers is pushed. Safe to run twice.
--
-- A multiple-choice item still shows radio buttons and takes one pick, but
-- more than one choice may now earn it: when two options are both
-- defensible, or the key turns out to be wrong after a paper is sat. This
-- is not a multi-answer item (sql/018), where the student must tick every
-- right box; here any one of the accepted choices is right.
--
--   1. questions.accepted_answers: the other choices that also count, as a
--      jsonb array of choice indices; NULL is none. Only on a
--      multiple_choice item. Instructors read and write it under the
--      table's existing grants; students never read questions (sql/021).
--   2. score_answers() takes them: one choice picked, and it is the key or
--      an accepted one. A multi-answer item is marked exactly as before.
--   3. get_answer_review() sends them as also_correct, under the same rule
--      as the key (shown when the paper shows answers, or the item is right).
--   4. duplicate_paper() copies them.
--
-- The dashboard's copy of the rule is isAnswerCorrect() in src/lib/answers.js
-- (sql/test/either_answer.test.mjs runs both).
-- =====================================================================

BEGIN;

ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS accepted_answers jsonb;
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_accepted_answers_chk;
ALTER TABLE public.questions ADD CONSTRAINT questions_accepted_answers_chk
  CHECK (accepted_answers IS NULL
         OR (coalesce(question_type, 'multiple_choice') = 'multiple_choice'
             AND jsonb_typeof(accepted_answers) = 'array'
             AND jsonb_array_length(accepted_answers) > 0));
COMMENT ON COLUMN public.questions.accepted_answers IS
  'Other choices (indices) that also earn a one-answer item; NULL is none (sql/130).';

CREATE OR REPLACE FUNCTION public.score_answers(
  p_assessment_id uuid, p_answers jsonb, p_set text DEFAULT NULL
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
                -- 130: the key and any other choice that also counts.
                ELSE public.answer_index_set(jsonb_build_array(q.correct_answer) || coalesce(q.accepted_answers, '[]'::jsonb))
           END AS key_set
    FROM public.questions q
    WHERE q.exam_id = p_assessment_id
      AND coalesce(q.question_type,'multiple_choice') NOT IN ('essay','worked_solution')
      AND public.question_in_set(q.set_label, p_set)
  ), judged AS (
    SELECT mc.id, mc.is_multi, mc.marks,
           public.answer_index_set(p_answers -> mc.id::text) AS chosen_set,
           CASE WHEN public.answer_index_set(p_answers -> mc.id::text) IS NULL THEN NULL
                WHEN mc.is_multi THEN public.answer_index_set(p_answers -> mc.id::text) = mc.key_set
                -- One choice picked, and it is one that counts (130).
                ELSE cardinality(public.answer_index_set(p_answers -> mc.id::text)) = 1
                     AND public.answer_index_set(p_answers -> mc.id::text) <@ mc.key_set
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

CREATE OR REPLACE FUNCTION public.get_answer_review(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_attempt_no    integer,
  p_session_token text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student uuid;
  reveal    boolean;
  show_key  boolean;
  ans       jsonb;
  v_set     text;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  SELECT show_answers, review_shows_key INTO reveal, show_key
  FROM public.assessments WHERE id = p_assessment_id;
  IF NOT coalesce(reveal, false) THEN
    RAISE EXCEPTION 'Answers are not available for this assessment';
  END IF;
  show_key := coalesce(show_key, true);

  SELECT ra.answers_json INTO ans
  FROM public.review_attempts ra
  WHERE ra.student_id = v_student AND ra.assessment_id = p_assessment_id
    AND (p_attempt_no IS NULL OR ra.attempt_no = p_attempt_no)
  ORDER BY ra.attempt_no DESC LIMIT 1;

  IF ans IS NULL THEN
    SELECT r.answers_json INTO ans FROM public.results r
    WHERE r.student_id = v_student AND r.assessment_id = p_assessment_id;
  END IF;

  IF ans IS NULL THEN
    RAISE EXCEPTION 'Submit this assessment before viewing the answers';
  END IF;

  -- Only the set this student sat (116), and the items in every set.
  SELECT c.set_label INTO v_set FROM public.paper_set_choices c
   WHERE c.assessment_id = p_assessment_id AND c.student_id = v_student;

  RETURN (
    SELECT coalesce(jsonb_agg(x ORDER BY (x->>'question_number')::int NULLS LAST), '[]'::jsonb)
    FROM (
      -- Picked items. The key goes only where it may: always on a paper
      -- that shows it, otherwise only on an item already answered right
      -- (where it is the student's own answer back).
      SELECT jsonb_build_object(
        'question_id', q.id, 'question_number', q.question_number,
        'question_text', q.question_text,
        'question_type', coalesce(q.question_type,'multiple_choice'),
        'choices', q.choices,
        'correct', CASE WHEN show_key OR ok THEN to_jsonb(q.correct_answer) END,
        'marks', coalesce(q.marks, 1),
        'correct_set', CASE
          WHEN coalesce(q.question_type,'multiple_choice') = 'multi_select' AND (show_key OR ok)
          THEN coalesce(to_jsonb(public.answer_index_set(q.correct_answers)), '[]'::jsonb)
        END,
        -- Other choices that also count on a one-answer item (130).
        'also_correct', CASE
          WHEN coalesce(q.question_type,'multiple_choice') = 'multiple_choice' AND q.accepted_answers IS NOT NULL AND (show_key OR ok)
          THEN to_jsonb(public.answer_index_set(q.accepted_answers))
        END,
        'chosen', ans -> q.id::text -> 'chosen',
        'is_correct', ok,
        'key_hidden', NOT (show_key OR ok)
      ) AS x
      FROM public.questions q
      CROSS JOIN LATERAL (SELECT coalesce((ans -> q.id::text ->> 'is_correct')::boolean, false) AS ok) k
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') NOT IN ('essay','worked_solution')
        AND public.question_in_set(q.set_label, v_set)

      UNION ALL

      -- Worked items: the problem, every line written, which step each line
      -- was, what it earned, and — where allowed — the answer. The accept
      -- lists and the intermediate steps of the rubric are NOT released.
      SELECT jsonb_build_object(
        'question_id', q.id, 'question_number', q.question_number,
        'question_text', q.question_text,
        'question_type', 'worked_solution',
        'work_given', q.work_given,
        'work_mode', q.work_rubric ->> 'mode',
        'marks', coalesce(q.marks, 1),
        'earned', coalesce((ans -> q.id::text ->> 'marks')::numeric, 0),
        'chosen', (
          SELECT t FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(ans -> q.id::text -> 'lines') = 'array'
                        THEN ans -> q.id::text -> 'lines' ELSE '[]'::jsonb END)
                 WITH ORDINALITY AS e(t, ord)
           WHERE btrim(t) <> '' ORDER BY ord DESC LIMIT 1),
        'lines', CASE WHEN jsonb_typeof(ans -> q.id::text -> 'lines') = 'array'
                      THEN ans -> q.id::text -> 'lines' ELSE '[]'::jsonb END,
        'line_steps', ans -> q.id::text -> 'line_steps',
        'reason', ans -> q.id::text ->> 'reason',
        'correct_latex', CASE WHEN show_key OR ok THEN q.work_rubric -> 'steps' -> -1 ->> 'latex' END,
        -- The worked solution, step by step, for a line-by-line item — only
        -- on a paper that shows its key.
        'solution', CASE WHEN show_key AND q.work_rubric ->> 'mode' = 'lines'
                         THEN (SELECT jsonb_agg(s ->> 'latex' ORDER BY o)
                                 FROM jsonb_array_elements(q.work_rubric -> 'steps') WITH ORDINALITY AS z(s, o)) END,
        'is_correct', ok,
        'key_hidden', NOT (show_key OR ok)
      ) AS x
      FROM public.questions q
      CROSS JOIN LATERAL (SELECT coalesce((ans -> q.id::text ->> 'correct')::boolean, false) AS ok) k
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') = 'worked_solution'
        AND public.question_in_set(q.set_label, v_set)
    ) s
  );
END $$;

CREATE OR REPLACE FUNCTION public.duplicate_paper(
  p_source_id            uuid,
  p_new_title            text,
  p_target_section       text,
  p_target_instructor_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_owner uuid := coalesce(p_target_instructor_id, auth.uid());
  v_new   uuid;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_me) THEN
    RAISE EXCEPTION 'Only a signed-in instructor can duplicate a paper.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.assessments a
     WHERE a.id = p_source_id
       AND (a.instructor_id = v_me
            OR EXISTS (SELECT 1 FROM public.exam_shares s
                        WHERE s.exam_id = a.id AND s.shared_with = v_me))
  ) THEN
    RAISE EXCEPTION 'You can duplicate only a paper you own or one shared with you.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_owner) THEN
    RAISE EXCEPTION 'The instructor to give the copy to was not found.' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_new_title, '')) = '' OR btrim(coalesce(p_target_section, '')) = '' THEN
    RAISE EXCEPTION 'The copy needs a title and a section.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.assessments
    (kind, title, description, target_section, instructor_id, is_open,
     opens_at, closes_at, duration_minutes, exam_password, has_password,
     allow_retakes, show_answers, score_policy, review_shows_key,
     shuffle_choices, shuffle_questions, uses_sets)
  SELECT a.kind, btrim(p_new_title), a.description, btrim(p_target_section), v_owner, false,
         NULL, NULL, a.duration_minutes, a.exam_password, a.has_password,
         a.allow_retakes, a.show_answers, a.score_policy, a.review_shows_key,
         a.shuffle_choices, a.shuffle_questions, a.uses_sets
    FROM public.assessments a
   WHERE a.id = p_source_id
  RETURNING id INTO v_new;

  INSERT INTO public.questions
    (exam_id, assessment_id, question_number, question_text, question_type,
     category, choices, correct_answer, correct_answers, image_url,
     marks, work_given, work_variable, work_rubric, set_label, accepted_answers)
  SELECT v_new, v_new, q.question_number, q.question_text, q.question_type,
         q.category, q.choices, q.correct_answer, q.correct_answers, q.image_url,
         q.marks, q.work_given, q.work_variable, q.work_rubric, q.set_label, q.accepted_answers
    FROM public.questions q
   WHERE q.exam_id = p_source_id OR q.assessment_id = p_source_id;

  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.score_answers(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
            AND table_name = 'questions' AND column_name = 'accepted_answers')                     AS column_there,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_accepted_answers_chk')               AS constraint_there,
  NOT has_column_privilege('anon', 'public.questions', 'accepted_answers', 'SELECT')                  AS students_cannot_read_it,
  has_column_privilege('authenticated', 'public.questions', 'accepted_answers', 'UPDATE')             AS instructors_can_set_it,
  position('accepted_answers' in pg_get_functiondef('public.score_answers(uuid, jsonb, text)'::regprocedure)) > 0 AS scoring_uses_it,
  position('also_correct' in pg_get_functiondef('public.get_answer_review(uuid, uuid, integer, text)'::regprocedure)) > 0                AS review_sends_it,
  position('accepted_answers' in pg_get_functiondef('public.duplicate_paper(uuid, text, text, uuid)'::regprocedure)) > 0             AS duplicate_copies_it;
