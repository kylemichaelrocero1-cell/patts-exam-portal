-- =====================================================================
-- 105 — a problem answered as quantities: a point for each value, a point
--       for each unit
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 046 (text answers) and 073 (the marker this extends). Run it
-- before loading a paper that uses it; the frontend that comes with it
-- reads a missing mode as an ordinary typed item, so either deploy order
-- is safe for papers that do not use it.
--
-- An engineering problem's answer is a number AND a unit — "EOQ = 24.49
-- bottles per order" — and the two are worth a mark each. Neither typed
-- mode could say that: a maths line is one string against a key, a word
-- is one word. So a worked_solution item may now have
--
--   work_given:  one line per part, "a) Economic order quantity …"
--   work_rubric: {"mode":"quantity","parts":[{"key":"a","value":"24.49",
--                 "decimals":2,"units":["bottles/order",…],
--                 "value_marks":1,"unit_marks":1}, …]}
--
-- The exam screen is sent work_given and the mode, as every typed item is
-- (042), and draws one box per part; never the rubric. A student's answer
-- is stored a line per part, each starting with its letter: "a) 24.49
-- bottles/order". mark_quantities() reads each line's number (after any
-- "=", thousands commas allowed) and the rest as its unit:
--
--   * the value earns its mark when it rounds, half away from zero at the
--     part's decimal places, to the key — the paper says how to round, and
--     more places than asked are not wrong;
--   * the unit earns its mark when it is one the part accepts, compared
--     without case, spaces or punctuation, with "per" as "/", ₱ as php,
--     and a plural s dropped; and only beside a number.
--
-- JS twin: src/lib/quantityAnswer.js. sql/test/quantity_answers.test.mjs
-- runs both over the same answers.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='logic_mark') THEN
    RAISE EXCEPTION 'logic_mark() is missing — run sql/073 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Reading an answer
-- ---------------------------------------------------------------------
-- What follows the last "=": "EOQ = 24.49 …" reads as " 24.49 …".
CREATE OR REPLACE FUNCTION public.quantity_after_equals(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(replace(coalesce(p_text, ''), '−', '-'), '^.*=', '');
$$;

-- The first number, as plain digits: "1,200." is 1200, ".5" is 0.5.
CREATE OR REPLACE FUNCTION public.quantity_number(p_text text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  n text;
BEGIN
  n := (regexp_match(public.quantity_after_equals(p_text),
                     '(-?(?:\d[\d,]*(?:\.\d*)?|\.\d+))'))[1];
  IF n IS NULL THEN RETURN NULL; END IF;
  n := replace(n, ',', '');
  IF right(n, 1) = '.' THEN n := left(n, -1); END IF;
  IF left(n, 1) = '.' THEN n := '0' || n;
  ELSIF left(n, 2) = '-.' THEN n := '-0' || substr(n, 2);
  END IF;
  IF n IN ('', '-') THEN RETURN NULL; END IF;
  RETURN n;
END $$;

-- Everything else: the unit as typed.
CREATE OR REPLACE FUNCTION public.quantity_unit_text(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(public.quantity_after_equals(p_text),
                              '-?(?:\d[\d,]*(?:\.\d*)?|\.\d+)', ' '));
$$;

-- What a unit is compared as. "Bottles per order", "bottle/order" and
-- "bottles / orders" are one key.
CREATE OR REPLACE FUNCTION public.quantity_unit_key(p_unit text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 replace(lower(coalesce(p_unit, '')), '₱', 'php'),
                 '\mper\M', '/', 'g'),
               '[^a-z0-9/%$]', '', 'g'),
             '/+', '/', 'g'),
           '([a-z]*[a-rt-z])s(?![a-z])', '\1', 'g');
$$;

-- Does the value round, at p_decimals places, to the key?
CREATE OR REPLACE FUNCTION public.quantity_value_ok(p_number text, p_key text, p_decimals integer)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_number IS NULL OR p_key IS NULL THEN false
    WHEN p_number !~ '^-?\d*(\.\d*)?$' OR p_number !~ '\d'
      OR p_key !~ '^-?\d*(\.\d*)?$' OR p_key !~ '\d' THEN false
    ELSE round(p_number::numeric, greatest(0, least(10, coalesce(p_decimals, 0))))
       = round(p_key::numeric, greatest(0, least(10, coalesce(p_decimals, 0))))
  END;
