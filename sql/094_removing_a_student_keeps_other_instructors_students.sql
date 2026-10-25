-- =====================================================================
-- 094 — removing a student takes them out of YOUR sections; it never
--       deletes another instructor's student or their results
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 001, 002 and 009. The dashboard's Delete buttons call
-- remove_students_from_my_sections(); until this runs they refuse with a
-- message instead of deleting, so the frontend may ship first.
--
-- A student is one row in public.users shared by every instructor who
-- teaches them: users.section holds all of their sections, "Esci 316 -1,
-- AENG 223L". The Students tab listed anyone holding one of your sections,
-- and its Delete removed the row, which cascades to every result, sitting,
-- attempt and lesson record the student has under every instructor, and
-- nothing in Postgres asked whose they were. In October 2026 one instructor
-- deleted a class list this way, and every student on it who was also in a
-- colleague's course lost their account and all of that course's results.
--
-- Now:
--   1. Instructors cannot DELETE (or TRUNCATE) users. The only way to remove
--      a student is remove_students_from_my_sections(ids), which takes the
--      caller's sections out of each student's list and:
--        - leaves the account alone when other sections remain;
--        - keeps the account, with no section, when the student has any
--          result, attempt, sitting or lesson record that is not the
--          caller's — someone else's work is never deleted;
--        - deletes the account only when nothing of anyone else's is left.
--   2. A section someone holds may only be taken OFF a student by an
--      instructor who holds it (trigger). Adding is free, as the import and
--      the roster need, and so is dropping a section nobody holds.
--   3. A result or a sitting may only be deleted by someone who can manage
--      its paper: the owner, a share, or a colleague-granted co-instructor
--      (the same three as 009's update policies). RESTRICTIVE, so it narrows
--      whatever permissive policy production carries without naming it.
--
-- The SQL editor and SECURITY DEFINER functions run as postgres and are not
-- held to any of this.
-- =====================================================================

BEGIN;

-- ---- the sections an instructor holds --------------------------------
-- The dashboard's own definition (AdminDashboard fetchDashboardData): every
-- section_instructors row naming them — self-claimed or granted — plus every
-- section their papers target.
CREATE OR REPLACE FUNCTION public.my_sections()
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT btrim(si.section_name) FROM public.section_instructors si
   WHERE si.instructor_id = auth.uid() AND btrim(si.section_name) <> ''
  UNION
  SELECT btrim(t.x) FROM public.assessments a,
         unnest(string_to_array(coalesce(a.target_section, ''), ',')) AS t(x)
   WHERE a.instructor_id = auth.uid() AND btrim(t.x) <> ''
  UNION
  SELECT btrim(t.x) FROM public.exams e,
         unnest(string_to_array(coalesce(e.target_section, ''), ',')) AS t(x)
   WHERE e.instructor_id = auth.uid() AND btrim(t.x) <> ''
$$;

REVOKE ALL ON FUNCTION public.my_sections() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_sections() TO authenticated;

-- Whether any instructor holds a section. One nobody holds (a typo, a class
-- that has ended) is nobody's to protect.
CREATE OR REPLACE FUNCTION public.section_is_held(p_section text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.section_instructors si
                  WHERE btrim(si.section_name) = btrim(p_section))
      OR EXISTS (SELECT 1 FROM public.assessments a,
                        unnest(string_to_array(coalesce(a.target_section, ''), ',')) AS t(x)
                  WHERE btrim(t.x) = btrim(p_section))
      OR EXISTS (SELECT 1 FROM public.exams e,
                        unnest(string_to_array(coalesce(e.target_section, ''), ',')) AS t(x)
                  WHERE btrim(t.x) = btrim(p_section))
$$;

REVOKE ALL ON FUNCTION public.section_is_held(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.section_is_held(text) TO authenticated;

-- ---- who may delete a paper's results and sittings -------------------
CREATE OR REPLACE FUNCTION public.can_manage_paper(p_paper uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM (SELECT a.instructor_id, a.target_section FROM public.assessments a WHERE a.id = p_paper
            UNION ALL
            SELECT e.instructor_id, e.target_section FROM public.exams e WHERE e.id = p_paper) p
     WHERE p.instructor_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.exam_shares s
                    WHERE s.exam_id = p_paper AND s.shared_with = auth.uid())
        OR EXISTS (SELECT 1 FROM public.section_instructors si
                    WHERE si.instructor_id = auth.uid()
                      AND si.added_by <> si.instructor_id
                      AND si.section_name <> ''
                      AND si.section_name = ANY (
                        SELECT btrim(t.x)
                          FROM unnest(string_to_array(coalesce(p.target_section, ''), ',')) AS t(x)))
  )
$$;

REVOKE ALL ON FUNCTION public.can_manage_paper(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_paper(uuid) TO authenticated;

DROP POLICY IF EXISTS results_delete_by_paper ON public.results;
CREATE POLICY results_delete_by_paper ON public.results
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.can_manage_paper(coalesce(assessment_id, exam_id)));

DROP POLICY IF EXISTS live_sessions_delete_by_paper ON public.live_sessions;
CREATE POLICY live_sessions_delete_by_paper ON public.live_sessions
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.can_manage_paper(coalesce(assessment_id, exam_id)));

-- TRUNCATE skips RLS altogether. Nothing in the app uses it.
REVOKE TRUNCATE ON public.results, public.live_sessions FROM authenticated, anon;

-- ---- nobody deletes a student directly -------------------------------
REVOKE DELETE, TRUNCATE ON public.users FROM authenticated, anon;

