-- =====================================================================
-- 123 — A typed value can be right within a tolerance
--
-- Run once in the Supabase SQL editor. Safe to run twice.
--
-- A value-and-unit part (sql/105) earns its value marks only when the
-- number rounds, at the places asked, to the key. On a problem worked from
-- physical constants that is too strict: a student who takes R = 287
-- rather than 287.08, reads σ from a table, or rounds each line as the
-- paper asks and carries it on, lands a place or two away from the key
-- with a correct method.
--
-- A part may now carry two more fields:
--   "tolerance"  a fraction of the value, e.g. 0.001 for 0.1%
--   "exact"      the unrounded key the tolerance is measured from
-- and the value is also right when it lies within half a unit of the last
-- place asked plus that fraction of the exact value:
--   |typed − exact| ≤ ½·10^−decimals + tolerance·|exact|
-- Without "exact" the rounded key is used; without "tolerance" nothing
-- changes, so every paper marked today marks the same tomorrow. The
-- tolerance is capped at 5%.
--
-- The dashboard's copy is quantityValueNear() in
-- src/lib/quantityAnswer.js; sql/test/quantity_answers.test.mjs runs both.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.quantity_value_near(
  p_number text, p_key text, p_decimals integer, p_exact text, p_tolerance text
) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH t AS (
    SELECT CASE WHEN p_tolerance ~ '^\d*\.?\d+$' AND p_tolerance::numeric > 0
                THEN least(p_tolerance::numeric, 0.05) END AS tol,
           CASE WHEN p_exact ~ '^-?\d*\.?\d+$' THEN p_exact
                WHEN p_key ~ '^-?\d*\.?\d+$' THEN p_key END AS ref,
           greatest(0, least(10, coalesce(p_decimals, 0))) AS d
  )
  SELECT CASE
    WHEN p_number IS NULL OR p_number !~ '^-?\d*(\.\d*)?$' OR p_number !~ '\d' THEN false
    WHEN t.tol IS NULL OR t.ref IS NULL THEN false
    ELSE abs(p_number::numeric - t.ref::numeric)
           <= 0.5 * power(10::numeric, -t.d) + t.tol * abs(t.ref::numeric)
  END
  FROM t;
$$;

-- 105's marker, with the value also right within the part's tolerance.
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
  v_dec   integer;
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
    v_dec := CASE WHEN (part ->> 'decimals') ~ '^\d+$' THEN (part ->> 'decimals')::integer ELSE 0 END;
    v_vok := public.quantity_value_ok(v_num, part ->> 'value', v_dec)
             OR public.quantity_value_near(v_num, part ->> 'value', v_dec, part ->> 'exact', part ->> 'tolerance');
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

REVOKE EXECUTE ON FUNCTION public.quantity_value_near(text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_quantities(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  public.quantity_value_near('253.06', '253.11', 2, '253.109', '0.001')            AS within_tolerance_is_right,
  NOT public.quantity_value_near('250.00', '253.11', 2, '253.109', '0.001')        AS outside_is_wrong,
  public.quantity_value_near('0.56', '0.57', 2, '0.565', '0.001')                  AS a_rounding_flip_is_right,
  NOT public.quantity_value_near('253.06', '253.11', 2, NULL, NULL)                AS no_tolerance_no_change,
  (public.mark_quantities('["a) 253.06 m/s"]'::jsonb,
     '{"mode":"quantity","parts":[{"key":"a","value":"253.11","decimals":2,"units":["m/s"],"value_marks":2,"unit_marks":2,"exact":"253.109","tolerance":"0.001"}]}'::jsonb)
     ->> 'marks')::numeric = 4                                                       AS marker_uses_it,
  (public.mark_quantities('["a) 253.06 m/s"]'::jsonb,
     '{"mode":"quantity","parts":[{"key":"a","value":"253.11","decimals":2,"units":["m/s"],"value_marks":2,"unit_marks":2}]}'::jsonb)
     ->> 'marks')::numeric = 2                                                       AS papers_without_it_unchanged,
  NOT has_function_privilege('anon', 'public.quantity_value_near(text, text, integer, text, text)', 'EXECUTE') AS students_cannot_call_it;
