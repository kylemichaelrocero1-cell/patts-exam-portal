-- =====================================================================
-- 034 — Is this still the student's session? Asked, not read.
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Additive: nothing is revoked, so the app deployed today keeps working.
--
-- WHY. While a paper is open, the exam screen checks that the student's
-- account has not been logged into somewhere else (one session_token per
-- student; a second login replaces it). It did that by reading
-- users.session_token straight from the table, every 30 seconds, for every
-- student, all exam long — two requests a minute each, and most of the
-- project's log volume on exam days.
--
-- It also meant the browser had to be allowed to READ session tokens, and
-- anon still can: a plain GET on /rest/v1/users returns every student's
-- token, which defeats student_from_token() (sql/020), the proof of identity
-- behind the exam gate and the answer review.
--
-- session_is_current() compares the token in here and answers true or
-- false. The token never leaves the database. The exam screen calls it once
-- a minute instead of reading the table twice.
--
-- It says FALSE only on a definite mismatch: a token on the row, a token
-- offered, and the two different. No row, no token on the row, or no token
-- offered all say TRUE — "cannot tell" must never throw a student out of an
-- exam, and the old check behaved the same way.
--
-- NOT DONE HERE: revoking anon's read of users.session_token. That is the
-- step that actually closes the hole, and it can only run once no deployed
-- page reads the column any more. See the note at the bottom.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.session_is_current(p_student_id uuid, p_session_token text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_student_id
      AND u.session_token IS NOT NULL
      AND p_session_token IS NOT NULL
      AND u.session_token <> p_session_token
  );
$$;

REVOKE ALL ON FUNCTION public.session_is_current(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.session_is_current(uuid, text) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================
SELECT routine_name, security_type, data_type
FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'session_is_current';
-- One row: session_is_current, DEFINER, boolean.

-- =====================================================================
-- LATER — closing the hole (do NOT run with this file)
-- =====================================================================
-- Once the app that calls session_is_current() has been live for a day
-- (so no open tab still runs the old check), and on a day with no exam,
-- anon's SELECT on users.session_token can be revoked. That needs its own
-- migration: anon's SELECT on users is table-wide today, so it must become
-- a column list that leaves session_token out, the same way sql/003 did it
-- for questions.correct_answer.
