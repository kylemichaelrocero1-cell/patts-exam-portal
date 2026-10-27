-- =====================================================================
-- 104 — deleting a student or a paper puts it in the Trash; nothing is
--       gone for good until it has sat there 30 days unrestored
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 094 (my_sections, remove_students_from_my_sections) and 015
-- (archived_at). Run it BEFORE the dashboard that comes with it: that
-- dashboard trashes through these functions and says so plainly if they
-- are missing, rather than falling back to deleting.
--
-- A delete click on the Students or Manage Exams tab used to be final: a
-- paper went with its questions and every result, and a student in none of
-- anyone else's sections went with their account. Now:
--
--   * trash_students(ids) takes the caller's sections off each student, as
--     094 did, and files what it took in public.trash. It never deletes an
--     account. restore_from_trash() puts the sections back.
--   * trash_papers(ids) closes and hides a paper the caller owns and files
--     it in public.trash. Its questions, results and sittings are untouched.
--     restore_from_trash() brings it back, closed, as it was.
--   * purge_expired_trash() does the real deleting, only for what has been
--     in the Trash 30 days: a paper is deleted with what it owns; a student
--     account is deleted only if it still has no section and nothing of
--     another instructor's (094's rule). The dashboard calls it on load.
--   * The API roles can no longer DELETE papers or call 094's instant
--     remove: the Trash is the only way out.
-- =====================================================================

BEGIN;

-- ---- the Trash --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trash (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('student', 'paper')),
  item_id     uuid NOT NULL,
  label       text NOT NULL DEFAULT '',
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  trashed_by  uuid NOT NULL,
  trashed_at  timestamptz NOT NULL DEFAULT now(),
  purge_after timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE UNIQUE INDEX IF NOT EXISTS trash_one_per_item
  ON public.trash (kind, item_id, trashed_by);
CREATE INDEX IF NOT EXISTS trash_by_purge ON public.trash (purge_after);

ALTER TABLE public.trash ENABLE ROW LEVEL SECURITY;

-- Read only. Rows are written by the functions below, never by a browser.
-- An instructor sees what they put in the Trash, and any paper they help
-- teach that someone put there — so a shared paper is hidden for all of
-- its instructors, not only the one who deleted it.
REVOKE ALL ON public.trash FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.trash TO authenticated;

DROP POLICY IF EXISTS trash_select ON public.trash;
CREATE POLICY trash_select ON public.trash FOR SELECT TO authenticated
  USING (trashed_by = auth.uid()
         OR (kind = 'paper' AND public.can_manage_paper(item_id)));

