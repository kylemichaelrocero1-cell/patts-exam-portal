-- =====================================================================
-- PATCH v3 — run once, after supabase_patch_v2.sql
--
-- time_taken_seconds must be nullable. Some results legitimately have an
-- unknown duration, and the app already renders a null/zero value as
-- "N/A". A NOT NULL here would force fabricating a 0-second exam time.
-- =====================================================================

ALTER TABLE public.results ALTER COLUMN time_taken_seconds DROP NOT NULL;
