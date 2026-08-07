-- =====================================================================
-- PATCH v3 — run this ONCE in the NEW project (jkzisorxeaogwosdzyru)
--
-- 15 of the 1,210 existing results have a NULL time_taken_seconds
-- (time unknown). The NOT NULL I put on that column was my own
-- addition, not something the app requires -- AdminDashboard.jsx:2043
-- already renders a null/zero value as "N/A". Making it nullable keeps
-- those 15 rows honest instead of fabricating a 0-second exam time.
-- =====================================================================

ALTER TABLE public.results ALTER COLUMN time_taken_seconds DROP NOT NULL;
