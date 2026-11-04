-- =====================================================================
-- 139 — results, questions and lessons go to the Trash too
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent. Needs 104
-- (the Trash) and 094 (can_manage_paper). Run it just BEFORE the dashboard
-- that comes with it: that dashboard deletes through these functions and says
-- so plainly if they are missing, rather than falling back to deleting. Until
-- that dashboard is live, the old one's delete buttons for these three are
-- refused, and nothing is lost.
--
-- 104 gave papers and students 30 days in the Trash. A result, a question or
-- a lesson was still gone at the first click. Now:
--
--   * trash_result(student, paper) files the whole result and takes it out of
--     `results`, so the student can sit the paper again, as a delete always
--     allowed. Restore puts it back unless they have since sat again; then it
--     stays in the Trash until the newer result is dealt with.
--   * trash_questions(paper, ids) files those questions (NULL: all of the
--     paper's, for a CSV import that replaces them) as one entry. Restore puts
--     them back with their ids, so students' answers still line up.
--   * trash_lesson(lesson) files a lesson with its students' read progress.
--   * purge_expired_trash() lets go of the copy after 30 days.
--   * The API roles can no longer DELETE these three: the Trash is the way out.
--
-- The copy sits in trash.snapshot, which only instructors of that paper can
-- read, as they can read the original. The dashboard's list does not fetch it.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.trash') IS NULL THEN
    RAISE EXCEPTION 'Run sql/104 first. Nothing was changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'can_manage_paper') THEN
    RAISE EXCEPTION 'Run sql/094 first (can_manage_paper). Nothing was changed.';
  END IF;
END $$;

ALTER TABLE public.trash ADD COLUMN IF NOT EXISTS snapshot jsonb;
COMMENT ON COLUMN public.trash.snapshot IS
  'The row(s) as they were, for restore. Kept apart from detail so the Trash list stays small.';

ALTER TABLE public.trash DROP CONSTRAINT IF EXISTS trash_kind_check;
ALTER TABLE public.trash ADD CONSTRAINT trash_kind_check
  CHECK (kind IN ('student', 'paper', 'result', 'question', 'lesson'));

-- Everyone who teaches the paper sees its results and questions in the Trash,
-- whichever of them deleted it; a lesson's owner sees their lesson.
DROP POLICY IF EXISTS trash_select ON public.trash;
CREATE POLICY trash_select ON public.trash FOR SELECT TO authenticated
  USING (trashed_by = auth.uid()
         OR (kind = 'paper' AND public.can_manage_paper(item_id))
         OR (kind IN ('result', 'question')
             AND public.can_manage_paper(nullif(detail ->> 'paper_id', '')::uuid))
         OR (kind = 'lesson' AND detail ->> 'instructor_id' = auth.uid()::text));

-- ---- results ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trash_result(p_student uuid, p_paper uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me    uuid := auth.uid();
  r       public.results;
  v_row   jsonb;
  v_paper uuid;
  v_name  text;
  v_title text;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_me) THEN
    RAISE EXCEPTION 'Only a signed-in instructor can delete a result.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.results x
   WHERE x.student_id = p_student AND x.exam_id = p_paper FOR UPDATE;
  IF NOT FOUND THEN RETURN 'gone'; END IF;

  v_paper := coalesce(r.assessment_id, r.exam_id);
  IF NOT public.can_manage_paper(v_paper) THEN RETURN 'not_yours'; END IF;

  SELECT u.full_name INTO v_name FROM public.users u WHERE u.id = r.student_id;
  SELECT coalesce(a.title, e.title) INTO v_title
    FROM (SELECT v_paper AS id) k
    LEFT JOIN public.assessments a ON a.id = k.id
    LEFT JOIN public.exams e ON e.id = k.id;
  v_row := to_jsonb(r);

  INSERT INTO public.trash (kind, item_id, label, detail, snapshot, trashed_by)
  VALUES ('result', r.id, coalesce(v_name, ''),
          jsonb_build_object(
            'paper_id', v_paper, 'paper_title', coalesce(v_title, ''),
            'score', r.score, 'total_items', r.total_items,
            'points_earned', v_row -> 'points_earned', 'points_total', v_row -> 'points_total',
            'work_marks', v_row -> 'work_marks', 'work_total', v_row -> 'work_total'),
          v_row, v_me);

  DELETE FROM public.results WHERE id = r.id;
  RETURN 'trashed';
END $$;

