-- =====================================================================
-- 150 — the board exam survey can be kept to chosen sections
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent. Needs 149
-- (the survey) and 094 (my_sections). Run it BEFORE the frontend that comes
-- with it; until then the Board Survey page says to run this file, and the
-- survey stays open to anyone with the link, as it was.
--
-- WHY
--   The survey link is posted in Google Classroom, and whoever has it could
--   answer, including students who have not sat the board exam. An
--   instructor can now keep it to the board review class, for example the
--   Pre-Boards section: only students in a chosen section can save answers,
--   and those students find a Survey tab in the portal without needing the
--   link.
--
-- HOW IT IS DECIDED
--   board_survey_settings   one row per survey: open to 'all' (anyone signed
--                           in, the default and the behaviour before this
--                           file) or to 'sections'.
--   board_survey_sections   the chosen sections, one row per section per
--                           instructor. Each instructor sets only their own
--                           rows, from the sections they hold, so nobody can
--                           undo a colleague's choice or see its names.
--   A student may answer when the survey is open to all, or when one of the
--   sections in users.section is among the chosen ones. The check sits in
--   save_my_board_survey() itself, so a browser cannot skip it.
--
--   Answers saved before the survey was narrowed stay, and instructors still
--   see them. A student outside the chosen sections can no longer change
--   theirs.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.board_survey_responses') IS NULL THEN
    RAISE EXCEPTION 'Run sql/149 first (the board exam survey). Nothing was changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'my_sections') THEN
    RAISE EXCEPTION 'Run sql/094 first (my_sections). Nothing was changed.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.board_survey_settings (
  survey     text PRIMARY KEY CHECK (survey ~ '^[a-z0-9_]{1,40}$'),
  open_to    text NOT NULL DEFAULT 'all' CHECK (open_to IN ('all', 'sections')),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.board_survey_sections (
  survey        text NOT NULL CHECK (survey ~ '^[a-z0-9_]{1,40}$'),
  section_name  text NOT NULL CHECK (btrim(section_name) <> '' AND section_name = btrim(section_name)),
  instructor_id uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (survey, section_name, instructor_id)
);

COMMENT ON TABLE public.board_survey_settings IS
  'Who can answer each board exam survey (sql/150). Reached only through its functions.';
COMMENT ON TABLE public.board_survey_sections IS
  'The sections a board exam survey is kept to, per instructor (sql/150). Reached only through its functions.';

ALTER TABLE public.board_survey_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_survey_sections ENABLE ROW LEVEL SECURITY;
-- No policies and no grants on purpose: the functions below are the only way in.
REVOKE ALL ON public.board_survey_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.board_survey_sections FROM PUBLIC, anon, authenticated;

-- ---- the rule -------------------------------------------------------------
-- Not granted to any API role: only the functions below call it.
CREATE OR REPLACE FUNCTION public.board_survey_restricted(p_survey text)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT s.open_to = 'sections' FROM public.board_survey_settings s
                    WHERE s.survey = p_survey), false)
$$;

CREATE OR REPLACE FUNCTION public.board_survey_student_may_answer(p_student uuid, p_survey text)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT NOT public.board_survey_restricted(p_survey)
      OR EXISTS (
           SELECT 1
             FROM public.users u,
                  unnest(string_to_array(coalesce(u.section, ''), ',')) AS t(x)
             JOIN public.board_survey_sections b
               ON b.survey = p_survey AND b.section_name = btrim(t.x)
            WHERE u.id = p_student)
$$;

