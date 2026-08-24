-- =====================================================================
-- PHASE 1 — assessments + lessons schema
-- Run in the Supabase SQL editor (runs as postgres, bypasses RLS).
-- Generated 2026-08-24.
--
-- SAFE TO RUN WHILE THE CURRENT APP IS LIVE. Nothing is dropped, renamed,
-- or rewritten. Every statement is idempotent — re-running changes nothing.
-- The app in production today does not know these tables exist and keeps
-- working against `exams` exactly as before.
--
-- WHAT THIS DOES
--   1. Creates `assessments` — one table for exams AND seatworks, with a
--      scheduling window (opens_at / closes_at).
--   2. Copies every row of `exams` into it, KEEPING THE SAME id. That is
--      the whole trick: because ids are preserved, questions.exam_id and
--      results.exam_id already point at the right assessment, so the
--      backfill is a straight copy and old/new code can coexist.
--   3. Adds a nullable `assessment_id` to questions / results /
--      live_sessions, backfills it, and adds the foreign keys.
--   4. Installs triggers so that while the OLD app is still writing to
--      `exams`, those writes are mirrored into `assessments` and new
--      child rows get their assessment_id filled in automatically.
--      Without this, `assessments` would go stale between this migration
--      and the code cutover. THESE TRIGGERS ARE REMOVED IN A LATER PHASE.
--   5. Creates the lessons tables (lesson_subjects / lessons /
--      lesson_progress), modelled on AeroHub's subjects → topics, with
--      markdown in `content_md`.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * does not drop or rename `exams` — it stays as the live table and
--     your rollback. Cutover happens in a later phase, once the new code
--     is deployed and you have confirmed the data looks right.
--   * does not touch existing RLS on existing tables.
--
-- ---------------------------------------------------------------------
-- REHEARSE IT FIRST (recommended)
-- ---------------------------------------------------------------------
-- This file was validated by parsing every statement with libpg_query,
-- PostgreSQL's own grammar, but it has NOT been executed against a real
-- Postgres — so rehearse it against your actual data before committing:
--
--   1. Change the single word  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file. It executes end to end against real production
--      data, prints the VERIFY results, then throws everything away.
--   3. Read the VERIFY output. Every check should say OK / 0.
--   4. Change ROLLBACK; back to COMMIT; and run it again for real.
--
-- Step 2 is completely safe: nothing is persisted. If any statement is
-- wrong, it errors inside the transaction and the database is untouched.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Sanity: refuse to run against a database that isn't what we expect
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='exams') THEN
    RAISE EXCEPTION 'public.exams not found — wrong database?';
  END IF;
END $$;

-- =====================================================================
-- 1. ASSESSMENTS
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.assessments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 'exam'     = the high-stakes, proctored thing that exists today
  -- 'seatwork' = shorter in-class work; same machinery, lower ceremony
  kind             text NOT NULL DEFAULT 'exam',

  title            text NOT NULL,
  description      text,
  target_section   text,                    -- comma-separated list, as elsewhere
  instructor_id    uuid,                    -- auth.uid() of the owner

  duration_minutes integer NOT NULL DEFAULT 60,

  -- Availability = master switch AND (optional) time window.
  -- Existing exams migrate in with a NULL window, so they behave exactly
  -- as they do today: governed by is_open alone.
  is_open          boolean NOT NULL DEFAULT false,
  opens_at         timestamptz,             -- NULL = no lower bound
  closes_at        timestamptz,             -- NULL = no upper bound

  exam_password    text,                    -- never exposed to anon (see grants)
  has_password     boolean NOT NULL DEFAULT false,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT assessments_kind_chk
    CHECK (kind IN ('exam','seatwork')),
  -- A window that closes before it opens is always a mistake.
  CONSTRAINT assessments_window_chk
    CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at)
);

COMMENT ON TABLE public.assessments IS
  'Exams and seatworks. Supersedes public.exams; ids are shared with it during the transition.';
COMMENT ON COLUMN public.assessments.is_open IS
  'Master switch. An assessment is available only when is_open AND now() is inside [opens_at, closes_at).';

