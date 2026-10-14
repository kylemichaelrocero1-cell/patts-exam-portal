-- =====================================================================
-- 053 — URGENT: submitting is fast again (050's third look switched off)
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- 050's third look respelt every accepted answer for every line of every
-- full-solution item, and a sitting is marked inside the student's submit
-- request. On a quiz with several full-solution items that took longer
-- than the database allows a student's request, so submitting failed.
--
-- working_verdict() goes back to exactly what it was before 050 (045's
-- comparison, kept by 050 as working_verdict_as_written). math_respell()
-- stays installed but is not called. normalize_math()'s s11 fix (050)
-- stays: it costs nothing. Marks already stored are not touched.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.working_verdict(p_answer text, p_accepted text[])
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT public.working_verdict_as_written(p_answer, p_accepted);
$$;

-- =====================================================================
-- VERIFY — one row: true, true.
-- =====================================================================
SELECT
  (SELECT p.prosrc NOT LIKE '%math_respell%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'working_verdict') AS third_look_off,
  public.working_verdict('y''=7\sin(7x)', ARRAY['y''=7\sin(7x)']) IS NULL AS marking_still_works;
