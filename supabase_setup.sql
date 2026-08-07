-- =====================================================================
-- PATTS College of Aeronautics — Online Examination Portal
-- Full Supabase setup script for a NEW project.
--
-- HOW TO USE:
--   1. Open your new Supabase project → SQL Editor → New query
--   2. Paste this entire file and click RUN
--   3. Then create your instructor login: Authentication → Users →
--      "Add user" → email + password → tick "Auto Confirm User"
--   4. Put the new Project URL + anon key into VITE_SUPABASE_URL and
--      VITE_SUPABASE_ANON_KEY (both .env.local and Vercel env vars)
--
-- Safe to re-run: everything uses IF NOT EXISTS / CREATE OR REPLACE.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =====================================================================
-- 1. TABLES
-- =====================================================================

-- ---- instructors -----------------------------------------------------
-- Mirror of auth.users, so instructors can see each other by name when
-- sharing / transferring exams. Populated automatically on every login.
CREATE TABLE IF NOT EXISTS public.instructors (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text,
  full_name  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---- users (students) ------------------------------------------------
-- NOT Supabase Auth. Students log in with email + student code.
CREATE TABLE IF NOT EXISTS public.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     text NOT NULL,
  section       text,
  student_email text UNIQUE,
  student_code  text UNIQUE,
  session_token text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_section_idx       ON public.users (section);
CREATE INDEX IF NOT EXISTS users_student_email_idx ON public.users (student_email);

-- ---- exams -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exams (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  description      text,
  target_section   text,
  instructor_id    uuid,                    -- auth.uid() of the owner
  is_open          boolean NOT NULL DEFAULT false,
  duration_minutes integer NOT NULL DEFAULT 60,
  exam_password    text,                    -- never exposed to anon (see grants)
  has_password     boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exams_instructor_id_idx  ON public.exams (instructor_id);
CREATE INDEX IF NOT EXISTS exams_target_section_idx ON public.exams (target_section);
CREATE INDEX IF NOT EXISTS exams_is_open_idx        ON public.exams (is_open);

-- ---- questions -------------------------------------------------------
-- correct_answer is a 0-3 index into choice_a..choice_d.
-- Essay questions: question_type='essay', choices + correct_answer NULL.
CREATE TABLE IF NOT EXISTS public.questions (
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

CREATE INDEX IF NOT EXISTS questions_exam_id_idx  ON public.questions (exam_id);
CREATE INDEX IF NOT EXISTS questions_exam_num_idx ON public.questions (exam_id, question_number);

-- ---- results ---------------------------------------------------------
-- UNIQUE(student_id, exam_id) is REQUIRED: the app relies on error 23505
-- to detect "already submitted" and treat it as success.
CREATE TABLE IF NOT EXISTS public.results (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  exam_id            uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  answers_json       jsonb DEFAULT '{}'::jsonb,
  score              integer NOT NULL DEFAULT 0,
  total_items        integer NOT NULL DEFAULT 0,
  time_taken_seconds integer,
  tab_switches       integer NOT NULL DEFAULT 0,
  violation_logs     jsonb DEFAULT '[]'::jsonb,
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT results_student_exam_key UNIQUE (student_id, exam_id)
);

CREATE INDEX IF NOT EXISTS results_exam_id_idx    ON public.results (exam_id);
CREATE INDEX IF NOT EXISTS results_student_id_idx ON public.results (student_id);

-- ---- live_sessions ---------------------------------------------------
-- One row per student per exam while the exam is in progress.
-- UNIQUE(student_id, exam_id) is REQUIRED: ExamBoard depends on the
-- duplicate insert failing so it can re-fetch the real row on a race.
CREATE TABLE IF NOT EXISTS public.live_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  exam_id            uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_name       text,
  status             text NOT NULL DEFAULT 'active',
  answers_count      integer NOT NULL DEFAULT 0,
  violation_count    integer NOT NULL DEFAULT 0,
  violation_log      jsonb DEFAULT '[]'::jsonb,  -- note: SINGULAR here
  answers_json       jsonb,          -- MC answers, autosaved every 5s
  essay_answers_json jsonb,          -- essay text, autosaved every 5s
  exam_set           text,           -- 'A' or 'B'
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_sessions_student_exam_key UNIQUE (student_id, exam_id),
  CONSTRAINT live_sessions_status_chk CHECK (status IN ('active','locked','finished'))
);

CREATE INDEX IF NOT EXISTS live_sessions_exam_id_idx ON public.live_sessions (exam_id);
CREATE INDEX IF NOT EXISTS live_sessions_status_idx  ON public.live_sessions (status);

-- ---- exam_shares -----------------------------------------------------
-- Read-only sharing of an exam with another instructor.
CREATE TABLE IF NOT EXISTS public.exam_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id     uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  shared_by   uuid NOT NULL,
  shared_with uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_shares_unique_key UNIQUE (exam_id, shared_with)
);

CREATE INDEX IF NOT EXISTS exam_shares_shared_with_idx ON public.exam_shares (shared_with);
CREATE INDEX IF NOT EXISTS exam_shares_shared_by_idx   ON public.exam_shares (shared_by);

-- ---- section_instructors ---------------------------------------------
-- Co-instructor access to a whole section.
CREATE TABLE IF NOT EXISTS public.section_instructors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_name  text NOT NULL,
  instructor_id uuid NOT NULL,
  added_by      uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT section_instructors_unique_key UNIQUE (section_name, instructor_id, added_by)
);