-- Availability helper — one definition of "can a student take this now",
-- so the client, the RLS policies and any reporting all agree.
CREATE OR REPLACE FUNCTION public.assessment_is_available(
  p_is_open boolean, p_opens_at timestamptz, p_closes_at timestamptz
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_is_open
     AND (p_opens_at  IS NULL OR now() >= p_opens_at)
     AND (p_closes_at IS NULL OR now() <  p_closes_at);
$$;

CREATE INDEX IF NOT EXISTS assessments_instructor_idx ON public.assessments (instructor_id);
CREATE INDEX IF NOT EXISTS assessments_kind_idx       ON public.assessments (kind);
CREATE INDEX IF NOT EXISTS assessments_window_idx     ON public.assessments (opens_at, closes_at);

-- ---------------------------------------------------------------------
-- 1a. Copy exams in, PRESERVING id
-- ---------------------------------------------------------------------
-- ON CONFLICT DO UPDATE so re-running re-syncs rather than erroring.
INSERT INTO public.assessments
  (id, kind, title, description, target_section, instructor_id,
   is_open, duration_minutes, exam_password, has_password, created_at)
SELECT
  e.id, 'exam', e.title, e.description, e.target_section, e.instructor_id,
  e.is_open, e.duration_minutes, e.exam_password, e.has_password, e.created_at
FROM public.exams e
ON CONFLICT (id) DO UPDATE SET
  title            = EXCLUDED.title,
  description      = EXCLUDED.description,
  target_section   = EXCLUDED.target_section,
  instructor_id    = EXCLUDED.instructor_id,
  is_open          = EXCLUDED.is_open,
  duration_minutes = EXCLUDED.duration_minutes,
  exam_password    = EXCLUDED.exam_password,
  has_password     = EXCLUDED.has_password,
  updated_at       = now();

-- =====================================================================
-- 2. REPOINT CHILD TABLES (additively)
-- =====================================================================

ALTER TABLE public.questions      ADD COLUMN IF NOT EXISTS assessment_id uuid;
ALTER TABLE public.results        ADD COLUMN IF NOT EXISTS assessment_id uuid;
ALTER TABLE public.live_sessions  ADD COLUMN IF NOT EXISTS assessment_id uuid;

-- ids were preserved, so the backfill is a straight copy
UPDATE public.questions     SET assessment_id = exam_id WHERE assessment_id IS NULL;
UPDATE public.results       SET assessment_id = exam_id WHERE assessment_id IS NULL;
UPDATE public.live_sessions SET assessment_id = exam_id WHERE assessment_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='questions_assessment_fk') THEN
    ALTER TABLE public.questions ADD CONSTRAINT questions_assessment_fk
      FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='results_assessment_fk') THEN
    ALTER TABLE public.results ADD CONSTRAINT results_assessment_fk
      FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='live_sessions_assessment_fk') THEN
    ALTER TABLE public.live_sessions ADD CONSTRAINT live_sessions_assessment_fk
      FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS questions_assessment_idx     ON public.questions (assessment_id);
CREATE INDEX IF NOT EXISTS results_assessment_idx       ON public.results (assessment_id);
CREATE INDEX IF NOT EXISTS live_sessions_assessment_idx ON public.live_sessions (assessment_id);

-- Mirrors the existing UNIQUE(student_id, exam_id) constraints. Holds today
-- because assessment_id == exam_id; prepares the cutover so the guarantee
-- never lapses when exam_id eventually goes away.
CREATE UNIQUE INDEX IF NOT EXISTS results_student_assessment_key
  ON public.results (student_id, assessment_id);
CREATE UNIQUE INDEX IF NOT EXISTS live_sessions_student_assessment_key
  ON public.live_sessions (student_id, assessment_id);

-- =====================================================================
-- 3. TRANSITIONAL SYNC  (removed in a later phase — see PHASE-OUT below)
-- =====================================================================
-- The deployed app still writes to `exams` and still sets only exam_id on
-- child rows. These triggers keep `assessments` truthful in the meantime.

