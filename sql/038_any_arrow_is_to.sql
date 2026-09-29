-- =====================================================================
-- 038 — Any arrow in a limit is \to
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- NEEDS 037. Changes how answers are COMPARED; marks nothing by itself.
--
-- A key writes its limit \lim_{h\to 0}. A student who types the arrow
-- rather than using the limit button gets whichever arrow the keyboard
-- offered them — \rightarrow, \longrightarrow, or \overrightarrow{} (a
-- vector arrow with nothing under it, which draws as an arrow) — and every
-- one of them made a perfect answer wrong:
--
--   f'(x) = \lim_{h\rightarrow 0}\frac{(x+h)^2-x^2}{h}    was wrong
--   f'(x) = \lim_{h\to 0}\frac{(x+h)^2-x^2}{h}            was right
--
-- They are one symbol read one way, so they are now one symbol:
-- \rightarrow, \longrightarrow and an EMPTY \overrightarrow{} all become
-- \to. A \overrightarrow with something under it is a vector, not an
-- arrow, and is left alone; so is \Rightarrow, which means "implies".
--
-- Done in math_drop_spaces(), the first tidying step of normalize_math(),
-- math_as_number() and math_label() alike (036, 037). The dashboard's copy
-- (src/lib/mathNormalize.js) tidies the same way; sql/test/
-- keyboard_leftovers.test.mjs checks the two agree.
-- =====================================================================

BEGIN;

-- 037's function, with the arrows added as its last step.
CREATE OR REPLACE FUNCTION public.math_drop_spaces(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(coalesce(p, ''),
                 '\\[,;:!> ]|\\q?quad|\\(neg)?(thin|med|thick)space|\\enspace|\\hspace\*?\{[^}]*\}|~',
                 '', 'g'),
               '[\^_]\{\s*\}', '', 'g'),
             '^\s*\^\{(.*)\}\s*$', '\1'),
           '\\(long)?rightarrow(?![a-zA-Z])|\\overrightarrow\{\s*\}', '\\to', 'g');
$$;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================
SELECT public.worked_answer_verdict('f^{\prime}\left(x\right)=\lim_{h\rightarrow0}\frac{\left(x+h\right)^3-x^3}{h}',
                                    ARRAY['f''(x)=\lim_{h\to 0}\frac{(x+h)^3-x^3}{h}']) AS rightarrow,
       public.worked_answer_verdict('f^{\prime}\left(x\right)=\lim_{h\overrightarrow{}0}\frac{\left(x+h\right)^3-x^3}{h}',
                                    ARRAY['f''(x)=\lim_{h\to 0}\frac{(x+h)^3-x^3}{h}']) AS empty_vector_arrow,
       public.worked_answer_verdict('f^{\prime}\left(x\right)=\lim_{h\longrightarrow0}\frac{\left(x+h\right)^3-x^3}{h}',
                                    ARRAY['f''(x)=\lim_{h\to 0}\frac{(x+h)^3-x^3}{h}']) AS longrightarrow,
       public.normalize_math('\overrightarrow{v}') AS a_real_vector_is_kept;
-- NULL, NULL, NULL (NULL means correct), and \overrightarrow{v} unchanged.