-- ---- a section comes off a student only by its holder ---------------
-- Not SECURITY DEFINER: current_user has to be the caller's role. Inside the
-- function below (definer) and in the SQL editor it is postgres, and passes.
CREATE OR REPLACE FUNCTION public.users_section_keeps_others()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lost text[];
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(array_agg(o.s), '{}') INTO v_lost
    FROM (SELECT DISTINCT btrim(t.x) AS s
            FROM unnest(string_to_array(coalesce(OLD.section, ''), ',')) AS t(x)
           WHERE btrim(t.x) <> '') o
   WHERE o.s NOT IN (SELECT btrim(t.x)
                       FROM unnest(string_to_array(coalesce(NEW.section, ''), ',')) AS t(x))
     AND o.s NOT IN (SELECT m FROM public.my_sections() AS m)
     AND public.section_is_held(o.s);
  IF cardinality(v_lost) > 0 THEN
    RAISE EXCEPTION 'Only an instructor who holds % can remove a student from it.',
      array_to_string(v_lost, ', ')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_section_keeps_others ON public.users;
CREATE TRIGGER users_section_keeps_others
  BEFORE UPDATE OF section ON public.users
  FOR EACH ROW
  WHEN (OLD.section IS DISTINCT FROM NEW.section)
  EXECUTE FUNCTION public.users_section_keeps_others();

-- ---- the one way to remove students ---------------------------------
CREATE OR REPLACE FUNCTION public.remove_students_from_my_sections(p_student_ids uuid[])
RETURNS TABLE (student uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_me   uuid := auth.uid();
  v_mine text[];
  v_have text[];
  v_keep text[];
  r      record;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_me) THEN
    RAISE EXCEPTION 'Only a signed-in instructor can remove students.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(m), '{}') INTO v_mine FROM public.my_sections() AS m;

  FOR r IN
    SELECT u.id, u.section FROM public.users u
     WHERE u.id = ANY (coalesce(p_student_ids, '{}'))
     ORDER BY u.id
       FOR UPDATE
  LOOP
    SELECT coalesce(array_agg(t.s ORDER BY t.n), '{}') INTO v_have
      FROM (SELECT DISTINCT ON (btrim(x)) btrim(x) AS s, n
              FROM unnest(string_to_array(coalesce(r.section, ''), ',')) WITH ORDINALITY AS a(x, n)
             WHERE btrim(x) <> ''
             ORDER BY btrim(x), n) t;

    student := r.id;
    IF NOT (v_have && v_mine) THEN
      outcome := 'not_yours';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT coalesce(array_agg(h ORDER BY n), '{}') INTO v_keep
      FROM unnest(v_have) WITH ORDINALITY AS k(h, n)
     WHERE NOT (h = ANY (v_mine));

    IF cardinality(v_keep) > 0 THEN
      UPDATE public.users SET section = array_to_string(v_keep, ', ') WHERE id = r.id;
      outcome := 'section_removed';
    ELSIF EXISTS (SELECT 1 FROM public.results x
                    LEFT JOIN public.assessments a ON a.id = coalesce(x.assessment_id, x.exam_id)
                    LEFT JOIN public.exams e ON e.id = x.exam_id
                   WHERE x.student_id = r.id
                     AND coalesce(a.instructor_id, e.instructor_id) IS DISTINCT FROM v_me)
       OR EXISTS (SELECT 1 FROM public.live_sessions x
                    LEFT JOIN public.assessments a ON a.id = coalesce(x.assessment_id, x.exam_id)
                    LEFT JOIN public.exams e ON e.id = x.exam_id
                   WHERE x.student_id = r.id
                     AND coalesce(a.instructor_id, e.instructor_id) IS DISTINCT FROM v_me)
       OR EXISTS (SELECT 1 FROM public.review_attempts x
                    LEFT JOIN public.assessments a ON a.id = x.assessment_id
                   WHERE x.student_id = r.id
                     AND a.instructor_id IS DISTINCT FROM v_me)
       OR EXISTS (SELECT 1 FROM public.lesson_progress x
                    LEFT JOIN public.lessons l ON l.id = x.lesson_id
                   WHERE x.student_id = r.id
                     AND l.instructor_id IS DISTINCT FROM v_me)
    THEN
      UPDATE public.users SET section = NULL WHERE id = r.id;
      outcome := 'kept';
    ELSE
      DELETE FROM public.users WHERE id = r.id;
      outcome := 'deleted';
    END IF;
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.remove_students_from_my_sections(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_students_from_my_sections(uuid[]) TO authenticated;

COMMIT;

-- ---- VERIFY (read-only; every column should be true) -----------------
SELECT
  NOT has_table_privilege('authenticated', 'public.users', 'DELETE')           AS instructors_cannot_delete_students,
  NOT has_table_privilege('anon', 'public.users', 'DELETE')                    AS students_cannot_delete_students,
  has_function_privilege('authenticated',
    'public.remove_students_from_my_sections(uuid[])', 'EXECUTE')              AS remove_function_ready,
  NOT has_function_privilege('anon',
    'public.remove_students_from_my_sections(uuid[])', 'EXECUTE')              AS remove_function_not_for_anon,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'users_section_keeps_others'
            AND tgrelid = 'public.users'::regclass)                            AS section_guard_on,
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'results'
            AND policyname = 'results_delete_by_paper' AND permissive = 'RESTRICTIVE')
  AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'live_sessions'
            AND policyname = 'live_sessions_delete_by_paper' AND permissive = 'RESTRICTIVE')
                                                                                AS deletes_scoped_to_paper;