CREATE OR REPLACE FUNCTION public.sync_exam_to_assessment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.assessments WHERE id = OLD.id AND kind = 'exam';
    RETURN OLD;
  END IF;

  INSERT INTO public.assessments
    (id, kind, title, description, target_section, instructor_id,
     is_open, duration_minutes, exam_password, has_password, created_at)
  VALUES
    (NEW.id, 'exam', NEW.title, NEW.description, NEW.target_section, NEW.instructor_id,
     NEW.is_open, NEW.duration_minutes, NEW.exam_password, NEW.has_password, NEW.created_at)
  ON CONFLICT (id) DO UPDATE SET
    title            = EXCLUDED.title,
    description      = EXCLUDED.description,
    target_section   = EXCLUDED.target_section,
    instructor_id    = EXCLUDED.instructor_id,
    is_open          = EXCLUDED.is_open,
    duration_minutes = EXCLUDED.duration_minutes,
    exam_password    = EXCLUDED.exam_password,
    has_password     = EXCLUDED.has_password,
    updated_at       = now();

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS exams_sync_to_assessments ON public.exams;
CREATE TRIGGER exams_sync_to_assessments
  AFTER INSERT OR UPDATE OR DELETE ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.sync_exam_to_assessment();

-- Fill assessment_id on child rows written by the old code path.
CREATE OR REPLACE FUNCTION public.fill_assessment_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assessment_id IS NULL THEN
    NEW.assessment_id := NEW.exam_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS questions_fill_assessment     ON public.questions;
DROP TRIGGER IF EXISTS results_fill_assessment       ON public.results;
DROP TRIGGER IF EXISTS live_sessions_fill_assessment ON public.live_sessions;

CREATE TRIGGER questions_fill_assessment
  BEFORE INSERT OR UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.fill_assessment_id();
CREATE TRIGGER results_fill_assessment
  BEFORE INSERT OR UPDATE ON public.results
  FOR EACH ROW EXECUTE FUNCTION public.fill_assessment_id();
CREATE TRIGGER live_sessions_fill_assessment
  BEFORE INSERT OR UPDATE ON public.live_sessions
  FOR EACH ROW EXECUTE FUNCTION public.fill_assessment_id();

-- =====================================================================
-- 4. LESSONS  (modelled on AeroHub: subjects → topics, markdown body)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.lesson_subjects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  description    text,
  target_section text,
  instructor_id  uuid,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lessons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id     uuid REFERENCES public.lesson_subjects(id) ON DELETE SET NULL,

  title          text NOT NULL,
  -- Markdown, same as AeroHub topics.content_text. Rendered client-side with
  -- react-markdown + KaTeX; sanitised there, so never trust it as HTML.
  content_md     text NOT NULL DEFAULT '',

  target_section text,                    -- comma-separated, as elsewhere
  instructor_id  uuid,

  is_published   boolean NOT NULL DEFAULT false,
  published_at   timestamptz,
  sort_order     integer NOT NULL DEFAULT 0,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lessons_subject_idx    ON public.lessons (subject_id);
CREATE INDEX IF NOT EXISTS lessons_instructor_idx ON public.lessons (instructor_id);
CREATE INDEX IF NOT EXISTS lessons_published_idx  ON public.lessons (is_published);

