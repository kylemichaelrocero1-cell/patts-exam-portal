-- =====================================================================
-- 033 — A minus may sit on the numerator: \frac{-6}{7} is -\frac{6}{7}
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- The answer key says  p'(u) = -\frac{6}{(2u+1)^4}  and a student writes
--
--     p'(u) = \frac{-6}{(2u+1)^4}
--
-- which is the same number, and was marked wrong unless that exact spelling
-- happened to be in the item's accept list. The database compares answers
-- as strings (027) and nothing moved the sign.
--
-- normalize_math() now moves a minus from the front of a numerator to the
-- front of the fraction, so both spellings reach the same string — on every
-- item on every paper, without touching an accept list.
--
-- ONLY WHEN THE NUMERATOR IS ONE TERM: a number, a letter, or a product or
-- power of them (6, x, 2x, 3y^2). Across more than one term the two are
-- NOT the same answer:
--
--     -\frac{1-w^2}{...}  is  \frac{-1+w^2}{...},  not  \frac{-1-w^2}{...}
--
-- AND ONLY WHERE THE FRACTION STANDS ON ITS OWN — at the start, or after
-- =, +, -, ( or {. Written straight after something it multiplies, the minus
-- has nowhere to go: x\frac{-1}{2} is -x/2, and moving the sign out would
-- turn it into x - \frac{1}{2}, a different (wrong) answer that would then
-- be marked right.
--
-- NUMBERS WERE WORSE OFF, and are fixed here too. math_as_number() is
-- what lets 0.5 and \frac{1}{2} be one answer, and it could not read
-- \frac{-1}{2} at all: since 030 it unwraps single-character braces first,
-- turning that into \frac{-1}2, which neither of its patterns fitted. So a
-- limit answered \frac{-1}{2} against a key of -\frac{1}{2} was "a number
-- against something that is not one" and wrong on the spot. The same
-- unwrap broke \frac{12}{5} against 2.4. It now reads a fraction whichever
-- of its halves kept its braces.
--
-- The dashboard needs nothing: its marker (src/lib/workedSolution.js) uses
-- the maths engine, which already reads both as one number.
--
-- ALREADY-MARKED WORK IS NOT RE-MARKED by this file. Only answers saved from
-- now on see the rule.
-- =====================================================================

BEGIN;

-- 032's normalize_math, with one step added (s9b) and the single-character
-- brace unwrap run once more after it (s9c), because moving the sign leaves
-- \frac{6}{7} braced where the key's -\frac{6}{7} was already unwrapped to
-- -\frac67. Every other step is unchanged.
CREATE OR REPLACE FUNCTION public.normalize_math(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH s0 AS (SELECT coalesce(p, '') AS t),
  s1 AS (SELECT regexp_replace(t, '\\[,;:!]|\\quad|\\qquad|\\ ', '', 'g') AS t FROM s0),
  s2 AS (SELECT regexp_replace(t, '\\left|\\right', '', 'g') AS t FROM s1),
  s3 AS (SELECT regexp_replace(regexp_replace(t, '\\[dt]frac', '\frac', 'g'),
                               '\\(mathrm|operatorname)\{d\}|\\differentialD', 'd', 'g') AS t FROM s2),
  s4 AS (SELECT regexp_replace(t, '\\cdot|\\times|\*', '', 'g') AS t FROM s3),
  s5 AS (SELECT regexp_replace(t, '\s+', '', 'g') AS t FROM s4),
  s6 AS (SELECT lower(t) AS t FROM s5),
  s7 AS (SELECT replace(replace(replace(replace(replace(replace(t,
           '^{\prime\prime\prime}', ''''''''),
           '^{\prime\prime}',       ''''''),
           '^{\prime}',             ''''),
           '\doubleprime',          ''''''),
           '^\prime',               ''''),
           '\prime',                '''') AS t FROM s6),
  s8 AS (SELECT replace(t, '^{}', '') AS t FROM s7),
  s9 AS (SELECT regexp_replace(regexp_replace(t, '\{([a-z0-9])\}', '\1', 'g'),
                               '\{([a-z0-9])\}', '\1', 'g') AS t FROM s8),
  s9b AS (SELECT regexp_replace(t, '(^|[-=+({])\\frac\{-([0-9a-z.^'']+)\}',
                                '\1-\\frac{\2}', 'g') AS t FROM s9),
  s9c AS (SELECT regexp_replace(t, '\{([a-z0-9])\}', '\1', 'g') AS t FROM s9b),
  s10 AS (SELECT CASE WHEN t ~ public.math_label_lhs_pattern()
                      THEN regexp_replace(t, '^[^=]*=', '')
                      ELSE t END AS t FROM s9c),
  s11 AS (SELECT CASE WHEN t ~ '^\((.*)\)$' AND length(t) > 2
                      THEN substring(t from 2 for length(t) - 2)
                      ELSE t END AS t FROM s10),
  s12 AS (SELECT replace(replace(t, '+-', '-'), '--', '+') AS t FROM s11)
  SELECT t FROM s12;
$$;

-- 032's math_as_number, except the fraction: either half may be braced or,
-- being one digit, not — \frac{-1}2, \frac{12}5 and \frac12 all read.
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
  t := regexp_replace(t, '\\(mathrm|operatorname)\{d\}|\\differentialD', 'd', 'g');
  t := replace(replace(replace(replace(t,
         '^{\prime\prime\prime}', ''''''''), '^{\prime\prime}', ''''''),
         '^{\prime}', ''''), '^\prime', '''');
  t := regexp_replace(regexp_replace(t, '\{([a-z0-9])\}', '\1', 'g'), '\{([a-z0-9])\}', '\1', 'g');
  IF t ~ public.math_label_lhs_pattern() THEN
    t := regexp_replace(t, '^[^=]*=', '');
  END IF;
  IF t ~ '^-?[0-9]+(\.[0-9]+)?$' THEN RETURN t::numeric; END IF;
  IF t ~ '^-' THEN sign := -1; t := substring(t from 2); END IF;
  parts := regexp_match(t, '^\\frac(\{-?[0-9]+(?:\.[0-9]+)?\}|[0-9])(\{-?[0-9]+(?:\.[0-9]+)?\}|[0-9])$');
  IF parts IS NOT NULL THEN
    num := btrim(parts[1], '{}')::numeric; den := btrim(parts[2], '{}')::numeric;
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
SELECT public.math_answers_match('\frac{-6}{(2u+1)^4}',    '-\frac{6}{(2u+1)^4}')    AS one_digit_is_true,
       public.math_answers_match('\frac{-2x}{3y^{2}}',     '-\frac{2x}{3y^2}')       AS one_term_is_true,
       public.math_answers_match('\frac{-1-w^2}{(w^2+1)^2}', '-\frac{1-w^2}{(w^2+1)^2}') AS two_terms_is_false,
       public.math_answers_match('x\frac{-1}{2}',          'x-\frac{1}{2}')          AS after_a_factor_is_false,
       public.math_answers_match('\frac{-1}{2}',           '-\frac{1}{2}')           AS a_number_is_true,
       public.math_answers_match('\frac{12}{5}',           '2.4')                    AS twelve_fifths_is_true;
-- true, true, false, false, true, true.