-- ---- students ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trash_students(p_student_ids uuid[])
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
  v_took text[];
  r      record;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_me) THEN
    RAISE EXCEPTION 'Only a signed-in instructor can remove students.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(m), '{}') INTO v_mine FROM public.my_sections() AS m;

  FOR r IN
    SELECT u.id, u.full_name, u.section FROM public.users u
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
      FROM unnest(v_have) WITH ORDINALITY AS k(h, n) WHERE NOT (h = ANY (v_mine));
    SELECT coalesce(array_agg(h ORDER BY n), '{}') INTO v_took
      FROM unnest(v_have) WITH ORDINALITY AS k(h, n) WHERE h = ANY (v_mine);

    UPDATE public.users SET section = nullif(array_to_string(v_keep, ', '), '') WHERE id = r.id;

    -- Removed twice inside 30 days: one entry, holding every section taken,
    -- and the 30 days start again.
    INSERT INTO public.trash AS tr (kind, item_id, label, detail, trashed_by)
    VALUES ('student', r.id, coalesce(r.full_name, ''), jsonb_build_object('sections', to_jsonb(v_took)), v_me)
    ON CONFLICT (kind, item_id, trashed_by) DO UPDATE
      SET detail = jsonb_build_object('sections', (
            SELECT coalesce(jsonb_agg(DISTINCT e.s), '[]'::jsonb)
              FROM jsonb_array_elements_text((tr.detail -> 'sections')
                                             || (EXCLUDED.detail -> 'sections')) AS e(s))),
          label = EXCLUDED.label,
          trashed_at = now(),
          purge_after = now() + interval '30 days';

    outcome := 'trashed';
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.trash_students(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_students(uuid[]) TO authenticated;

-- ---- papers -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trash_papers(p_paper_ids uuid[])
RETURNS TABLE (paper uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := auth.uid();
  v_id uuid;
  a    record;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_me) THEN
    RAISE EXCEPTION 'Only a signed-in instructor can delete papers.' USING ERRCODE = '42501';
  END IF;

  FOREACH v_id IN ARRAY coalesce(p_paper_ids, '{}') LOOP
    paper := v_id;
    SELECT x.id, x.title, x.instructor_id, x.is_open, x.archived_at INTO a
      FROM public.assessments x WHERE x.id = v_id FOR UPDATE;
    IF NOT FOUND OR a.instructor_id IS DISTINCT FROM v_me THEN
      outcome := 'not_yours';
      RETURN NEXT;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.trash t WHERE t.kind = 'paper' AND t.item_id = v_id) THEN
      outcome := 'already';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Closed and archived: the student side already treats an archived
    -- paper as gone, so nothing there needs to know about the Trash.
    UPDATE public.assessments
       SET is_open = false, archived_at = coalesce(archived_at, now())
     WHERE id = v_id;
    UPDATE public.exams SET is_open = false WHERE id = v_id;

    INSERT INTO public.trash (kind, item_id, label, detail, trashed_by)
    VALUES ('paper', v_id, coalesce(a.title, ''),
            jsonb_build_object('was_archived_at', a.archived_at), v_me);

    outcome := 'trashed';
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.trash_papers(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_papers(uuid[]) TO authenticated;

-- ---- restore ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_from_trash(p_trash_ids uuid[])
RETURNS TABLE (trash_id uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_me  uuid := auth.uid();
  t     record;
  v_now text[];
  v_add text[];
BEGIN
  IF v_me IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_me) THEN
    RAISE EXCEPTION 'Only a signed-in instructor can restore from the Trash.' USING ERRCODE = '42501';
  END IF;

  FOR t IN
    SELECT * FROM public.trash x WHERE x.id = ANY (coalesce(p_trash_ids, '{}')) ORDER BY x.trashed_at FOR UPDATE
  LOOP
    trash_id := t.id;
    -- Your own entries; and a paper's owner may bring back their paper
    -- whoever deleted it.
    IF t.trashed_by IS DISTINCT FROM v_me
       AND NOT (t.kind = 'paper' AND EXISTS (SELECT 1 FROM public.assessments a
                                               WHERE a.id = t.item_id AND a.instructor_id = v_me)) THEN
      outcome := 'not_yours';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF t.kind = 'paper' THEN
      UPDATE public.assessments
         SET archived_at = nullif(t.detail ->> 'was_archived_at', '')::timestamptz
       WHERE id = t.item_id;
      outcome := CASE WHEN FOUND THEN 'restored' ELSE 'gone' END;
    ELSE
      SELECT coalesce(array_agg(btrim(x)), '{}') INTO v_now
        FROM public.users u, unnest(string_to_array(coalesce(u.section, ''), ',')) AS s(x)
       WHERE u.id = t.item_id AND btrim(x) <> '';
      SELECT coalesce(array_agg(s), '{}') INTO v_add
        FROM jsonb_array_elements_text(t.detail -> 'sections') AS e(s)
       WHERE NOT (s = ANY (v_now));
      UPDATE public.users
         SET section = nullif(array_to_string(v_now || v_add, ', '), '')
       WHERE id = t.item_id;
      outcome := CASE WHEN FOUND THEN 'restored' ELSE 'gone' END;
    END IF;

    DELETE FROM public.trash WHERE id = t.id;
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.restore_from_trash(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_from_trash(uuid[]) TO authenticated;

-- ---- the real deleting, after 30 days --------------------------------
-- Anyone signed in may run it: it touches only what has waited its 30
-- days, and does the same whoever asks.
CREATE OR REPLACE FUNCTION public.purge_expired_trash()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t   record;
  n   integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = auth.uid()) THEN
    RAISE EXCEPTION 'Only a signed-in instructor can empty the Trash.' USING ERRCODE = '42501';
  END IF;

  FOR t IN SELECT * FROM public.trash WHERE purge_after <= now() ORDER BY purge_after FOR UPDATE SKIP LOCKED
  LOOP
    IF t.kind = 'paper' THEN
      -- Questions, results and sittings go with it by foreign key.
      DELETE FROM public.assessments WHERE id = t.item_id;
      DELETE FROM public.exams WHERE id = t.item_id;
    ELSIF NOT EXISTS (SELECT 1 FROM public.trash o
                       WHERE o.kind = 'student' AND o.item_id = t.item_id AND o.id <> t.id)
      AND EXISTS (SELECT 1 FROM public.users u
                   WHERE u.id = t.item_id AND btrim(coalesce(u.section, '')) = '')
      AND NOT EXISTS (SELECT 1 FROM public.results x
                        LEFT JOIN public.assessments a ON a.id = coalesce(x.assessment_id, x.exam_id)
                        LEFT JOIN public.exams e ON e.id = x.exam_id
                       WHERE x.student_id = t.item_id
                         AND coalesce(a.instructor_id, e.instructor_id) IS DISTINCT FROM t.trashed_by)
      AND NOT EXISTS (SELECT 1 FROM public.live_sessions x
                        LEFT JOIN public.assessments a ON a.id = coalesce(x.assessment_id, x.exam_id)
                        LEFT JOIN public.exams e ON e.id = x.exam_id
                       WHERE x.student_id = t.item_id
                         AND coalesce(a.instructor_id, e.instructor_id) IS DISTINCT FROM t.trashed_by)
      AND NOT EXISTS (SELECT 1 FROM public.review_attempts x
                        LEFT JOIN public.assessments a ON a.id = x.assessment_id
                       WHERE x.student_id = t.item_id
                         AND a.instructor_id IS DISTINCT FROM t.trashed_by)
      AND NOT EXISTS (SELECT 1 FROM public.lesson_progress x
                        LEFT JOIN public.lessons l ON l.id = x.lesson_id
                       WHERE x.student_id = t.item_id
                         AND l.instructor_id IS DISTINCT FROM t.trashed_by)
    THEN
      -- Back in no section, and nothing of anyone else's: 094's "deleted".
      -- Otherwise the account stays (it was re-enrolled, or a colleague's
      -- results hang on it) and only the Trash entry goes.
      DELETE FROM public.users WHERE id = t.item_id;
    END IF;
    DELETE FROM public.trash WHERE id = t.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.purge_expired_trash() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_expired_trash() TO authenticated;

-- ---- the Trash is the only way out -----------------------------------
REVOKE DELETE ON public.assessments, public.exams FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.remove_students_from_my_sections(uuid[]) FROM authenticated;

COMMIT;

-- ---- VERIFY (read-only; every column should be true) -----------------
SELECT
  to_regclass('public.trash') IS NOT NULL                                       AS trash_table_ready,
  has_table_privilege('authenticated', 'public.trash', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.trash', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.trash', 'DELETE')        AS trash_read_only_for_instructors,
  NOT has_table_privilege('anon', 'public.trash', 'SELECT')                     AS trash_hidden_from_students,
  has_function_privilege('authenticated', 'public.trash_students(uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.trash_papers(uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.restore_from_trash(uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.purge_expired_trash()', 'EXECUTE') AS trash_functions_ready,
  NOT has_function_privilege('anon', 'public.trash_students(uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.purge_expired_trash()', 'EXECUTE') AS not_for_students,
  NOT has_table_privilege('authenticated', 'public.assessments', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.exams', 'DELETE')       AS papers_not_deleted_directly,
  NOT has_function_privilege('authenticated',
    'public.remove_students_from_my_sections(uuid[])', 'EXECUTE')               AS no_instant_student_delete;