-- Read tracking, equivalent to AeroHub's topic_progress.
CREATE TABLE IF NOT EXISTS public.lesson_progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   uuid NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  lesson_id    uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  viewed_at    timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT lesson_progress_student_lesson_key UNIQUE (student_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS lesson_progress_lesson_idx  ON public.lesson_progress (lesson_id);
CREATE INDEX IF NOT EXISTS lesson_progress_student_idx ON public.lesson_progress (student_id);

-- Keep updated_at honest on the two tables people edit by hand.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS lessons_touch     ON public.lessons;
DROP TRIGGER IF EXISTS assessments_touch ON public.assessments;
CREATE TRIGGER lessons_touch     BEFORE UPDATE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER assessments_touch BEFORE UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- 5. RLS + GRANTS
-- =====================================================================
-- Follows the posture already in supabase_setup.sql: students are NOT in
-- Supabase Auth (they use the anon key), so row-level scoping by student
-- is not possible — column grants are what actually constrain anon.
-- Instructors are authenticated and scoped by ownership.

ALTER TABLE public.assessments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;

-- ---- assessments ----------------------------------------------------
DROP POLICY IF EXISTS assessments_anon_select ON public.assessments;
DROP POLICY IF EXISTS assessments_auth_select ON public.assessments;
DROP POLICY IF EXISTS assessments_auth_insert ON public.assessments;
DROP POLICY IF EXISTS assessments_auth_update ON public.assessments;
DROP POLICY IF EXISTS assessments_auth_delete ON public.assessments;

CREATE POLICY assessments_anon_select ON public.assessments
  FOR SELECT TO anon USING (true);

-- Instructors read all; the dashboard filters by ownership/shares/sections
-- client-side, matching how exams already behaves. Writes are scoped below.
CREATE POLICY assessments_auth_select ON public.assessments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY assessments_auth_insert ON public.assessments
  FOR INSERT TO authenticated
  WITH CHECK (instructor_id = auth.uid());

CREATE POLICY assessments_auth_update ON public.assessments
  FOR UPDATE TO authenticated
  USING (
    instructor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.exam_shares s
      WHERE s.exam_id = assessments.id AND s.shared_with = auth.uid()
    )
    -- section co-instructors: compare against each entry of the comma list,
    -- not the whole string (the bug fixed for exams in
    -- fix_rls_section_match_and_stray_comma.sql — do not reintroduce it).
    OR EXISTS (
      SELECT 1 FROM public.section_instructors si
      WHERE si.instructor_id = auth.uid()
        AND si.section_name <> ''
        AND si.section_name = ANY (
          SELECT btrim(x)
          FROM unnest(string_to_array(coalesce(assessments.target_section,''), ',')) AS t(x)
        )
    )
  )
  WITH CHECK (true);

CREATE POLICY assessments_auth_delete ON public.assessments
  FOR DELETE TO authenticated
  USING (instructor_id = auth.uid());

-- anon may read everything EXCEPT exam_password, exactly as for exams
REVOKE ALL ON public.assessments FROM anon;
GRANT SELECT (id, kind, title, description, target_section, instructor_id,
              is_open, opens_at, closes_at, duration_minutes, has_password,
              created_at, updated_at)
  ON public.assessments TO anon;
GRANT ALL ON public.assessments TO authenticated;

-- ---- lesson_subjects ------------------------------------------------
DROP POLICY IF EXISTS lesson_subjects_anon_select ON public.lesson_subjects;
DROP POLICY IF EXISTS lesson_subjects_auth_all    ON public.lesson_subjects;

CREATE POLICY lesson_subjects_anon_select ON public.lesson_subjects
  FOR SELECT TO anon USING (true);
CREATE POLICY lesson_subjects_auth_all ON public.lesson_subjects
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT ON public.lesson_subjects TO anon;
GRANT ALL    ON public.lesson_subjects TO authenticated;

-- ---- lessons --------------------------------------------------------
DROP POLICY IF EXISTS lessons_anon_select ON public.lessons;
DROP POLICY IF EXISTS lessons_auth_select ON public.lessons;
DROP POLICY IF EXISTS lessons_auth_insert ON public.lessons;
DROP POLICY IF EXISTS lessons_auth_update ON public.lessons;
DROP POLICY IF EXISTS lessons_auth_delete ON public.lessons;

-- Students only ever see published lessons — unlike exams, an unpublished
-- draft must not leak, so this policy is genuinely restrictive.
CREATE POLICY lessons_anon_select ON public.lessons
  FOR SELECT TO anon USING (is_published = true);

CREATE POLICY lessons_auth_select ON public.lessons
  FOR SELECT TO authenticated USING (true);
CREATE POLICY lessons_auth_insert ON public.lessons
  FOR INSERT TO authenticated WITH CHECK (instructor_id = auth.uid());
