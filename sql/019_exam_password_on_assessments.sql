-- =====================================================================
-- 019 — verify_exam_password() must read the table the app actually writes
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Safe to run before the code that uses it is deployed: it replaces one
-- function and touches no data.
--
-- THE BUG
-- verify_exam_password() has read `public.exams` since day one:
--
--     SELECT exam_password INTO stored_password FROM public.exams WHERE id = ...;
--     IF stored_password IS NULL OR stored_password = '' THEN RETURN true; END IF;
--
-- 001 moved every paper to `public.assessments`, and the sync trigger it
-- installed runs ONE WAY — exams -> assessments. Nothing writes back. Since
-- the cutover, AdminDashboard.createExam() inserts straight into
-- `assessments`, so every exam, seatwork and mock exam created after the
-- migration has NO ROW IN `exams` AT ALL.
--
-- For those papers the SELECT above matched nothing, stored_password came
-- back NULL, and the function returned TRUE. The student saw "Password
-- Required", typed anything at all — one letter, a guess, their own name —
-- and the gate opened. The card said "🔒 Password required" the whole time,
-- because has_password on `assessments` was perfectly correct; only the
-- check behind it was looking in the wrong place.
--
-- Papers created BEFORE the migration still have their legacy row, so their
-- passwords kept working. That is why this went unnoticed: the old exams
-- were fine and every new one was wide open.
--
-- THE FIX
-- Read `assessments` first — it is what the app reads, what savePassword()
-- writes, and where every current paper lives. Fall back to `exams` only for
-- a row that somehow exists there and not in assessments.
--
-- And fail CLOSED. Two cases the old function let through:
--   * no such paper            -> false, not "no password on file, come in"
--   * has_password with no
--     password behind it       -> false; a row claiming to be locked with
--                                 nothing to check against is broken data,
--                                 and the safe reading of it is "locked".
-- A paper that genuinely has no password still returns true, which is what
-- the client expects — it only calls this when has_password is set, but the
-- function must not lock out a paper that was never locked.
--
-- AFTER RUNNING THIS
-- Change the password on any paper that was sat while this was broken. The
-- VERIFY block at the bottom lists exactly which papers were affected.
--
-- ---------------------------------------------------------------------
-- REHEARSE IT FIRST (recommended)
--   1. Change  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file and read the VERIFY output.
--   3. Change it back and run again for real.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.verify_exam_password(p_exam_id uuid, p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found  boolean := false;
  v_locked boolean;
  v_stored text;
BEGIN
  IF p_exam_id IS NULL THEN
    RETURN false;
  END IF;

  -- `assessments` is the paper. Guarded so this still works on a database
  -- where 001 has not run yet.
  BEGIN
    SELECT a.has_password, a.exam_password
      INTO v_locked, v_stored
    FROM public.assessments a
    WHERE a.id = p_exam_id;
    v_found := FOUND;
  EXCEPTION WHEN undefined_table THEN
    v_found := false;
  END;

  -- Legacy mirror, for a pre-migration database or a row that never made it
  -- across.
  IF NOT v_found THEN
    SELECT e.has_password, e.exam_password
      INTO v_locked, v_stored
    FROM public.exams e
    WHERE e.id = p_exam_id;
    v_found := FOUND;
  END IF;

  -- No such paper. The old version treated this as "nothing to check" and
  -- opened the door; that was the whole bug.
  IF NOT v_found THEN
    RETURN false;
  END IF;

  IF v_stored IS NOT NULL AND v_stored <> '' THEN
    RETURN v_stored = coalesce(p_password, '');
  END IF;

  -- Nothing stored: open iff the paper does not claim to be locked.
  RETURN NOT coalesce(v_locked, false);
END; $$;

GRANT EXECUTE ON FUNCTION public.verify_exam_password(uuid, text) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. Which papers were wide open? Every locked paper with no legacy row was
--    accepting any password until this file ran. Change the password on each
--    of these — the old one has been handed out and never checked.
SELECT a.id, a.kind, a.title, a.target_section
FROM public.assessments a
LEFT JOIN public.exams e ON e.id = a.id
WHERE a.has_password
  AND e.id IS NULL
ORDER BY a.created_at DESC;

-- 2. A locked paper must refuse a wrong password and accept the right one.
--    Pick any row from (1) — or any locked paper — and check both ways.
-- SELECT public.verify_exam_password('<paste an id>', 'definitely-wrong');  -- expect f
-- SELECT public.verify_exam_password('<paste an id>', '<the real one>');    -- expect t

-- 3. A paper that was never locked still lets everyone in.
-- SELECT public.verify_exam_password(id, '') FROM public.assessments
-- WHERE NOT has_password LIMIT 1;                                          -- expect t

-- 4. An id that does not exist is refused rather than waved through.
SELECT public.verify_exam_password('00000000-0000-0000-0000-000000000000', 'anything')
       AS unknown_paper_must_be_false;
