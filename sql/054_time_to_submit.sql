-- =====================================================================
-- 054 — URGENT: a student's submit has time to mark the paper
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- Supabase stops any request from a student's browser (the anon role)
-- after 3 seconds: "canceling statement due to statement timeout".
-- submit_assessment() marks the whole paper inside that one request, and
-- marking a full-solution item against its list of accepted forms can take
-- over a second, so a quiz with several of them could not be handed in —
-- the student saw "There was an error saving your exam".
--
-- Students get 20 seconds, instructors (authenticated, 8 s by default) 30,
-- so Force Submit and re-marking from the dashboard have room as well.
-- NOTIFY makes the API pick the new limits up at once.
-- =====================================================================

ALTER ROLE anon SET statement_timeout = '20s';
ALTER ROLE authenticated SET statement_timeout = '30s';
NOTIFY pgrst, 'reload config';

-- =====================================================================
-- VERIFY — two rows: anon statement_timeout=20s, authenticated statement_timeout=30s.
-- =====================================================================
SELECT r.rolname, c AS setting
FROM pg_roles r, unnest(r.rolconfig) AS c
WHERE r.rolname IN ('anon', 'authenticated') AND c LIKE 'statement_timeout%'
ORDER BY r.rolname;
