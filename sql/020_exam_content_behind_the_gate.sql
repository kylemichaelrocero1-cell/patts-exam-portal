-- =====================================================================
-- 020 — the paper itself goes behind the gate
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- ADDITIVE ONLY: it revokes nothing and breaks nothing, so it is safe to
-- run before the code that uses it is deployed. The lock comes in 021.
--
-- WHAT IS WRONG TODAY
-- The exam password has never been a lock on the exam. It gates the Start
-- button in ExamList and nothing else. The questions themselves come from
-- a plain table read:
--
--     supabase.from('questions').select(...).eq('exam_id', exam.id)
--
-- and the policy behind that read is:
--
--     CREATE POLICY questions_anon_select ON public.questions
--       FOR SELECT TO anon USING (true);
--
-- USING (true). The anon key ships inside the public JS bundle. So anyone
-- who can open the site can read every question of every paper in the
-- database — papers that are closed, papers scheduled for next week,
-- archived papers, other instructors' papers, password-protected papers.
-- 003 took `correct_answer` away, which is the part that would let someone
-- score 100%; it left the questions.
--
-- The password modal is therefore a curtain, not a door. Fixing
-- verify_exam_password (019) made the curtain real, but a student who
-- never clicks Start was never stopped by it anyway.
--
-- WHAT THIS ADDS
--   exam_unlocks          one row per (paper, student) that has actually
--                         entered the password. Written only by
--                         unlock_assessment(); no anon policy, so the
--                         browser cannot read, forge or clear it.
--   unlock_assessment()   verify the password AND record the unlock, in
--                         one server-side step, against a student proved
--                         by their users.session_token.
--   get_exam_questions()  the only way a student gets a paper. Checks, in
--                         order: who you are, that the paper exists, that
--                         you are in its section, that it is open (or you
--                         are mid-sitting), and that you are through the
--                         password gate. Never returns correct_answer.
--
-- An unlock is torn up the moment the instructor changes the password —
-- see the trigger below. That is what makes "change the password on the
-- affected papers" (019) actually lock the class out again.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- anon keeps its SELECT on `questions` until 021. Until then both paths
-- work and nothing can strand a class mid-exam.
--
-- ---------------------------------------------------------------------
-- REHEARSE IT FIRST (recommended)
--   1. Change  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file and read the VERIFY output.
--   3. Change it back and run again for real.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Prerequisites
-- ---------------------------------------------------------------------
-- 001 (assessments), 015 (archived_at + the four-argument
-- assessment_is_available) and 019 (verify_exam_password reading the right
-- table) all come first. Failing here is far better than failing on an exam
-- morning, so check rather than assume.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='assessments'
                   AND column_name='archived_at') THEN
    RAISE EXCEPTION 'Run sql/015_archive_assessments.sql first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='assessment_is_available'
                   AND p.pronargs = 4) THEN
    RAISE EXCEPTION 'Run sql/015_archive_assessments.sql first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Where an unlock is remembered
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_unlocks (
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES public.users(id)       ON DELETE CASCADE,
  unlocked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assessment_id, student_id)
);

COMMENT ON TABLE public.exam_unlocks IS
  'One row per student who has entered a paper''s password. Written only by unlock_assessment(); read only by get_exam_questions(). Cleared automatically when the password changes.';

ALTER TABLE public.exam_unlocks ENABLE ROW LEVEL SECURITY;

-- No anon policy at all: a student must not be able to read who is through
-- the gate, and above all must not be able to INSERT their own way through.
-- The two SECURITY DEFINER functions below bypass RLS and are the only way
-- in. Instructors may look, so the dashboard can show and clear unlocks.
DROP POLICY IF EXISTS exam_unlocks_auth_all ON public.exam_unlocks;
CREATE POLICY exam_unlocks_auth_all ON public.exam_unlocks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

REVOKE ALL ON public.exam_unlocks FROM anon;
GRANT ALL ON public.exam_unlocks TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Changing the password locks everyone back out
-- ---------------------------------------------------------------------
-- Without this, an unlock would outlive the password it was granted for,
-- and the "change the password on the affected papers" step in 019 would
-- do nothing for anyone already through.
CREATE OR REPLACE FUNCTION public.clear_unlocks_on_password_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.exam_password IS DISTINCT FROM OLD.exam_password
     OR NEW.has_password IS DISTINCT FROM OLD.has_password THEN
    DELETE FROM public.exam_unlocks WHERE assessment_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS assessments_clear_unlocks ON public.assessments;
CREATE TRIGGER assessments_clear_unlocks
  AFTER UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.clear_unlocks_on_password_change();

-- ---------------------------------------------------------------------
-- 3. Is this student in the paper's section?
-- ---------------------------------------------------------------------
-- Both sides are comma-separated lists — users.section holds EVERY section
-- a student is in (see src/lib/sectionScope.js) and target_section holds
-- every section a paper is set for. They match if they overlap at all.
CREATE OR REPLACE FUNCTION public.sections_overlap(p_a text, p_b text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(string_to_array(coalesce(p_a,''), ',')) a(s)
    JOIN unnest(string_to_array(coalesce(p_b,''), ',')) b(s)
      ON btrim(a.s) = btrim(b.s)
    WHERE btrim(a.s) <> ''
  );
$$;