REVOKE ALL ON FUNCTION public.board_survey_restricted(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.board_survey_student_may_answer(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---- a student saves: as in 149, plus the rule ----------------------------
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
  IF NOT public.board_survey_student_may_answer(v_student, p_survey) THEN
    RAISE EXCEPTION 'This survey is only for the board review class.' USING ERRCODE = '42501';
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

-- ---- a student reads back their own, and whether they may answer ----------
-- 149 returned null for a student with no answers yet. It now always returns
-- an object, so the form can tell "nothing saved" from "not for you".
CREATE OR REPLACE FUNCTION public.my_board_survey(
  p_student_id    uuid,
  p_session_token text,
  p_survey        text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student uuid;
  v_row     public.board_survey_responses%ROWTYPE;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_row FROM public.board_survey_responses r
   WHERE r.survey = p_survey AND r.student_id = v_student;
  RETURN jsonb_build_object(
    'answers',      v_row.answers,
    'completed_at', v_row.completed_at,
    'updated_at',   v_row.updated_at,
    'may_answer',   public.board_survey_student_may_answer(v_student, p_survey));
END $$;

-- ---- does this student get a Survey tab without the link? -----------------
-- Only when the survey is kept to chosen sections and they are in one. A
-- survey open to all stays behind its link, as before.
CREATE OR REPLACE FUNCTION public.board_survey_for_me(
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
  RETURN jsonb_build_object(
    'restricted', public.board_survey_restricted(p_survey),
    'may_answer', public.board_survey_student_may_answer(v_student, p_survey));
END $$;

-- ---- instructors: who can answer ------------------------------------------
-- `mine` is this instructor's chosen sections; `others` only counts the ones
-- colleagues chose, without naming them.
CREATE OR REPLACE FUNCTION public.board_survey_audience(p_survey text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can see who can answer the survey.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'open_to', CASE WHEN public.board_survey_restricted(p_survey) THEN 'sections' ELSE 'all' END,
    'mine', coalesce((SELECT jsonb_agg(b.section_name ORDER BY b.section_name)
                        FROM public.board_survey_sections b
                       WHERE b.survey = p_survey AND b.instructor_id = auth.uid()), '[]'::jsonb),
    'others', (SELECT count(DISTINCT b.section_name)::int
                 FROM public.board_survey_sections b
                WHERE b.survey = p_survey AND b.instructor_id <> auth.uid()
                  AND NOT EXISTS (SELECT 1 FROM public.board_survey_sections m
                                   WHERE m.survey = b.survey AND m.instructor_id = auth.uid()
                                     AND m.section_name = b.section_name)));
END $$;

CREATE OR REPLACE FUNCTION public.set_board_survey_audience(
  p_survey   text,
  p_open_to  text,
  p_sections text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me   uuid := auth.uid();
  v_list text[];
  v_bad  text;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_me) THEN
    RAISE EXCEPTION 'Only instructors can choose who can answer the survey.' USING ERRCODE = '42501';
  END IF;
  IF p_survey IS NULL OR p_survey !~ '^[a-z0-9_]{1,40}$' THEN
    RAISE EXCEPTION 'Unknown survey.' USING ERRCODE = '22023';
  END IF;
  IF p_open_to IS NULL OR p_open_to NOT IN ('all', 'sections') THEN
    RAISE EXCEPTION 'Choose who can answer: all, or chosen sections.' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(DISTINCT btrim(s)) FILTER (WHERE btrim(s) <> ''), '{}')
    INTO v_list FROM unnest(coalesce(p_sections, '{}')) AS t(s);

  -- Only sections this instructor holds (the dashboard's own list, sql/094).
  SELECT s INTO v_bad FROM unnest(v_list) AS t(s)
   WHERE s NOT IN (SELECT public.my_sections()) LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'You can only choose your own sections. "%" is not one of them.', v_bad USING ERRCODE = '42501';
  END IF;

  -- Kept even when the survey is open to all, so switching back remembers them.
  DELETE FROM public.board_survey_sections WHERE survey = p_survey AND instructor_id = v_me;
  INSERT INTO public.board_survey_sections (survey, section_name, instructor_id)
  SELECT p_survey, s, v_me FROM unnest(v_list) AS t(s);

  IF p_open_to = 'sections'
     AND NOT EXISTS (SELECT 1 FROM public.board_survey_sections b WHERE b.survey = p_survey) THEN
    RAISE EXCEPTION 'Pick at least one section, or nobody could answer.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.board_survey_settings AS s (survey, open_to, updated_by, updated_at)
  VALUES (p_survey, p_open_to, v_me, now())
  ON CONFLICT (survey) DO UPDATE
    SET open_to = EXCLUDED.open_to, updated_by = EXCLUDED.updated_by, updated_at = now();

  RETURN public.board_survey_audience(p_survey);
END $$;

REVOKE ALL ON FUNCTION public.save_my_board_survey(uuid, text, text, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_board_survey(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.board_survey_for_me(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.board_survey_audience(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_board_survey_audience(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_board_survey(uuid, text, text, jsonb, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_board_survey(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.board_survey_for_me(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.board_survey_audience(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_board_survey_audience(text, text, text[]) TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — every column should read true
-- =====================================================================
SELECT
  to_regclass('public.board_survey_settings') IS NOT NULL                                   AS settings_table_exists,
  to_regclass('public.board_survey_sections') IS NOT NULL                                   AS sections_table_exists,
  NOT has_table_privilege('anon', 'public.board_survey_sections', 'SELECT')                 AS students_cannot_read_sections,
  NOT has_table_privilege('authenticated', 'public.board_survey_settings', 'UPDATE')        AS instructors_cannot_write_directly,
  NOT has_function_privilege('anon', 'public.board_survey_student_may_answer(uuid, text)', 'EXECUTE') AS rule_is_internal,
  has_function_privilege('anon', 'public.board_survey_for_me(uuid, text, text)', 'EXECUTE') AS students_can_check_their_tab,
  NOT has_function_privilege('anon', 'public.set_board_survey_audience(text, text, text[])', 'EXECUTE') AS students_cannot_choose,
  has_function_privilege('authenticated', 'public.set_board_survey_audience(text, text, text[])', 'EXECUTE') AS instructors_can_choose,
  pg_get_functiondef('public.save_my_board_survey(uuid, text, text, jsonb, boolean)'::regprocedure)
    LIKE '%board_survey_student_may_answer%'                                                AS saving_checks_the_section;
