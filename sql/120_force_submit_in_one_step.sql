-- =====================================================================
-- 120 — Force Submit files a sitting and closes it in one step
--
-- Run once in the Supabase SQL editor. Safe to run twice. Run it before
-- the frontend that calls it is pushed; until then the dashboard keeps
-- doing it the old way (it falls back only when this function is missing).
--
-- The dashboard used to Force Submit in three round trips: mark the
-- sitting finished, file the paper with submit_assessment(), and — when
-- filing failed — mark the sitting open again. When that last step never
-- arrived (the dashboard closed or reloaded mid-batch, the connection
-- dropped), the sitting was left finished with nothing on file: the
-- student could not get back in, and the monitor no longer showed them.
--
-- force_submit_sitting() does all of it in one transaction. The sitting
-- row is locked, so two dashboards (or a dashboard and the auto-sweep)
-- cannot both file it; the paper is filed from what the sitting saved; and
-- only then is the sitting marked finished. If filing fails, nothing has
-- changed — the sitting is still open, still on the monitor, and can be
-- tried again.
--
-- Only an instructor of the paper may call it (can_manage_paper, sql/094).
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.force_submit_sitting(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s         public.live_sessions%ROWTYPE;
  v_paper   uuid;
  v_minutes int;
  v_taken   int;
  v_answers jsonb;
  v_out     jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to submit a sitting.' USING ERRCODE = '42501';
  END IF;

  -- Held until this call ends: a second Force Submit of the same sitting
  -- waits here, then finds it finished.
  SELECT * INTO s FROM public.live_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'gone');
  END IF;

  v_paper := s.exam_id;   -- what the dashboard filed against, and what
                           -- submit_assessment() reads the working by
  IF NOT public.can_manage_paper(v_paper) THEN
    RAISE EXCEPTION 'Only this paper''s instructors can submit its sittings.' USING ERRCODE = '42501';
  END IF;

  IF s.status = 'finished' THEN
    RETURN jsonb_build_object('outcome', 'already');
  END IF;

  -- The time it took, up to the paper's length — as the dashboard worked it out.
  SELECT duration_minutes INTO v_minutes FROM public.assessments WHERE id = v_paper;
  v_taken := greatest(floor(extract(epoch FROM now() - s.created_at))::int, 0);
  IF v_minutes IS NOT NULL THEN v_taken := least(v_taken, v_minutes * 60); END IF;

  -- The picked answers the sitting saved, blanks dropped (answersPayload()
  -- in the dashboard; answer_index_set() is its twin, sql/018).
  SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO v_answers
    FROM jsonb_each(CASE WHEN jsonb_typeof(s.answers_json) = 'object'
                         THEN s.answers_json ELSE '{}'::jsonb END) AS e
   WHERE public.answer_index_set(e.value) IS NOT NULL;

  -- Files the paper (results, or review_attempts on a paper with retakes)
  -- and the typed working from this same sitting (sql/039, 083). An error
  -- here undoes the whole call, so the sitting is never left closed with
  -- nothing on file.
  v_out := public.submit_assessment(
    s.student_id, v_paper, v_answers, v_taken,
    coalesce(s.violation_count, 0),
    CASE WHEN jsonb_typeof(s.violation_log) = 'array' THEN s.violation_log ELSE '[]'::jsonb END);

  UPDATE public.live_sessions SET status = 'finished', updated_at = now() WHERE id = s.id;

  RETURN coalesce(v_out, '{}'::jsonb)
         || jsonb_build_object('outcome', 'filed', 'time_taken_seconds', v_taken);
END $$;

REVOKE ALL ON FUNCTION public.force_submit_sitting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.force_submit_sitting(uuid) TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  has_function_privilege('authenticated', 'public.force_submit_sitting(uuid)', 'EXECUTE') AS instructors_can_call_it,
  NOT has_function_privilege('anon', 'public.force_submit_sitting(uuid)', 'EXECUTE')    AS students_cannot,
  position('FOR UPDATE' IN p.prosrc) > 0                                               AS one_dashboard_at_a_time,
  position('can_manage_paper' IN p.prosrc) > 0                                         AS only_the_papers_instructors
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'force_submit_sitting';
