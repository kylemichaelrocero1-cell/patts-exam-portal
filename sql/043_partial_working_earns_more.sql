-- =====================================================================
-- 043 — the final answer with some of the working earns more than the
--       answer alone
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent. Needs 042.
--
-- Kyle's scheme for a full solution (y = sin^2(x^2)):
--   function + unsimplified derivative + simplified answer   5
--   function + simplified answer (no derivative step)         4   <- new
--   unsimplified derivative + simplified answer (no function) 4   <- new
--   simplified answer alone                                   3
--   unsimplified derivative, no final answer                  3
--
-- A final step may now carry "partial": what the answer on the last line
-- earns when SOME, but not all, of the earlier steps are written before it.
-- Without "partial" nothing changes: it falls back to "alone", so every
-- rubric written for 042 marks exactly as before.
--
-- Only mark_working() changes. Its JS twin is src/lib/stepMarking.js and
-- sql/test/working_line_by_line.test.mjs holds them together.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='mark_working') THEN
    RAISE EXCEPTION 'mark_working() is missing — run sql/042 first.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mark_working(p_lines jsonb, p_rubric jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  v_steps jsonb := CASE WHEN jsonb_typeof(p_rubric -> 'steps') = 'array'
                        THEN p_rubric -> 'steps' ELSE '[]'::jsonb END;
  v_lines text[];
  n_steps int; n_lines int;
  v_last int;                 -- the last step, 1-based
  v_full numeric; v_alone numeric; v_partial numeric; v_some boolean;
  v_line_steps jsonb := '[]'::jsonb;
  v_first int[];              -- first line each step matched (1-based), 0 = none
  v_best numeric := 0; v_reason text := NULL;
  v_chain boolean; v_prev int;
  i int; j int; v_hit int;
BEGIN
  SELECT coalesce(array_agg(t ORDER BY ord), ARRAY[]::text[]) INTO v_lines
  FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_lines) = 'array'
                                      THEN p_lines ELSE '[]'::jsonb END)
       WITH ORDINALITY AS e(t, ord)
  WHERE btrim(t) <> '';

  n_steps := jsonb_array_length(v_steps);
  n_lines := coalesce(array_length(v_lines, 1), 0);
  v_last  := n_steps;
  v_full  := coalesce((v_steps -> (n_steps - 1) ->> 'marks')::numeric, 0);
  v_alone := coalesce((v_steps -> (n_steps - 1) ->> 'alone')::numeric, 0);
  -- The final answer with SOME of the working before it. Absent, it is worth
  -- what the answer alone is, which is exactly 042's behaviour.
  v_partial := coalesce((v_steps -> (n_steps - 1) ->> 'partial')::numeric, v_alone);
  v_first := array_fill(0, ARRAY[greatest(n_steps, 1)]);

  IF n_steps = 0 THEN
    RETURN jsonb_build_object('marks', 0, 'of', 0, 'correct', false,
      'reason', 'This question has no answer key.', 'line_steps', '[]'::jsonb);
  END IF;
  IF n_lines = 0 THEN
    RETURN jsonb_build_object('marks', 0, 'of', v_full, 'correct', false,
      'reason', 'Nothing was written.', 'line_steps', '[]'::jsonb);
  END IF;

  -- Which step each line is. A line counts once, for the latest step it
  -- matches, so a line written for step 3 is never read as step 2.
  FOR j IN 1 .. n_lines LOOP
    v_hit := NULL;
    FOR i IN REVERSE n_steps .. 1 LOOP
      IF public.worked_answer_verdict(v_lines[j],
           coalesce(public.step_accepted(v_steps -> (i - 1)), ARRAY[]::text[])) IS NULL THEN
        v_hit := i; EXIT;
      END IF;
    END LOOP;
    -- jsonb_build_array, not to_jsonb: to_jsonb(NULL) is SQL NULL, and
    -- appending that wipes out the whole list.
    v_line_steps := v_line_steps || jsonb_build_array(v_hit);
    IF v_hit IS NOT NULL AND v_first[v_hit] = 0 THEN v_first[v_hit] := j; END IF;
  END LOOP;

  -- Any step before the last, wherever it was written.
  FOR i IN 1 .. n_steps - 1 LOOP
    IF v_first[i] > 0 AND coalesce((v_steps -> (i - 1) ->> 'marks')::numeric, 0) > v_best THEN
      v_best := (v_steps -> (i - 1) ->> 'marks')::numeric;
      v_reason := 'Part of the solution is right, but the final answer is not there yet.';
    END IF;
  END LOOP;

  -- The last step: only as the last line, which is the student's answer.
  IF (v_line_steps ->> (n_lines - 1)) IS NOT NULL
     AND (v_line_steps ->> (n_lines - 1))::int = v_last THEN
    v_chain := true; v_prev := 0;
    FOR i IN 1 .. n_steps - 1 LOOP
      IF v_first[i] = 0 OR v_first[i] <= v_prev OR v_first[i] >= n_lines THEN
        v_chain := false; EXIT;
      END IF;
      v_prev := v_first[i];
    END LOOP;
    -- Some earlier step written on a line before the answer, even if not all.
    v_some := false;
    FOR i IN 1 .. n_steps - 1 LOOP
      IF v_first[i] > 0 AND v_first[i] < n_lines THEN v_some := true; END IF;
    END LOOP;
    IF v_chain AND v_full >= v_best THEN
      v_best := v_full; v_reason := 'Correct, with the working shown.';
    ELSIF NOT v_chain AND v_some AND v_partial >= v_best AND v_partial > v_alone THEN
      v_best := v_partial;
      v_reason := 'The final answer is right, but a step of the working is missing.';
    ELSIF NOT v_chain AND v_alone > v_best THEN
      v_best := v_alone;
      v_reason := 'The final answer is right, but the working that leads to it is not all shown.';
    ELSIF NOT v_chain AND v_alone >= v_best THEN
      v_reason := 'The final answer is right, but the working that leads to it is not all shown.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'marks', v_best, 'of', v_full, 'correct', v_best >= v_full AND v_full > 0,
    'reason', coalesce(v_reason, 'None of these lines is a step of the solution.'),
    'line_steps', v_line_steps);
END $$;


COMMIT;

-- =====================================================================
-- VERIFY — one row: 4, 3, 5.
-- =====================================================================
SELECT
  (public.mark_working('["y=x^2","y''=2x"]'::jsonb,
     '{"mode":"lines","steps":[{"latex":"y=x^2","marks":0},{"latex":"y''=2x\\cdot1","marks":3},{"latex":"y''=2x","marks":5,"alone":3,"partial":4}]}'::jsonb)
     ->> 'marks')::numeric AS function_and_answer_4,
  (public.mark_working('["y''=2x"]'::jsonb,
     '{"mode":"lines","steps":[{"latex":"y=x^2","marks":0},{"latex":"y''=2x\\cdot1","marks":3},{"latex":"y''=2x","marks":5,"alone":3,"partial":4}]}'::jsonb)
     ->> 'marks')::numeric AS answer_alone_3,
  (public.mark_working('["y=x^2","y''=2x\\cdot1","y''=2x"]'::jsonb,
     '{"mode":"lines","steps":[{"latex":"y=x^2","marks":0},{"latex":"y''=2x\\cdot1","marks":3},{"latex":"y''=2x","marks":5,"alone":3,"partial":4}]}'::jsonb)
     ->> 'marks')::numeric AS everything_5;
