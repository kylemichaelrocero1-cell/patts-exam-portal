-- =====================================================================
-- 119 — {\displaystyle …} around a typed answer is not part of it
--
-- Run once in the Supabase SQL editor. Safe to run twice.
--
-- A line can reach the marker wrapped in a style command,
-- y^{\prime}={\displaystyle8\operatorname{\mathrm{sech}}^2(2x)}, which is
-- what a pasted or keyboard-built expression sometimes carries. The marker
-- read the wrapper as part of the answer, so a correct line was marked
-- "not a step". \displaystyle, \textstyle and \scriptstyle change how big
-- maths is drawn, never what it says: the command goes, and a {…} it
-- opened goes with it, keeping what is inside.
--
-- The first step of every comparison, math_drop_spaces(), now does this,
-- so normalize_math(), math_as_number(), the label check and the line by
-- line marker all see the answer without it. The dashboard's copy,
-- dropSpaces() in src/lib/mathNormalize.js, does the same
-- (sql/test/display_style.test.mjs runs both over one list).
-- =====================================================================

BEGIN;

-- The style commands out, and the braces of any group one opened.
-- math_close() (050) finds the brace that closes the group.
CREATE OR REPLACE FUNCTION public.math_unstyle(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  t text := coalesce(p, '');
  v_open  constant text := '\{\s*\\(?:display|text|script|scriptscript)style(?![a-zA-Z])';
  v_at    int;
  v_len   int;
  v_close int;
  v_guard int := 0;
BEGIN
  IF strpos(t, 'style') = 0 THEN RETURN t; END IF;
  LOOP
    v_guard := v_guard + 1;
    EXIT WHEN v_guard > 50;
    v_at := regexp_instr(t, v_open);
    EXIT WHEN v_at = 0;
    v_len := length(substring(t from v_open));
    v_close := public.math_close(t, v_at);
    EXIT WHEN v_close = 0;
    t := left(t, v_at - 1) || substr(t, v_at + v_len, v_close - v_at - v_len) || substr(t, v_close + 1);
  END LOOP;
  RETURN regexp_replace(t, '\\(?:display|text|script|scriptscript)style(?![a-zA-Z])', '', 'g');
END $$;

-- 038's function, with the style commands taken out first.
CREATE OR REPLACE FUNCTION public.math_drop_spaces(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(public.math_unstyle(p),
                 '\\[,;:!> ]|\\q?quad|\\(neg)?(thin|med|thick)space|\\enspace|\\hspace\*?\{[^}]*\}|~',
                 '', 'g'),
               '[\^_]\{\s*\}', '', 'g'),
             '^\s*\^\{(.*)\}\s*$', '\1'),
           '\\(long)?rightarrow(?![a-zA-Z])|\\overrightarrow\{\s*\}', '\\to', 'g');
$$;

COMMIT;

-- =====================================================================
-- VERIFY — expect: true, true, true, true
-- =====================================================================
SELECT public.math_unstyle('y^{\prime}={\displaystyle8\operatorname{\mathrm{sech}}^2(2x)}')
         = 'y^{\prime}=8\operatorname{\mathrm{sech}}^2(2x)'                       AS wrapper_goes,
       public.math_answers_match('y^{\prime}={\displaystyle5\frac{1}{x}}', 'y''=\frac{5}{x}')
         IS NOT DISTINCT FROM public.math_answers_match('y^{\prime}=5\frac{1}{x}', 'y''=\frac{5}{x}') AS marks_as_without,
       public.math_drop_spaces('\textstyle\frac{1}{2}') = '\frac{1}{2}'              AS bare_command_goes,
       public.math_drop_spaces('\textstyleless{x}') = '\textstyleless{x}'          AS other_commands_kept;