CREATE INDEX IF NOT EXISTS section_instructors_instructor_idx ON public.section_instructors (instructor_id);


-- =====================================================================
-- 2. TRIGGERS
-- =====================================================================

-- Keep live_sessions.updated_at fresh even if the client forgets to set it.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS live_sessions_touch_updated_at ON public.live_sessions;
CREATE TRIGGER live_sessions_touch_updated_at
  BEFORE UPDATE ON public.live_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Safety net: has_password always mirrors exam_password.
CREATE OR REPLACE FUNCTION public.sync_has_password()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.has_password := (NEW.exam_password IS NOT NULL AND NEW.exam_password <> '');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS exams_sync_has_password ON public.exams;
CREATE TRIGGER exams_sync_has_password
  BEFORE INSERT OR UPDATE OF exam_password ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.sync_has_password();


-- =====================================================================
-- 3. RPC FUNCTIONS (called from the app via supabase.rpc(...))
-- =====================================================================

-- ---- verify_exam_password -------------------------------------------
-- Password is checked on the server; it never reaches the browser.
CREATE OR REPLACE FUNCTION public.verify_exam_password(p_exam_id uuid, p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored_password text;
BEGIN
  SELECT exam_password INTO stored_password FROM public.exams WHERE id = p_exam_id;
  IF stored_password IS NULL OR stored_password = '' THEN
    RETURN true;
  END IF;
  RETURN stored_password = p_password;
END; $$;

-- ---- duplicate_exam --------------------------------------------------
-- Copies an exam and all of its questions; returns the new exam id.
CREATE OR REPLACE FUNCTION public.duplicate_exam(
  p_source_exam_id      uuid,
  p_new_title           text,
  p_target_section      text,
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

  -- Caller must own the exam or have it shared with them.
  IF NOT EXISTS (
    SELECT 1 FROM public.exams e
    WHERE e.id = p_source_exam_id
      AND (e.instructor_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.exam_shares s
                      WHERE s.exam_id = e.id AND s.shared_with = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'You do not have access to this exam';
  END IF;

  INSERT INTO public.exams (title, target_section, instructor_id, is_open,
                            duration_minutes, exam_password)
  SELECT p_new_title, p_target_section, p_target_instructor_id, false,
         e.duration_minutes, e.exam_password
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

-- ---- transfer_exams --------------------------------------------------
-- Reassigns ownership of one or more exams to another instructor.
CREATE OR REPLACE FUNCTION public.transfer_exams(
  p_exam_ids            uuid[],
  p_target_instructor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Only exams the caller actually owns are moved.
  UPDATE public.exams
  SET instructor_id = p_target_instructor_id
  WHERE id = ANY(p_exam_ids)
    AND instructor_id = auth.uid();
END; $$;

GRANT EXECUTE ON FUNCTION public.verify_exam_password(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_exam(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_exams(uuid[], uuid)          TO authenticated;


-- =====================================================================
-- 4. ROW LEVEL SECURITY
--
-- Students are NOT authenticated — they hit the API as the `anon` role,
-- so anon policies must stay permissive enough for the exam to work.
-- Instructors are `authenticated` via Supabase Auth.
-- =====================================================================

ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_shares         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.section_instructors ENABLE ROW LEVEL SECURITY;

-- ---- users -----------------------------------------------------------
DROP POLICY IF EXISTS users_anon_select  ON public.users;
DROP POLICY IF EXISTS users_anon_update  ON public.users;
DROP POLICY IF EXISTS users_auth_all     ON public.users;

CREATE POLICY users_anon_select ON public.users
  FOR SELECT TO anon USING (true);          -- login lookup
CREATE POLICY users_anon_update ON public.users
  FOR UPDATE TO anon USING (true) WITH CHECK (true);  -- session_token only (column grant)
CREATE POLICY users_auth_all ON public.users
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- exams -----------------------------------------------------------
DROP POLICY IF EXISTS exams_anon_select ON public.exams;
DROP POLICY IF EXISTS exams_auth_select ON public.exams;
DROP POLICY IF EXISTS exams_auth_insert ON public.exams;
DROP POLICY IF EXISTS exams_auth_update ON public.exams;
DROP POLICY IF EXISTS exams_auth_delete ON public.exams;

CREATE POLICY exams_anon_select ON public.exams
  FOR SELECT TO anon USING (true);

-- Instructors can read all exams; the dashboard filters by ownership,
-- shares and section co-teaching client-side. Writes ARE scoped below.
CREATE POLICY exams_auth_select ON public.exams
  FOR SELECT TO authenticated USING (true);

CREATE POLICY exams_auth_insert ON public.exams
  FOR INSERT TO authenticated
  WITH CHECK (instructor_id = auth.uid());

CREATE POLICY exams_auth_update ON public.exams
  FOR UPDATE TO authenticated
  USING (
    instructor_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.exam_shares s
               WHERE s.exam_id = exams.id AND s.shared_with = auth.uid())
    OR EXISTS (SELECT 1 FROM public.section_instructors si
               WHERE si.section_name = exams.target_section
                 AND si.instructor_id = auth.uid())
  )
  WITH CHECK (true);

CREATE POLICY exams_auth_delete ON public.exams
  FOR DELETE TO authenticated
  USING (instructor_id = auth.uid());

-- ---- questions -------------------------------------------------------
DROP POLICY IF EXISTS questions_anon_select ON public.questions;
DROP POLICY IF EXISTS questions_auth_all    ON public.questions;

CREATE POLICY questions_anon_select ON public.questions
  FOR SELECT TO anon USING (true);
CREATE POLICY questions_auth_all ON public.questions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- results ---------------------------------------------------------
DROP POLICY IF EXISTS results_anon_select ON public.results;
DROP POLICY IF EXISTS results_anon_insert ON public.results;
DROP POLICY IF EXISTS results_auth_all    ON public.results;

CREATE POLICY results_anon_select ON public.results
  FOR SELECT TO anon USING (true);
CREATE POLICY results_anon_insert ON public.results
  FOR INSERT TO anon WITH CHECK (true);
-- Students may NOT update or delete their own results.
CREATE POLICY results_auth_all ON public.results
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- live_sessions ---------------------------------------------------
DROP POLICY IF EXISTS live_sessions_anon_select ON public.live_sessions;
DROP POLICY IF EXISTS live_sessions_anon_insert ON public.live_sessions;
DROP POLICY IF EXISTS live_sessions_anon_update ON public.live_sessions;
DROP POLICY IF EXISTS live_sessions_auth_all    ON public.live_sessions;

CREATE POLICY live_sessions_anon_select ON public.live_sessions
  FOR SELECT TO anon USING (true);
CREATE POLICY live_sessions_anon_insert ON public.live_sessions
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY live_sessions_anon_update ON public.live_sessions
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY live_sessions_auth_all ON public.live_sessions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- instructors -----------------------------------------------------
DROP POLICY IF EXISTS instructors_auth_select ON public.instructors;
DROP POLICY IF EXISTS instructors_auth_upsert ON public.instructors;
DROP POLICY IF EXISTS instructors_auth_update ON public.instructors;

CREATE POLICY instructors_auth_select ON public.instructors
  FOR SELECT TO authenticated USING (true);
CREATE POLICY instructors_auth_upsert ON public.instructors
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY instructors_auth_update ON public.instructors
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ---- exam_shares -----------------------------------------------------
DROP POLICY IF EXISTS exam_shares_auth_select ON public.exam_shares;
DROP POLICY IF EXISTS exam_shares_auth_insert ON public.exam_shares;
DROP POLICY IF EXISTS exam_shares_auth_delete ON public.exam_shares;

CREATE POLICY exam_shares_auth_select ON public.exam_shares
  FOR SELECT TO authenticated
  USING (shared_by = auth.uid() OR shared_with = auth.uid());
CREATE POLICY exam_shares_auth_insert ON public.exam_shares
  FOR INSERT TO authenticated
  WITH CHECK (
    shared_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.exams e
                WHERE e.id = exam_id AND e.instructor_id = auth.uid())
  );
CREATE POLICY exam_shares_auth_delete ON public.exam_shares
  FOR DELETE TO authenticated
  USING (shared_by = auth.uid() OR shared_with = auth.uid());

-- ---- section_instructors ---------------------------------------------
DROP POLICY IF EXISTS section_instructors_auth_select ON public.section_instructors;
DROP POLICY IF EXISTS section_instructors_auth_insert ON public.section_instructors;
DROP POLICY IF EXISTS section_instructors_auth_delete ON public.section_instructors;

CREATE POLICY section_instructors_auth_select ON public.section_instructors
  FOR SELECT TO authenticated USING (true);
CREATE POLICY section_instructors_auth_insert ON public.section_instructors
  FOR INSERT TO authenticated WITH CHECK (added_by = auth.uid());
CREATE POLICY section_instructors_auth_delete ON public.section_instructors
  FOR DELETE TO authenticated USING (added_by = auth.uid());


-- =====================================================================
-- 5. COLUMN-LEVEL GRANTS
--
-- RLS is row-level only. These grants are what actually stop the anon
-- key from reading exam passwords or overwriting student records.
-- =====================================================================

-- exams: anon can read everything EXCEPT exam_password.
REVOKE ALL ON public.exams FROM anon;
GRANT SELECT (id, title, description, target_section, instructor_id, is_open,
              duration_minutes, has_password, created_at)
  ON public.exams TO anon;

-- users: anon may only ever write session_token.
REVOKE ALL ON public.users FROM anon;
GRANT SELECT (id, full_name, section, student_email, student_code, session_token)
  ON public.users TO anon;
GRANT UPDATE (session_token) ON public.users TO anon;

-- Everything else students legitimately need.
GRANT SELECT                 ON public.questions     TO anon;
GRANT SELECT, INSERT         ON public.results       TO anon;
GRANT SELECT, INSERT, UPDATE ON public.live_sessions TO anon;

-- Instructors get full access; RLS above decides which rows.
GRANT ALL ON public.users               TO authenticated;
GRANT ALL ON public.exams               TO authenticated;
GRANT ALL ON public.questions           TO authenticated;
GRANT ALL ON public.results             TO authenticated;
GRANT ALL ON public.live_sessions       TO authenticated;
GRANT ALL ON public.instructors         TO authenticated;
GRANT ALL ON public.exam_shares         TO authenticated;
GRANT ALL ON public.section_instructors TO authenticated;



-- =====================================================================
-- 6. REALTIME
-- The live monitor and the student exam list depend on these.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.live_sessions;
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.results;
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.exams;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- DELETE events need the old row to be sent, otherwise payload.old is empty.
ALTER TABLE public.live_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.results       REPLICA IDENTITY FULL;


-- =====================================================================
-- 7. STORAGE — question images
-- Creates the public "question-images" bucket used by the question editor.
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('question-images', 'question-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "question_images_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "question_images_auth_insert"   ON storage.objects;
DROP POLICY IF EXISTS "question_images_auth_update"   ON storage.objects;
DROP POLICY IF EXISTS "question_images_auth_delete"   ON storage.objects;

CREATE POLICY "question_images_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'question-images');

CREATE POLICY "question_images_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'question-images');

CREATE POLICY "question_images_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'question-images');

CREATE POLICY "question_images_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'question-images');


-- =====================================================================
-- DONE.
--
-- Next steps:
--   1. Authentication → Users → Add user (your instructor email +
--      password, "Auto Confirm User" ticked).
--   2. Copy Project URL + anon public key from Settings → API into
--      VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
--   3. Log in once as instructor — this auto-creates your row in
--      public.instructors so sharing/transfer can find you.
--   4. Add students in the dashboard (Students tab) or bulk CSV import.
-- =====================================================================
