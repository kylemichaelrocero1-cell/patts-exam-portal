-- =====================================================================
-- 118 — practice papers and retakes file again (fixes 115)
--
-- Run in the Supabase SQL editor NOW (runs as postgres). Idempotent.
--
-- 115's filing check read the paper from NEW.assessment_id or NEW.exam_id.
-- review_attempts — where every paper with retakes is filed — has no
-- exam_id column, and naming a field a row does not have is an error in
-- plpgsql, so since 115 ran every submission to such a paper (a student's
-- own, and Force Submit) was refused: record "new" has no field "exam_id".
-- results has both columns, so graded one-attempt papers were not hit.
-- The paper is now read through to_jsonb(NEW), which works for both.
-- Nothing else changes. Students' answers were kept in their sittings, so
-- submitting again (or Force Submit) files them.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.filed_after_admission()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- Read through jsonb: review_attempts has no exam_id column, and naming a
  -- field a row does not have is an error in plpgsql (sql/118).
  v_paper uuid := coalesce((to_jsonb(NEW) ->> 'assessment_id')::uuid, (to_jsonb(NEW) ->> 'exam_id')::uuid);
  v_on    boolean;
  v_since timestamptz;
BEGIN
  SELECT a.requires_admission, a.admission_since INTO v_on, v_since
    FROM public.assessments a WHERE a.id = v_paper;
  IF NOT coalesce(v_on, false) THEN RETURN NEW; END IF;
  -- The paper's instructors (force submit, scored uploads).
  IF auth.uid() IS NOT NULL AND public.can_manage_paper(v_paper) THEN RETURN NEW; END IF;
  -- Let in at least once.
  IF EXISTS (SELECT 1 FROM public.exam_admissions x
             WHERE x.assessment_id = v_paper AND x.student_id = NEW.student_id
               AND x.used_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  -- Sitting since before the switch went on.
  IF EXISTS (SELECT 1 FROM public.live_sessions ls
             WHERE ls.exam_id = v_paper AND ls.student_id = NEW.student_id
               AND ls.created_at < coalesce(v_since, 'infinity'::timestamptz)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Your instructor has not let you in to this paper.' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.filed_after_admission() FROM PUBLIC, anon, authenticated;

COMMIT;

-- VERIFY — one row, true.
SELECT prosrc NOT LIKE '%NEW.exam_id%' AND prosrc LIKE '%to_jsonb(NEW)%' AS reads_either_table
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'filed_after_admission';
