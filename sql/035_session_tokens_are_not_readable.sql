-- =====================================================================
-- 035 — Session tokens are no longer readable by anon
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- NEEDS sql/034 AND the app that calls it (f64d32c) — both live 2026-09-28.
--
-- anon was granted SELECT on users.session_token (supabase_setup.sql, §5),
-- so GET /rest/v1/users?select=id,session_token returned every student's
-- token to anyone holding the public anon key. The token is the proof of
-- identity behind the exam gate and the answer review (student_from_token,
-- sql/020), so a proof anyone can read proves nothing.
--
-- Only two pages ever read it, and neither does now: the exam screen's
-- second-login check asks session_is_current() instead (034), and Login
-- stopped selecting it. Login still WRITES it — anon keeps UPDATE on that
-- one column — and every SECURITY DEFINER function that compares it is
-- unaffected.
--
-- WHO NOTICES, and how:
--   * An exam tab opened before f64d32c and never refreshed: its old
--     30-second check now gets "permission denied", which it already treats
--     as "nothing to report". The sitting carries on; only its second-login
--     check stops working until the page is reloaded.
--   * A login page opened before f64d32c and never refreshed: its lookup
--     asked for session_token, so it is refused and shows "Something went
--     wrong on our end". Reloading the page fixes it.
--
-- anon's grant on users is already column by column (checked live:
-- created_at and * are refused), so revoking the one column is enough.
-- =====================================================================

BEGIN;

REVOKE SELECT (session_token) ON public.users FROM anon;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================
SELECT has_column_privilege('anon', 'public.users', 'session_token', 'SELECT') AS anon_reads_token,
       has_column_privilege('anon', 'public.users', 'session_token', 'UPDATE') AS anon_writes_token,
       has_column_privilege('anon', 'public.users', 'student_code',  'SELECT') AS login_lookup_still_works,
       has_table_privilege ('anon', 'public.users', 'SELECT')                  AS anon_reads_whole_table;
-- false, true, true, false.

-- =====================================================================
-- UNDO, if anything that needs the read turns up
-- =====================================================================
-- GRANT SELECT (session_token) ON public.users TO anon;