CREATE POLICY lessons_auth_update ON public.lessons
  FOR UPDATE TO authenticated
  USING (
    instructor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.section_instructors si
      WHERE si.instructor_id = auth.uid()
        AND si.section_name <> ''
        AND si.section_name = ANY (
          SELECT btrim(x)
          FROM unnest(string_to_array(coalesce(lessons.target_section,''), ',')) AS t(x)
        )
    )
  )
  WITH CHECK (true);
CREATE POLICY lessons_auth_delete ON public.lessons
  FOR DELETE TO authenticated USING (instructor_id = auth.uid());

GRANT SELECT ON public.lessons TO anon;
GRANT ALL    ON public.lessons TO authenticated;

-- ---- lesson_progress ------------------------------------------------
DROP POLICY IF EXISTS lesson_progress_anon_select ON public.lesson_progress;
DROP POLICY IF EXISTS lesson_progress_anon_insert ON public.lesson_progress;
DROP POLICY IF EXISTS lesson_progress_anon_update ON public.lesson_progress;
DROP POLICY IF EXISTS lesson_progress_auth_all    ON public.lesson_progress;

CREATE POLICY lesson_progress_anon_select ON public.lesson_progress
  FOR SELECT TO anon USING (true);
CREATE POLICY lesson_progress_anon_insert ON public.lesson_progress
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY lesson_progress_anon_update ON public.lesson_progress
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY lesson_progress_auth_all ON public.lesson_progress
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.lesson_progress TO anon;
GRANT ALL                    ON public.lesson_progress TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — all of these should report OK
-- =====================================================================

-- every exam has a matching assessment, with identical id
SELECT 'exams -> assessments' AS check,
       (SELECT count(*) FROM public.exams)                          AS exams,
       (SELECT count(*) FROM public.assessments WHERE kind='exam')  AS assessments,
       CASE WHEN (SELECT count(*) FROM public.exams)
               = (SELECT count(*) FROM public.assessments WHERE kind='exam')
            THEN 'OK' ELSE 'MISMATCH' END AS status;

-- no orphaned or unbackfilled child rows
SELECT 'child backfill' AS check,
       (SELECT count(*) FROM public.questions     WHERE assessment_id IS NULL) AS q_null,
       (SELECT count(*) FROM public.results       WHERE assessment_id IS NULL) AS r_null,
       (SELECT count(*) FROM public.live_sessions WHERE assessment_id IS NULL) AS ls_null;

-- assessment_id must equal exam_id everywhere during the transition
SELECT 'id parity' AS check,
       (SELECT count(*) FROM public.results       WHERE assessment_id IS DISTINCT FROM exam_id) AS r_drift,
       (SELECT count(*) FROM public.questions     WHERE assessment_id IS DISTINCT FROM exam_id) AS q_drift,
       (SELECT count(*) FROM public.live_sessions WHERE assessment_id IS DISTINCT FROM exam_id) AS ls_drift;

-- field-level fidelity of the copy
SELECT 'field parity' AS check, count(*) AS mismatched_rows
FROM public.exams e
JOIN public.assessments a ON a.id = e.id
WHERE (e.title, e.target_section, e.is_open, e.duration_minutes)
      IS DISTINCT FROM
      (a.title, a.target_section, a.is_open, a.duration_minutes);

-- new tables exist and are empty as expected
SELECT 'lessons tables' AS check,
       (SELECT count(*) FROM public.lesson_subjects) AS subjects,
       (SELECT count(*) FROM public.lessons)         AS lessons,
       (SELECT count(*) FROM public.lesson_progress) AS progress;

-- =====================================================================
-- PHASE-OUT (do NOT run now — this is the later cutover, kept here so the
-- transitional machinery is never forgotten):
--
--   DROP TRIGGER exams_sync_to_assessments     ON public.exams;
--   DROP TRIGGER questions_fill_assessment     ON public.questions;
--   DROP TRIGGER results_fill_assessment       ON public.results;
--   DROP TRIGGER live_sessions_fill_assessment ON public.live_sessions;
--   ALTER TABLE public.exams RENAME TO exams_legacy_backup;
--   -- then, once settled: drop the exam_id columns and their old constraints.
-- =====================================================================
