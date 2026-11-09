-- =====================================================================
-- 148 — A part with no unit is marked on its value alone
--
-- Run once in the Supabase SQL editor. Safe to run twice. Needs 105 and 123.
--
-- A value-and-unit part (sql/105) can already ask for a plain number, such
-- as a slope, by carrying no units and unit_marks 0. Its marks were right,
-- but the marker still filed it under "Unit wrong or missing" and the
-- review showed "unit ✗", so a student retrying an assignment was told to
-- add a unit that does not exist.
--
-- Such a part is now marked on its value alone: its unit is never called
-- wrong, and each part says whether it has no unit ("no_unit"), so the
-- review can leave the unit out. Marks do not change on any paper, because
-- the unit of such a part was worth 0; only the reason and the ticks do.
--
-- The dashboard's copy is markQuantities() in src/lib/quantityAnswer.js;
-- sql/test/quantity_answers.test.mjs runs both.
-- =====================================================================

BEGIN;

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
  v_nounit boolean;
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
    -- 148: a part with no unit (units empty, unit_marks 0) is marked on its
    -- value alone, and its unit is never called wrong.
    v_nounit := coalesce(jsonb_typeof(part -> 'unit_marks') = 'number'
                         AND (part ->> 'unit_marks')::numeric = 0
                         AND (jsonb_typeof(part -> 'units') IS DISTINCT FROM 'array'
                              OR jsonb_array_length(part -> 'units') = 0), false);
    v_uok := v_nounit OR v_num IS NOT NULL
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
      'of', v_vm + v_um, 'no_unit', v_nounit));
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

REVOKE EXECUTE ON FUNCTION public.mark_quantities(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
WITH r AS (
  SELECT '{"mode":"quantity","parts":[
            {"key":"a","value":"12","decimals":0,"units":["m/s"],"value_marks":1,"unit_marks":1},
            {"key":"b","value":"0.52","decimals":2,"units":[],"value_marks":2,"unit_marks":0}]}'::jsonb AS rubric
)
SELECT
  public.mark_quantities('["a) 12 m/s", "b) 0.52"]'::jsonb, r.rubric) ->> 'reason'
    = 'Every value and unit right.'                                               AS a_plain_number_is_all_right,
  public.mark_quantities('["a) 11 m/s", "b) 0.52"]'::jsonb, r.rubric) ->> 'reason'
    = 'Value wrong: a.'                                                           AS no_unit_is_never_called_wrong,
  (public.mark_quantities('["a) 12", "b) 0.50"]'::jsonb, r.rubric) ->> 'marks')::numeric = 1
                                                                                  AS marks_as_before,
  (public.mark_quantities('["b) 0.52"]'::jsonb, r.rubric) -> 'parts' -> 1 ->> 'no_unit')::boolean
                                                                                  AS part_says_it_has_no_unit,
  NOT has_function_privilege('anon', 'public.mark_quantities(jsonb, jsonb)', 'EXECUTE') AS students_cannot_call_it
FROM r;