$$;

-- ---------------------------------------------------------------------
-- 2. Marking the parts
-- ---------------------------------------------------------------------
-- Returns {marks, of, parts:[{key, blank, value_ok, unit_ok, marks, of}],
-- reason}. The reason names parts, never the key.
CREATE OR REPLACE FUNCTION public.mark_quantities(p_lines jsonb, p_rubric jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  v_typed jsonb := '{}'::jsonb;
  v_line  text;
  m       text[];
  part    jsonb;
  v_text  text;
  v_blank boolean;
  v_num   text;
  v_vok   boolean;
  v_uok   boolean;
  v_vm    numeric;
  v_um    numeric;
  v_parts jsonb := '[]'::jsonb;
  v_marks numeric := 0;
  v_of    numeric := 0;
  v_bad_value text[] := '{}';
  v_bad_unit  text[] := '{}';
  v_blanks    text[] := '{}';
  v_reason text := '';
BEGIN
  IF jsonb_typeof(p_lines) = 'array' THEN
    FOR v_line IN SELECT jsonb_array_elements_text(p_lines) LOOP
      m := regexp_match(v_line, '^\s*([a-z])\)\s?(.*)$');
      IF m IS NOT NULL THEN
        v_typed := v_typed || jsonb_build_object(m[1], m[2]);
      END IF;
    END LOOP;
  END IF;

  FOR part IN SELECT e FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(p_rubric -> 'parts') = 'array'
                     THEN p_rubric -> 'parts' ELSE '[]'::jsonb END) AS e
  LOOP
    v_text := coalesce(v_typed ->> (part ->> 'key'), '');
    v_blank := v_text !~ '\S';
    v_num := CASE WHEN v_blank THEN NULL ELSE public.quantity_number(v_text) END;
    v_vok := public.quantity_value_ok(v_num, part ->> 'value',
               CASE WHEN (part ->> 'decimals') ~ '^\d+$' THEN (part ->> 'decimals')::integer ELSE 0 END);
    v_uok := v_num IS NOT NULL
             AND public.quantity_unit_key(public.quantity_unit_text(v_text)) <> ''
             AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(
                           CASE WHEN jsonb_typeof(part -> 'units') = 'array'
                                THEN part -> 'units' ELSE '[]'::jsonb END) AS u(v)
                          WHERE public.quantity_unit_key(u.v) <> ''
                            AND public.quantity_unit_key(u.v)
                              = public.quantity_unit_key(public.quantity_unit_text(v_text)));
    v_vm := CASE WHEN jsonb_typeof(part -> 'value_marks') = 'number' AND (part ->> 'value_marks')::numeric >= 0
                 THEN (part ->> 'value_marks')::numeric ELSE 1 END;
    v_um := CASE WHEN jsonb_typeof(part -> 'unit_marks') = 'number' AND (part ->> 'unit_marks')::numeric >= 0
                 THEN (part ->> 'unit_marks')::numeric ELSE 1 END;

    v_marks := v_marks + CASE WHEN v_vok THEN v_vm ELSE 0 END + CASE WHEN v_uok THEN v_um ELSE 0 END;
    v_of := v_of + v_vm + v_um;
    v_parts := v_parts || jsonb_build_array(jsonb_build_object(
      'key', part ->> 'key', 'blank', v_blank, 'value_ok', v_vok, 'unit_ok', v_uok,
      'marks', CASE WHEN v_vok THEN v_vm ELSE 0 END + CASE WHEN v_uok THEN v_um ELSE 0 END,
      'of', v_vm + v_um));
    IF v_blank THEN v_blanks := v_blanks || (part ->> 'key');
    ELSE
      IF NOT v_vok THEN v_bad_value := v_bad_value || (part ->> 'key'); END IF;
      IF NOT v_uok THEN v_bad_unit := v_bad_unit || (part ->> 'key'); END IF;
    END IF;
  END LOOP;

  IF cardinality(v_bad_value) > 0 THEN
    v_reason := v_reason || 'Value wrong: ' || array_to_string(v_bad_value, ', ') || '.';
  END IF;
  IF cardinality(v_bad_unit) > 0 THEN
    v_reason := v_reason || CASE WHEN v_reason = '' THEN '' ELSE ' ' END
             || 'Unit wrong or missing: ' || array_to_string(v_bad_unit, ', ') || '.';
  END IF;
  IF cardinality(v_blanks) > 0 THEN
    v_reason := v_reason || CASE WHEN v_reason = '' THEN '' ELSE ' ' END
             || 'Left blank: ' || array_to_string(v_blanks, ', ') || '.';
  END IF;
  IF v_reason = '' THEN v_reason := 'Every value and unit right.'; END IF;

  RETURN jsonb_build_object('marks', v_marks, 'of', v_of, 'parts', v_parts, 'reason', v_reason);
