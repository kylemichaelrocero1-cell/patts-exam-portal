-- =====================================================================
-- PATCH v2 — run this ONCE in the NEW project (jkzisorxeaogwosdzyru)
--
-- Corrects two mismatches found by comparing against the live old
-- project before migrating data:
--
--   1. questions.id must be UUID, not bigint. results.answers_json is
--      keyed by the question UUID, so a bigint id would orphan every
--      one of the 1,210 stored results.
--   2. questions.question_number + questions.category (populated on all
--      1,210 rows) and exams.description (11 rows) were missing.
--
-- The questions table is empty right now, so dropping it loses nothing.
-- =====================================================================

DROP TABLE IF EXISTS public.questions CASCADE;

CREATE TABLE public.questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id         uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  question_number integer,
  question_text   text NOT NULL,
  question_type   text NOT NULL DEFAULT 'multiple_choice',
  category        text,
  choice_a        text,
  choice_b        text,
  choice_c        text,
  choice_d        text,
  correct_answer  integer,
  image_url       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT questions_type_chk    CHECK (question_type IN ('multiple_choice','essay')),
  CONSTRAINT questions_correct_chk CHECK (correct_answer IS NULL OR correct_answer BETWEEN 0 AND 3)
);

CREATE INDEX questions_exam_id_idx  ON public.questions (exam_id);
CREATE INDEX questions_exam_num_idx ON public.questions (exam_id, question_number);

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY questions_anon_select ON public.questions
  FOR SELECT TO anon USING (true);
CREATE POLICY questions_auth_all ON public.questions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT ON public.questions TO anon;
GRANT ALL    ON public.questions TO authenticated;

-- exams.description — used by 11 existing exams
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;

REVOKE ALL ON public.exams FROM anon;
GRANT SELECT (id, title, description, target_section, instructor_id, is_open,
              duration_minutes, has_password, created_at)
  ON public.exams TO anon;

-- Keep duplicate_exam in step with the new columns
CREATE OR REPLACE FUNCTION public.duplicate_exam(
  p_source_exam_id       uuid,
  p_new_title            text,
  p_target_section       text,
  p_target_instructor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_exam_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.exams e
    WHERE e.id = p_source_exam_id
      AND (e.instructor_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.exam_shares s
                      WHERE s.exam_id = e.id AND s.shared_with = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'You do not have access to this exam';
  END IF;

  INSERT INTO public.exams (title, description, target_section, instructor_id,
                            is_open, duration_minutes, exam_password)
  SELECT p_new_title, e.description, p_target_section, p_target_instructor_id,
         false, e.duration_minutes, e.exam_password
  FROM public.exams e
  WHERE e.id = p_source_exam_id
  RETURNING id INTO new_exam_id;

  INSERT INTO public.questions (exam_id, question_number, question_text, question_type,
                                category, choice_a, choice_b, choice_c, choice_d,
                                correct_answer, image_url)
  SELECT new_exam_id, q.question_number, q.question_text, q.question_type,
         q.category, q.choice_a, q.choice_b, q.choice_c, q.choice_d,
         q.correct_answer, q.image_url
  FROM public.questions q
  WHERE q.exam_id = p_source_exam_id
  ORDER BY q.question_number NULLS LAST, q.created_at;

  RETURN new_exam_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.duplicate_exam(uuid, text, text, uuid) TO authenticated;
