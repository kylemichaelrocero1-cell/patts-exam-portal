-- =====================================================================
-- 030 — a prime typed in the editor is the prime in the answer
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- THE BUG, AND IT HAS BEEN COSTING STUDENTS MARKS
-- MathLive does not write an apostrophe. Whatever key the student presses, it
-- serialises a prime as ^{\prime} — so a student who typed y' submitted
--     y^{\prime}=6x
-- while the answer on file, typed as LaTeX by hand, says
--     y'=6x
-- Those normalise to different strings, so EVERY derivative answer was marked
-- wrong. Of the answers students have actually submitted so far, ten contain
-- ^{\prime} and not one contains an apostrophe. This was not an edge case; it
-- was every prime on the paper.
--
-- WHAT ELSE THE REAL SUBMISSIONS SHOWED
--   \left( and \right)      already handled
--   \, thin spaces          already handled
--   a lowercase c for +C    already handled
--   ^{}                     an EMPTY superscript, left behind when a student
--                           opens a power and does not fill it. It means
--                           nothing and is now dropped, so 2(x+1)^{} is the
--                           same answer as 2(x+1).
--   \placeholder{}          MathLive's marker for a slot never filled in.
--                           Deliberately NOT removed: an answer with an empty
--                           slot in it is unfinished, and should not match.
--
-- Second and third derivatives are covered too: ^{\prime\prime} becomes '',
-- and y'' and y''' join the subjects that may be stripped from the front of
-- an answer, so y''=12x^2-12x and 12x^2-12x are one answer.
--
-- AFTER RUNNING THIS, RESCORE. Marks already recorded were computed with the
-- old rule and are wrong wherever a prime was involved:
--     ~/patts-exam-content/025_rescore_existing_attempts.sql
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_math(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH s0 AS (SELECT coalesce(p, '') AS t),
  -- LaTeX spacing commands, which carry no meaning at all.
  s1 AS (SELECT regexp_replace(t, '\\[,;:!]|\\quad|\\qquad|\\ ', '', 'g') AS t FROM s0),
  -- \left( and \right) are decoration around ordinary brackets.
  s2 AS (SELECT regexp_replace(t, '\\left|\\right', '', 'g') AS t FROM s1),
  -- One spelling of a fraction.
  s3 AS (SELECT regexp_replace(t, '\\[dt]frac', '\frac', 'g') AS t FROM s2),
  -- One spelling of multiplication, then drop it.
  s4 AS (SELECT regexp_replace(t, '\\cdot|\\times|\*', '', 'g') AS t FROM s3),
  s5 AS (SELECT regexp_replace(t, '\s+', '', 'g') AS t FROM s4),
  s6 AS (SELECT lower(t) AS t FROM s5),
  -- ── PRIMES ────────────────────────────────────────────────────────
  -- The editor writes ^{\prime}; a human writes '. One spelling, and the
  -- apostrophe wins because that is what the subject test below reads.
  -- Longest first, so ^{\prime\prime} does not become '\prime instead of ''.
  s7 AS (SELECT replace(replace(replace(replace(replace(replace(t,
           '^{\prime\prime\prime}', ''''''),
           '^{\prime\prime}',       ''''),
           '^{\prime}',             ''''),
           '\doubleprime',          ''''),
           '^\prime',               ''''),
           '\prime',                '''') AS t FROM s6),
  -- An empty superscript is a power the student opened and never filled.
  s8 AS (SELECT replace(t, '^{}', '') AS t FROM s7),
  -- Braces that wrap a single token: {5} -> 5, x^{2} -> x^2.
  s9 AS (SELECT regexp_replace(regexp_replace(t, '\{([a-z0-9])\}', '\1', 'g'),
                               '\{([a-z0-9])\}', '\1', 'g') AS t FROM s8),
  -- A subject on the left is a label, not part of the answer. Second and
  -- third derivatives included, longest first so y''' is not read as y'.
  s10 AS (SELECT CASE
           WHEN t ~ '^(y''''''|y''''|y''|y|f''''''\(x\)|f''''\(x\)|f''\(x\)|f\(x\)|\\frac\{dy\}\{dx\}|dy/dx|x|v|s|t)='
           THEN regexp_replace(t, '^[^=]*=', '')
           ELSE t END AS t FROM s9),
  s11 AS (SELECT CASE WHEN t ~ '^\((.*)\)$' AND length(t) > 2
                      THEN substring(t from 2 for length(t) - 2)
                      ELSE t END AS t FROM s10),
  s12 AS (SELECT replace(replace(t, '+-', '-'), '--', '+') AS t FROM s11)
  SELECT t FROM s12;
$$;

COMMENT ON FUNCTION public.normalize_math(text) IS
  'One canonical spelling of a LaTeX answer. Collapses two ways of writing the SAME thing and never performs algebra. Knows that the maths editor writes ^{\prime} where a person writes an apostrophe.';

-- math_as_number strips a subject too, and must agree about primes.
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
  IF t ~ '^(y''''|y''|y|f''\(x\)|f\(x\)|\\frac\{dy\}\{dx\}|dy/dx|x|v|s|t)=' THEN
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

-- 1. What the editor writes and what a person writes are one answer.
SELECT public.math_answers_match('y^{\prime}=6x', 'y''=6x')            AS prime_editor_vs_hand,
       public.math_answers_match('y^{\prime}=6x', '6x')                AS prime_vs_bare,
       public.math_answers_match('y^{\prime\prime}=12x^2-12x', 'f''''(x)=12x^2-12x') AS second_derivative,
       public.math_answers_match('y^{\prime}=-\frac{x}{y}', '\frac{dy}{dx}=-\frac{x}{y}') AS implicit_as_prime,
       public.math_answers_match('2\left(x+1\right)^{}', '2(x+1)')     AS empty_superscript;
-- all true.

-- 2. An unfinished answer still does not match.
SELECT public.math_answers_match('\cos(\placeholder{})', '\cos(x)') AS placeholder_must_be_false;
-- false.

-- 3. Nothing that was different has become the same.
SELECT public.math_answers_match('y^{\prime}=6x', 'y^{\prime}=6')  AS f1,
       public.math_answers_match('2x=6', 'x=3')                    AS f2;
-- both false.