END $$;

-- Helpers of the marker, not for calling from a browser.
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN ('quantity_after_equals', 'quantity_number', 'quantity_unit_text',
                                'quantity_unit_key', 'quantity_value_ok', 'mark_quantities')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. The marker takes the quantity branch (body otherwise that of 073)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.score_worked_answers(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_attempt_no    integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_retakes boolean; v_answers jsonb; v_attempt integer;
  v_earned numeric := 0; v_total numeric := 0; v_patch jsonb := '{}'::jsonb;
  r record; v_ok boolean; v_line text; v_reason text; v_lines jsonb; v_m jsonb;
BEGIN
  SELECT allow_retakes INTO v_retakes FROM public.assessments WHERE id = p_assessment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown assessment'; END IF;

  IF v_retakes THEN
    SELECT coalesce(p_attempt_no, max(attempt_no)) INTO v_attempt
    FROM public.review_attempts
    WHERE student_id = p_student_id AND assessment_id = p_assessment_id;
    SELECT answers_json INTO v_answers FROM public.review_attempts
    WHERE student_id = p_student_id AND assessment_id = p_assessment_id
      AND attempt_no = v_attempt;
  ELSE
    SELECT answers_json INTO v_answers FROM public.results
    WHERE student_id = p_student_id AND assessment_id = p_assessment_id;
  END IF;
  IF v_answers IS NULL THEN v_answers := '{}'::jsonb; END IF;

  FOR r IN
    SELECT q.id, coalesce(q.marks,1)::numeric AS marks, q.work_rubric,
           public.accepted_answers(q.work_rubric) AS accepted
    FROM public.questions q
    WHERE q.exam_id = p_assessment_id
      AND coalesce(q.question_type,'multiple_choice') = 'worked_solution'
  LOOP
    v_total := v_total + r.marks;
    v_lines := CASE WHEN jsonb_typeof(v_answers -> r.id::text -> 'lines') = 'array'
                    THEN v_answers -> r.id::text -> 'lines' ELSE '[]'::jsonb END;

    IF r.work_rubric ->> 'mode' = 'quantity' THEN
      v_m := public.mark_quantities(v_lines, r.work_rubric);
      v_m := jsonb_set(v_m, '{marks}', to_jsonb(least((v_m ->> 'marks')::numeric, r.marks)));
      v_earned := v_earned + (v_m ->> 'marks')::numeric;
      v_patch := v_patch || jsonb_build_object(r.id::text, jsonb_build_object(
        'type','worked', 'lines', v_lines,
        'marks', (v_m ->> 'marks')::numeric, 'of', r.marks,
        'correct', (v_m ->> 'marks')::numeric >= r.marks,
        'reason', v_m ->> 'reason', 'parts', v_m -> 'parts'));
      CONTINUE;
    END IF;

    IF r.work_rubric ->> 'mode' IN ('lines', 'logic', 'simplify', 'proof') THEN
      v_m := CASE WHEN r.work_rubric ->> 'mode' = 'lines'
                  THEN public.mark_working(v_lines, r.work_rubric)
                  ELSE public.logic_mark(v_lines, r.work_rubric || jsonb_build_object('marks', r.marks)) END;
      -- Never more than the item is worth, whatever the rubric says.
      v_m := jsonb_set(v_m, '{marks}', to_jsonb(least((v_m ->> 'marks')::numeric, r.marks)));
      v_earned := v_earned + (v_m ->> 'marks')::numeric;
      v_patch := v_patch || jsonb_build_object(r.id::text, jsonb_build_object(
        'type','worked', 'lines', v_lines,
        'marks', (v_m ->> 'marks')::numeric, 'of', r.marks,
        'correct', (v_m ->> 'marks')::numeric >= r.marks,
        'reason', v_m ->> 'reason', 'line_steps', v_m -> 'line_steps'));
      CONTINUE;
    END IF;

    v_line := NULL;
    -- THE LAST LINE ONLY — see 027. One answer is one answer.
    SELECT t INTO v_line
    FROM jsonb_array_elements_text(v_lines) WITH ORDINALITY AS e(t, ord)
    WHERE btrim(t) <> ''
    ORDER BY ord DESC LIMIT 1;

    IF r.work_rubric ->> 'mode' = 'text' THEN
      v_reason := public.text_answer_verdict(v_line, coalesce(r.accepted, ARRAY[]::text[]));
    ELSE
      v_reason := public.working_verdict(v_line, coalesce(r.accepted, ARRAY[]::text[]));
    END IF;
    v_ok := v_line IS NOT NULL AND v_reason IS NULL;

    IF v_ok THEN v_earned := v_earned + r.marks; END IF;
    v_patch := v_patch || jsonb_build_object(r.id::text, jsonb_build_object(
      'type','worked',
      'lines', v_lines,
      'marks', CASE WHEN v_ok THEN r.marks ELSE 0 END,
      'of', r.marks,
      'correct', v_ok,
      'reason', CASE WHEN v_ok THEN 'Correct answer.' ELSE v_reason END));
  END LOOP;

  IF v_retakes THEN
    UPDATE public.review_attempts
       SET answers_json = coalesce(answers_json,'{}'::jsonb) || v_patch,
           work_marks = v_earned, work_total = v_total, work_marked_at = now()
     WHERE student_id = p_student_id AND assessment_id = p_assessment_id
       AND attempt_no = v_attempt;
  ELSE
    UPDATE public.results
       SET answers_json = coalesce(answers_json,'{}'::jsonb) || v_patch,
           work_marks = v_earned, work_total = v_total, work_marked_at = now()
     WHERE student_id = p_student_id AND assessment_id = p_assessment_id;
  END IF;

  RETURN jsonb_build_object('work_marks', v_earned, 'work_total', v_total,
                            'attempt_no', v_attempt);
END $$;

REVOKE ALL ON FUNCTION public.score_worked_answers(uuid,uuid,integer) FROM public;
REVOKE ALL ON FUNCTION public.score_worked_answers(uuid,uuid,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.score_worked_answers(uuid,uuid,integer) TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true. Look-alike quantities, not a paper's.
-- =====================================================================
SELECT
  public.quantity_number('Q = 1,250.5 crates per order') = '1250.5'                 AS number_after_equals,
  public.quantity_unit_key('Crates per Order') = public.quantity_unit_key('crate/orders') AS units_read_alike,
  public.quantity_unit_key('₱ per year') = public.quantity_unit_key('PHP/yr') IS FALSE    AS yr_is_not_year,
  public.quantity_value_ok('31.4159', '31.42', 2)                                    AS more_places_round_to_key,
  NOT public.quantity_value_ok('31.4', '31.42', 2)                                   AS fewer_places_are_wrong,
  (public.mark_quantities('["a) 31.42 crates per order", "b) 7 hours"]'::jsonb,
     '{"mode":"quantity","parts":[{"key":"a","value":"31.42","decimals":2,"units":["crates/order"]},
                                  {"key":"b","value":"6","decimals":0,"units":["days"]}]}'::jsonb)
     ->> 'marks')::numeric = 2                                                       AS a_problem_marks,
  (SELECT prosrc LIKE '%mark_quantities%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='score_worked_answers')                   AS marker_takes_quantity_branch,
  NOT has_function_privilege('anon', 'public.mark_quantities(jsonb,jsonb)', 'EXECUTE') AS marker_not_for_browsers;
