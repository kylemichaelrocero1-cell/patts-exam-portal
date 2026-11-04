-- =====================================================================
-- 140 — the assessment_scores view follows the caller's rules, and is not
--       offered through the Data API
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent. Needs 002.
-- No deploy order: nothing in the app reads this view. It stays for reports
-- written in the SQL editor, which runs as postgres and reads it as before.
--
--   1. security_invoker, so it reads with the permissions of whoever asks,
--      as the tables beneath it do.
--   2. The API roles no longer have it at all.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.assessment_scores') IS NULL THEN
    RAISE EXCEPTION 'Run sql/002 first. Nothing was changed.';
  END IF;
END $$;

ALTER VIEW public.assessment_scores SET (security_invoker = true);
REVOKE ALL ON public.assessment_scores FROM PUBLIC, anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'assessment_scores'
             AND 'security_invoker=true' = ANY (coalesce(c.reloptions, '{}')))     AS reads_as_the_caller,
  NOT has_table_privilege('anon', 'public.assessment_scores', 'SELECT')            AS students_cannot_read_it,
  NOT has_table_privilege('authenticated', 'public.assessment_scores', 'SELECT')   AS not_offered_to_instructors_either;
