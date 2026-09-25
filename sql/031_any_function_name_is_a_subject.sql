-- =====================================================================
-- 031 — g'(x), p'(u) and r''(z) are labels too
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- normalize_math() strips a SUBJECT from the front of an answer, so that
-- y'=5 and 5 are one answer. The list of subjects it knew was written when
-- every question on the paper used y and x, and it named them literally:
-- y, y', dy/dx, f(x), f'(x).
--
-- A paper that varies its notation on purpose — g(x), d(t), r(z), q(w),
-- s(t), p(u) — walks straight past it. A student answering
--     p'(u) = -6(2u+1)^{-4}
-- was compared against an accept list holding the unlabelled form, and the
-- label they had every reason to write kept them apart.
--
-- The subject is now recognised by its SHAPE rather than by a list of
-- names: one letter, any number of primes, optionally applied to one
-- variable. That covers f(x), g'(x), r''(z), p'(u), y, y''' and the Leibniz
-- forms, and it cannot be outgrown by the next paper.
--
-- WHAT IS STILL NOT A SUBJECT, and must not become one: 2x. A coefficient
-- makes it an expression, so 2x = 6 keeps its left-hand side and does not
-- pass as the answer x = 3.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_math(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH s0 AS (SELECT coalesce(p, '') AS t),
  s1 AS (SELECT regexp_replace(t, '\\[,;:!]|\\quad|\\qquad|\\ ', '', 'g') AS t FROM s0),
  s2 AS (SELECT regexp_replace(t, '\\left|\\right', '', 'g') AS t FROM s1),
  s3 AS (SELECT regexp_replace(t, '\\[dt]frac', '\frac', 'g') AS t FROM s2),
  s4 AS (SELECT regexp_replace(t, '\\cdot|\\times|\*', '', 'g') AS t FROM s3),
  s5 AS (SELECT regexp_replace(t, '\s+', '', 'g') AS t FROM s4),
  s6 AS (SELECT lower(t) AS t FROM s5),
  -- The editor writes ^{\prime}; a person writes '. Longest first.
  s7 AS (SELECT replace(replace(replace(replace(replace(replace(t,
           '^{\prime\prime\prime}', ''''''),
           '^{\prime\prime}',       ''''),
           '^{\prime}',             ''''),
           '\doubleprime',          ''''),
           '^\prime',               ''''),
           '\prime',                '''') AS t FROM s6),
  -- An empty superscript is a power that was opened and never filled.
  s8 AS (SELECT replace(t, '^{}', '') AS t FROM s7),
  s9 AS (SELECT regexp_replace(regexp_replace(t, '\{([a-z0-9])\}', '\1', 'g'),
                               '\{([a-z0-9])\}', '\1', 'g') AS t FROM s8),
  -- ── THE SUBJECT ──────────────────────────────────────────────────
  -- Recognised by shape: one letter, any number of primes, optionally
  -- applied to one variable. f(x), g'(x), r''(z), p'(u), y, y''' and both
  -- Leibniz spellings. NOT 2x — a coefficient makes it an expression, which
  -- is what stops 2x=6 passing as x=3.
  s10 AS (SELECT CASE
           WHEN t ~ '^([a-z]''*(\([a-z]\))?|\\frac\{d[a-z]\}\{d[a-z]\}|d[a-z]/d[a-z]|\\frac\{d\^?[0-9]*[a-z]\}\{d[a-z]\^?[0-9]*\})='
           THEN regexp_replace(t, '^[^=]*=', '')
           ELSE t END AS t FROM s9),
  s11 AS (SELECT CASE WHEN t ~ '^\((.*)\)$' AND length(t) > 2
                      THEN substring(t from 2 for length(t) - 2)
                      ELSE t END AS t FROM s10),
  s12 AS (SELECT replace(replace(t, '+-', '-'), '--', '+') AS t FROM s11)
  SELECT t FROM s12;
$$;

-- math_as_number strips a subject too and must agree.
CREATE OR REPLACE FUNCTION public.math_as_number(p text)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE t text; parts text[]; num numeric; den numeric; sign numeric := 1;
BEGIN
  t := lower(regexp_replace(
         regexp_replace(
           regexp_replace(coalesce(p,''), '\\[,;:!]|\\quad|\\qquad|\\ ', '', 'g'),
           '\\left|\\right', '', 'g'),
         '\s+', '', 'g'));
  t := regexp_replace(t, '\\[dt]frac', '\frac', 'g');
  t := replace(replace(replace(t, '^{\prime\prime}', ''''), '^{\prime}', ''''), '^\prime', '''');
  IF t ~ '^([a-z]''*(\([a-z]\))?|\\frac\{d[a-z]\}\{d[a-z]\}|d[a-z]/d[a-z])=' THEN
    t := regexp_replace(t, '^[^=]*=', '');
  END IF;
  IF t ~ '^-?[0-9]+(\.[0-9]+)?$' THEN RETURN t::numeric; END IF;
  IF t ~ '^-' THEN sign := -1; t := substring(t from 2); END IF;
  parts := regexp_match(t, '^\\frac\{(-?[0-9]+)\}\{(-?[0-9]+)\}$');
  IF parts IS NULL THEN parts := regexp_match(t, '^\\frac([0-9])([0-9])$'); END IF;
  IF parts IS NOT NULL THEN
    num := parts[1]::numeric; den := parts[2]::numeric;
    IF den = 0 THEN RETURN NULL; END IF;
    RETURN sign * (num / den);
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================
SELECT public.math_answers_match('p^{\prime}(u)=-6(2u+1)^{-4}', '-6(2u+1)^{-4}') AS p_prime_u,
       public.math_answers_match('g''(x)=5', '5')                                AS g_prime_x,
       public.math_answers_match('r''''(z)=2z', '2z')                            AS r_double_prime,
       public.math_answers_match('d''(t)=15', '15')                              AS d_prime_t,
       public.math_answers_match('y=5', '5')                                     AS plain_y;
-- all true.

SELECT public.math_answers_match('2x=6', 'x=3')   AS must_be_false_1,
       public.math_answers_match('2x=6', '6')     AS must_be_false_2;
-- both false: a coefficient makes it an expression, not a label.