-- ---------------------------------------------------------------------
-- 4. Who is asking?
-- ---------------------------------------------------------------------
-- Students are not in Supabase Auth; they reach the API as `anon`. The
-- nearest thing to an identity is users.session_token, minted at login and
-- already used by ExamBoard to detect a second device. It is the proof the
-- functions below demand — without it, p_student_id is just a number the
-- caller chose.
CREATE OR REPLACE FUNCTION public.student_from_token(p_student_id uuid, p_session_token text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id FROM public.users u
  WHERE u.id = p_student_id
    AND p_session_token IS NOT NULL
    AND u.session_token IS NOT NULL
    AND u.session_token = p_session_token;
$$;

-- ---------------------------------------------------------------------
-- 5. Entering the password
-- ---------------------------------------------------------------------
-- A new name rather than a third overload of verify_exam_password: two
-- functions of the same name differing only in arity are a trap for
-- PostgREST, and this one does something the old one never did — it
-- remembers.
CREATE OR REPLACE FUNCTION public.unlock_assessment(
  p_assessment_id uuid,
  p_password      text,
  p_student_id    uuid,
  p_session_token text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student uuid;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  -- One definition of "is this the password", shared with the plain
  -- two-argument form students' browsers may still be calling.
  IF NOT public.verify_exam_password(p_assessment_id, p_password) THEN
    RETURN false;
  END IF;

  INSERT INTO public.exam_unlocks (assessment_id, student_id)
  VALUES (p_assessment_id, v_student)
  ON CONFLICT (assessment_id, student_id)
  DO UPDATE SET unlocked_at = now();

  RETURN true;
END $$;

-- ---------------------------------------------------------------------
-- 6. The paper
-- ---------------------------------------------------------------------
-- correct_answer and correct_answers are absent by construction: this
-- returns the columns a student may see and no others, so a future column
-- on `questions` is withheld until somebody adds it here deliberately.
DROP FUNCTION IF EXISTS public.get_exam_questions(uuid, uuid, text);
CREATE FUNCTION public.get_exam_questions(
  p_assessment_id uuid,
  p_student_id    uuid,
  p_session_token text
) RETURNS TABLE (
  id              uuid,
  exam_id         uuid,
  assessment_id   uuid,
  question_number integer,
  question_text   text,
  question_type   text,
  category        text,
  choices         jsonb,
  choice_a        text,
  choice_b        text,
  choice_c        text,
  choice_d        text,
  choice_e        text,
  image_url       text,
  created_at      timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student  uuid;
  v_paper    public.assessments%ROWTYPE;
  v_sections text;
  v_sitting  boolean;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_paper FROM public.assessments a WHERE a.id = p_assessment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That assessment no longer exists.' USING ERRCODE = '42704';
  END IF;

  SELECT u.section INTO v_sections FROM public.users u WHERE u.id = v_student;
  IF NOT public.sections_overlap(v_sections, v_paper.target_section) THEN
    RAISE EXCEPTION 'This assessment is not for your section.' USING ERRCODE = '42501';
  END IF;

  -- Mid-sitting beats every window check below. An instructor who closes a
  -- paper, or a window that runs out, must not blank the screen of a
  -- student who is already writing and happens to reload.
  SELECT EXISTS (
    SELECT 1 FROM public.live_sessions ls
    WHERE ls.student_id = v_student
      AND ls.exam_id = p_assessment_id
      AND ls.status IS DISTINCT FROM 'finished'
  ) INTO v_sitting;

  IF NOT v_sitting AND NOT public.assessment_is_available(
       v_paper.is_open, v_paper.opens_at, v_paper.closes_at, v_paper.archived_at) THEN
    RAISE EXCEPTION 'This assessment is not open.' USING ERRCODE = '42501';
  END IF;

  -- The gate, and the whole point of this file.
  IF coalesce(v_paper.has_password, false) AND NOT v_sitting THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.exam_unlocks x
      WHERE x.assessment_id = p_assessment_id AND x.student_id = v_student
    ) THEN
      RAISE EXCEPTION 'Enter the exam password first.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT q.id, q.exam_id, q.assessment_id, q.question_number, q.question_text,
         coalesce(q.question_type, 'multiple_choice'), q.category, q.choices,
         q.choice_a, q.choice_b, q.choice_c, q.choice_d, q.choice_e,
         q.image_url, q.created_at
  FROM public.questions q
  WHERE q.exam_id = p_assessment_id OR q.assessment_id = p_assessment_id
  ORDER BY q.question_number NULLS LAST, q.id;
END $$;

GRANT EXECUTE ON FUNCTION public.sections_overlap(text, text)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_from_token(uuid, text)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_assessment(uuid, text, uuid, text)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_exam_questions(uuid, uuid, text)         TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. The unlock table is closed to anon. This must return no rows.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'exam_unlocks' AND grantee = 'anon';

-- 2. The paper function hands back no answer key. correct_answer and
--    correct_answers must NOT appear.
SELECT string_agg(parameter_name, ', ' ORDER BY ordinal_position) AS returned
FROM information_schema.parameters
WHERE specific_schema = 'public'
  AND specific_name LIKE 'get_exam_questions%'
  AND parameter_mode = 'TABLE';

-- 3. Nobody is through any gate yet — this is a fresh table.
SELECT count(*) AS unlocks_recorded FROM public.exam_unlocks;

-- 4. End to end, against a real student and a real locked paper:
-- SELECT public.get_exam_questions('<paper id>', '<student id>', '<their session_token>');
--   -> "Enter the exam password first."   before unlocking
-- SELECT public.unlock_assessment('<paper id>', '<the password>', '<student id>', '<token>');
--   -> t, and one row appears in exam_unlocks
-- SELECT count(*) FROM public.get_exam_questions('<paper id>', '<student id>', '<token>');
--   -> the number of questions on the paper
