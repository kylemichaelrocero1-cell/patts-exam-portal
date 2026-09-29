-- =====================================================================
-- 037 — The maths keyboard's leftovers are not part of an answer
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- NEEDS 036. Changes how answers are COMPARED; marks nothing by itself.
--
-- Found in a real paper's answers. The keyboard leaves empty
-- boxes behind when a student moves on from a superscript or subscript
-- without typing in it, and whole answers can end up typed INSIDE one:
--
--   f^{\prime^{}\prime}(x) = 6x              a second derivative, with an
--                                            empty ^{} between its primes
--   -9(3u+2_{})^{-4}                         an empty subscript on the 2
--   y^{\prime}^{\prime}^{\prime} =^{} 24x    an empty ^{} after the = (this
--                                            one normalize_math already
--                                            handled; the dashboard did not)
--   ^{\frac{dy}{dx} = \frac{-2x}{y}}         the whole answer typed in a
--                                            superscript with nothing
--                                            under it
--
-- An empty ^{} or _{} says nothing, and a superscript with no base is not
-- maths at all. All are now removed before anything else is read — in
-- math_drop_spaces(), the first step of normalize_math(), math_as_number()
-- and math_label() alike (036), so one change reaches all three.
--
-- The dashboard's marker tidies the same way (src/lib/mathNormalize.js and
-- mathLabel.js); sql/test/keyboard_leftovers.test.mjs checks they agree.
-- =====================================================================

BEGIN;

-- Everything that is not part of an answer: every kind of LaTeX space
-- (036), empty superscripts and subscripts, and a superscript with no base
-- wrapped round the whole answer.
CREATE OR REPLACE FUNCTION public.math_drop_spaces(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(p, ''),
               '\\[,;:!> ]|\\q?quad|\\(neg)?(thin|med|thick)space|\\enspace|\\hspace\*?\{[^}]*\}|~',
               '', 'g'),
             '[\^_]\{\s*\}', '', 'g'),
           '^\s*\^\{(.*)\}\s*$', '\1');
$$;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================
SELECT public.worked_answer_verdict('f^{\prime^{}\prime}\left(x\right)=6x', ARRAY['f''''(x)=6x']) AS empty_box_between_primes,
       public.worked_answer_verdict('y^{\prime}^{\prime}^{\prime}=^{}24x', ARRAY['\frac{d^3y}{dx^3}=24x']) AS empty_box_after_equals,
       public.worked_answer_verdict('^{\frac{dy}{dx}=\frac{-2x}{y}}', ARRAY['\frac{dy}{dx}=-\frac{2x}{y}']) AS answer_inside_a_superscript,
       public.worked_answer_verdict('p^{\prime}\left(u\right)=-9\left(3u+2_{}\right)^{-4}', ARRAY['p''(u)=-\frac{9}{(3u+2)^4}', '-9(3u+2)^{-4}']) AS empty_subscript,
       public.worked_answer_verdict('x^2', ARRAY['x^2']) AS a_real_power_is_untouched;
-- All NULL (NULL means correct).