REVOKE ALL ON FUNCTION public.trash_result(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_result(uuid, uuid) TO authenticated;

-- ---- questions --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trash_questions(p_paper uuid, p_ids uuid[] DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_rows  jsonb;
  v_count integer;
  v_first text;
  v_item  uuid;
  v_title text;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_me) THEN
    RAISE EXCEPTION 'Only a signed-in instructor can delete questions.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_manage_paper(p_paper) THEN RETURN 'not_yours'; END IF;

  -- Only ever this paper's questions, whatever ids are named.
  SELECT jsonb_agg(to_jsonb(q) ORDER BY q.question_number NULLS LAST, q.id), count(*),
         (array_agg(q.question_text ORDER BY q.question_number NULLS LAST, q.id))[1],
         (array_agg(q.id ORDER BY q.question_number NULLS LAST, q.id))[1]
    INTO v_rows, v_count, v_first, v_item
    FROM public.questions q
   WHERE (q.exam_id = p_paper OR q.assessment_id = p_paper)
     AND (p_ids IS NULL OR q.id = ANY (p_ids));
  IF coalesce(v_count, 0) = 0 THEN RETURN 'gone'; END IF;

  SELECT coalesce(a.title, e.title) INTO v_title
    FROM (SELECT p_paper AS id) k
    LEFT JOIN public.assessments a ON a.id = k.id
    LEFT JOIN public.exams e ON e.id = k.id;

  INSERT INTO public.trash (kind, item_id, label, detail, snapshot, trashed_by)
  VALUES ('question',
          CASE WHEN v_count = 1 THEN v_item ELSE gen_random_uuid() END,
          CASE WHEN v_count = 1 THEN left(coalesce(v_first, ''), 160) ELSE v_count || ' questions' END,
          jsonb_build_object('paper_id', p_paper, 'paper_title', coalesce(v_title, ''), 'count', v_count),
          v_rows, v_me)
  ON CONFLICT (kind, item_id, trashed_by) DO UPDATE
    SET label = EXCLUDED.label, detail = EXCLUDED.detail, snapshot = EXCLUDED.snapshot,
        trashed_at = now(), purge_after = now() + interval '30 days';

  DELETE FROM public.questions q
   WHERE (q.exam_id = p_paper OR q.assessment_id = p_paper)
     AND (p_ids IS NULL OR q.id = ANY (p_ids));
  RETURN 'trashed';
END $$;

REVOKE ALL ON FUNCTION public.trash_questions(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_questions(uuid, uuid[]) TO authenticated;

-- ---- lessons ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trash_lesson(p_lesson uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  l    public.lessons;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_me) THEN
    RAISE EXCEPTION 'Only a signed-in instructor can delete a lesson.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO l FROM public.lessons x WHERE x.id = p_lesson FOR UPDATE;
  IF NOT FOUND THEN RETURN 'gone'; END IF;
  IF l.instructor_id IS DISTINCT FROM v_me THEN RETURN 'not_yours'; END IF;

  INSERT INTO public.trash (kind, item_id, label, detail, snapshot, trashed_by)
  VALUES ('lesson', l.id, coalesce(l.title, ''),
          jsonb_build_object('instructor_id', l.instructor_id),
          jsonb_build_object(
            'lesson', to_jsonb(l),
            'progress', (SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
                           FROM public.lesson_progress p WHERE p.lesson_id = l.id)),
          v_me)
  ON CONFLICT (kind, item_id, trashed_by) DO UPDATE
    SET label = EXCLUDED.label, detail = EXCLUDED.detail, snapshot = EXCLUDED.snapshot,
        trashed_at = now(), purge_after = now() + interval '30 days';

  DELETE FROM public.lessons WHERE id = l.id;   -- its progress goes by foreign key
  RETURN 'trashed';
END $$;

REVOKE ALL ON FUNCTION public.trash_lesson(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_lesson(uuid) TO authenticated;

-- ---- restore ----------------------------------------------------------
-- 'restored', 'gone' (what it belonged to has been deleted for good),
-- 'not_yours', or 'taken' (the student has sat again; the entry stays).
CREATE OR REPLACE FUNCTION public.restore_from_trash(p_trash_ids uuid[])
RETURNS TABLE (trash_id uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_me    uuid := auth.uid();
  t       record;
  v_now   text[];
  v_add   text[];
  v_paper uuid;
  v_lesson public.lessons;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_me) THEN
    RAISE EXCEPTION 'Only a signed-in instructor can restore from the Trash.' USING ERRCODE = '42501';
  END IF;

  FOR t IN
    SELECT * FROM public.trash x WHERE x.id = ANY (coalesce(p_trash_ids, '{}')) ORDER BY x.trashed_at FOR UPDATE
  LOOP
    trash_id := t.id;
    outcome := NULL;

    IF t.kind IN ('result', 'question') THEN
      -- Whoever teaches the paper now, and nobody else: an instructor who has
      -- since lost the paper does not get to write into it.
      v_paper := nullif(t.detail ->> 'paper_id', '')::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.assessments a WHERE a.id = v_paper)
         AND NOT EXISTS (SELECT 1 FROM public.exams e WHERE e.id = v_paper) THEN
        -- The paper has been deleted for good. Only whoever filed this can see it.
        IF t.trashed_by IS DISTINCT FROM v_me THEN
          outcome := 'not_yours';
        ELSE
          DELETE FROM public.trash WHERE id = t.id;
          outcome := 'gone';
        END IF;
      ELSIF NOT public.can_manage_paper(v_paper) THEN
        outcome := 'not_yours';
      END IF;
    ELSIF t.kind = 'lesson' THEN
      IF t.trashed_by IS DISTINCT FROM v_me
         AND t.detail ->> 'instructor_id' IS DISTINCT FROM v_me::text THEN
        outcome := 'not_yours';
      END IF;
    -- Your own entries; and a paper's owner may bring back their paper
    -- whoever deleted it.
    ELSIF t.trashed_by IS DISTINCT FROM v_me
       AND NOT (t.kind = 'paper' AND EXISTS (SELECT 1 FROM public.assessments a
                                               WHERE a.id = t.item_id AND a.instructor_id = v_me)) THEN
      outcome := 'not_yours';
    END IF;
    IF outcome IS NOT NULL THEN
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF t.kind = 'paper' THEN
      UPDATE public.assessments
         SET archived_at = nullif(t.detail ->> 'was_archived_at', '')::timestamptz
       WHERE id = t.item_id;
      outcome := CASE WHEN FOUND THEN 'restored' ELSE 'gone' END;

    ELSIF t.kind = 'student' THEN
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

    ELSIF t.kind = 'result' THEN
      BEGIN
        INSERT INTO public.results
        SELECT r.* FROM jsonb_populate_record(NULL::public.results, t.snapshot) r;
        outcome := 'restored';
      EXCEPTION
        WHEN unique_violation THEN outcome := 'taken';
        WHEN foreign_key_violation THEN outcome := 'gone';
      END;

    ELSIF t.kind = 'question' THEN
      BEGIN
        INSERT INTO public.questions
        SELECT r.* FROM jsonb_array_elements(t.snapshot) e,
                        LATERAL jsonb_populate_record(NULL::public.questions, e) r
        ON CONFLICT (id) DO NOTHING;
        outcome := 'restored';
      EXCEPTION
        WHEN foreign_key_violation THEN outcome := 'gone';
      END;

    ELSE -- lesson
      v_lesson := jsonb_populate_record(NULL::public.lessons, t.snapshot -> 'lesson');
      -- Its subject may have been deleted since; the lesson outlives that,
      -- exactly as ON DELETE SET NULL would have left it.
      IF NOT EXISTS (SELECT 1 FROM public.lesson_subjects s WHERE s.id = v_lesson.subject_id) THEN
        v_lesson.subject_id := NULL;
      END IF;
      INSERT INTO public.lessons SELECT (v_lesson).* ON CONFLICT (id) DO NOTHING;
      -- Read progress, for the students who still exist.
      INSERT INTO public.lesson_progress
      SELECT r.* FROM jsonb_array_elements(t.snapshot -> 'progress') e,
                      LATERAL jsonb_populate_record(NULL::public.lesson_progress, e) r
       WHERE EXISTS (SELECT 1 FROM public.users u WHERE u.id = r.student_id)
      ON CONFLICT DO NOTHING;
      outcome := 'restored';
    END IF;

    IF outcome IS DISTINCT FROM 'taken' THEN
      DELETE FROM public.trash WHERE id = t.id;
    END IF;
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.restore_from_trash(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_from_trash(uuid[]) TO authenticated;

-- ---- the real deleting, after 30 days --------------------------------
-- As 104, with the student branch named: a result, question or lesson has
-- already left its table, so all that is left to let go of is the copy.
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
    ELSIF t.kind = 'student'
      AND NOT EXISTS (SELECT 1 FROM public.trash o
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
REVOKE DELETE ON public.results, public.questions, public.lessons FROM authenticated, anon;

COMMIT;

-- ---- VERIFY (read-only; every column should be true) -----------------
SELECT
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trash_kind_check'
            AND pg_get_constraintdef(oid) LIKE '%lesson%')                     AS trash_takes_every_kind,
  NOT has_column_privilege('anon', 'public.trash', 'snapshot', 'SELECT')       AS copies_hidden_from_students,
  has_function_privilege('authenticated', 'public.trash_result(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.trash_questions(uuid,uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.trash_lesson(uuid)', 'EXECUTE') AS trash_functions_ready,
  NOT has_function_privilege('anon', 'public.trash_result(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.trash_questions(uuid,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.trash_lesson(uuid)', 'EXECUTE') AS not_for_students,
  NOT has_table_privilege('authenticated', 'public.results', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.questions', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.lessons', 'DELETE')     AS not_deleted_directly,
  NOT has_table_privilege('anon', 'public.results', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.questions', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.lessons', 'DELETE')              AS not_deleted_by_students;
