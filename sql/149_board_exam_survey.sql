-- =====================================================================
-- 149 — the board exam survey
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent. Needs 020
-- (student_from_token). Run it BEFORE the frontend that comes with it: the
-- Survey tab and the Board Survey page call these functions, and until they
-- exist both say the survey is not open yet.
--
-- WHY
--   Graduates who sat the board exam answer a short survey in the portal:
--   what came out, how well PATTS prepared them per subject, whether the mock
--   exams helped, and what they wish the aero faculty had done. The questions
--   live in src/lib/boardSurvey.js; `answers` holds them as JSON, so the next
--   survey needs no new migration, only a new survey id.
--
-- WHO SEES WHAT
--   board_survey_responses   no API role can read or write it directly.
--   save_my_board_survey()   a signed-in student saves their own answers;
--                            the session token proves who they are.
--   my_board_survey()        a student reads back their own answers.
--   board_survey_responses_for_faculty()
--                            instructors read every response. The student's
--                            name and section come back ONLY when they ticked
--                            "show my name". That rule lives here, not in
--                            React, because an instructor's browser could
--                            otherwise ask for the names.
--
-- One row per student per survey. The form saves at every step (completed_at
-- stays null until Submit), so a survey left halfway still counts. A student
-- whose account is later deleted leaves their answers behind, nameless.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'student_from_token') THEN
    RAISE EXCEPTION 'Run sql/020 first (student_from_token). Nothing was changed.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.board_survey_responses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey       text NOT NULL CHECK (survey ~ '^[a-z0-9_]{1,40}$'),
  student_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  answers      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT board_survey_one_per_student UNIQUE (survey, student_id)
);

CREATE INDEX IF NOT EXISTS board_survey_responses_survey_idx
  ON public.board_survey_responses (survey, updated_at DESC);

COMMENT ON TABLE public.board_survey_responses IS
  'Post-board exam survey (src/lib/boardSurvey.js). Reached only through the functions in sql/149.';

ALTER TABLE public.board_survey_responses ENABLE ROW LEVEL SECURITY;
-- No policies and no grants on purpose: the functions below are the only way in.
REVOKE ALL ON public.board_survey_responses FROM PUBLIC, anon, authenticated;

-- ---- a student saves ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_my_board_survey(
  p_student_id    uuid,
  p_session_token text,
  p_survey        text,
  p_answers       jsonb,
  p_final         boolean DEFAULT false
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student uuid;
  v_done    timestamptz;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.' USING ERRCODE = '28000';
  END IF;
  IF p_survey IS NULL OR p_survey !~ '^[a-z0-9_]{1,40}$' THEN
    RAISE EXCEPTION 'Unknown survey.' USING ERRCODE = '22023';
  END IF;
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN
    RAISE EXCEPTION 'Answers must be an object.' USING ERRCODE = '22023';
  END IF;
  -- Every text box is capped at 2000 characters in the form; this is the
  -- ceiling for the whole set, whatever a browser sends.
  IF octet_length(p_answers::text) > 65536 THEN
    RAISE EXCEPTION 'Your answers are too long. Please shorten them.' USING ERRCODE = '22001';
  END IF;

  INSERT INTO public.board_survey_responses AS r (survey, student_id, answers, completed_at)
  VALUES (p_survey, v_student, p_answers, CASE WHEN p_final THEN now() END)
  ON CONFLICT (survey, student_id) DO UPDATE
    SET answers      = EXCLUDED.answers,
        updated_at   = now(),
        -- Once submitted it stays submitted; a later edit only moves the time.
        completed_at = CASE WHEN p_final THEN now() ELSE r.completed_at END
  RETURNING r.completed_at INTO v_done;

  RETURN v_done;
END $$;

-- ---- a student reads back their own --------------------------------------
CREATE OR REPLACE FUNCTION public.my_board_survey(
  p_student_id    uuid,
  p_session_token text,
  p_survey        text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student uuid;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.' USING ERRCODE = '28000';
  END IF;
  RETURN (
    SELECT jsonb_build_object('answers', r.answers, 'completed_at', r.completed_at, 'updated_at', r.updated_at)
    FROM public.board_survey_responses r
    WHERE r.survey = p_survey AND r.student_id = v_student
  );
END $$;

-- ---- instructors read them all -------------------------------------------
DROP FUNCTION IF EXISTS public.board_survey_responses_for_faculty(text);
CREATE FUNCTION public.board_survey_responses_for_faculty(p_survey text)
RETURNS TABLE (
  id           uuid,
  student_name text,
  section      text,
  answers      jsonb,
  completed_at timestamptz,
  created_at   timestamptz,
  updated_at   timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can read survey answers.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.id,
         CASE WHEN r.answers #>> '{one,show_name}' = 'yes' THEN u.full_name END,
         CASE WHEN r.answers #>> '{one,show_name}' = 'yes' THEN u.section END,
         r.answers, r.completed_at, r.created_at, r.updated_at
  FROM public.board_survey_responses r
  LEFT JOIN public.users u ON u.id = r.student_id
  WHERE r.survey = p_survey
  ORDER BY r.updated_at DESC;
END $$;

REVOKE ALL ON FUNCTION public.save_my_board_survey(uuid, text, text, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_board_survey(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.board_survey_responses_for_faculty(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_board_survey(uuid, text, text, jsonb, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_board_survey(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.board_survey_responses_for_faculty(text) TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — every column should read true
-- =====================================================================
SELECT
  to_regclass('public.board_survey_responses') IS NOT NULL                                    AS table_exists,
  NOT has_table_privilege('anon', 'public.board_survey_responses', 'SELECT')                  AS students_cannot_read_table,
  NOT has_table_privilege('authenticated', 'public.board_survey_responses', 'SELECT')         AS instructors_cannot_read_table,
  NOT has_table_privilege('anon', 'public.board_survey_responses', 'INSERT')                  AS students_cannot_insert_directly,
  has_function_privilege('anon', 'public.save_my_board_survey(uuid, text, text, jsonb, boolean)', 'EXECUTE') AS students_can_save,
  has_function_privilege('anon', 'public.my_board_survey(uuid, text, text)', 'EXECUTE')       AS students_can_read_their_own,
  NOT has_function_privilege('anon', 'public.board_survey_responses_for_faculty(text)', 'EXECUTE') AS students_cannot_read_all,
  has_function_privilege('authenticated', 'public.board_survey_responses_for_faculty(text)', 'EXECUTE') AS instructors_can_read_all;
