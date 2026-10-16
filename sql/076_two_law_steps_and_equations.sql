-- =====================================================================
-- 076 — a proof step that takes two laws is a step, and a line may be
--        written as an equation
--
-- Run in the Supabase SQL editor (runs as postgres) AFTER sql/073, and
-- after the build that goes with it is live. Idempotent. Then run sql/077
-- until its counts are 0.
--
-- WHY — two things MATH 115 Seatwork 2 showed
--
-- 1. (s ∧ u) ∧ ¬s ≡ (s ∧ ¬s) ∧ u takes Associative, Commutative and
--    Associative again. Named "Associative, Commutative" it was a step
--    with its laws — the laws named may each be used up to three times —
--    but named "Associative" alone it was a LEAP, because the test for a
--    step allowed only two uses of any laws. The work stopped there and a
--    proof right to the end, short one law, scored 1 of 7 instead of 6.
--    A step is now anything one or two laws give, each used as often as
--    the laws named may be, so a missing law costs the 1 the scheme says.
--    A line 073 called a step is costed exactly as before, and no slower.
--
-- 2. A simplification written as the whole equation —
--    (s ∧ u) ∨ c ≡ s ∧ u, or (s ∧ u) ∨ c = s ∧ u — was not read: ≡ in the
--    middle of a line could not be read, and = was taken for ↔. A line
--    written as an equation is now the statement it ends on, when every
--    side of it is equivalent to the others; a plain = means ≡, and ↔
--    keeps its own spellings.
--
-- RAISE-ONLY in effect: a line that was a leap is now a step costing its
-- missing laws, never less than the work before it earned; a line that
-- could not be read is now read. sql/077 re-marks and refuses to lower.
--
-- JS twin: src/lib/logicProof.js. sql/test/logic_proofs.test.mjs runs both.
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
-- 1. Reading a line: ≡ and = are "is equivalent to"
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.logic_tokens(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE s text := coalesce(p, ''); pair text[];
BEGIN
  s := regexp_replace(s, '\\(?:text|mathrm|mathit|mathbf|mathsf|mathtt|textrm|textit|operatorname)\s*\{([^{}]*)\}', '\1', 'g');
  s := regexp_replace(s, '^[\s{}]*(?:\\equiv|≡)', '');
  -- Before the spellings, which write = for ↔.
  s := replace(replace(s, '\equiv', '≡'), '=', '≡');
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['\Longleftrightarrow', '='], ['\longleftrightarrow', '='], ['\Leftrightarrow', '='],
    ['\leftrightarrow', '='], ['\iff', '='],
    ['\Longrightarrow', '>'], ['\longrightarrow', '>'], ['\Rightarrow', '>'],
    ['\rightarrow', '>'], ['\implies', '>'], ['\supset', '>'],
    ['\top', '⊤'], ['\bot', '⊥'], ['\to', '>'],
    ['\land', '&'], ['\wedge', '&'], ['\&', '&'],
    ['\lor', '|'], ['\vee', '|'],
    ['\lnot', '!'], ['\neg', '!'], ['\sim', '!'], ['\~', '!'],
    ['\lbrack', '('], ['\rbrack', ')'], ['\lparen', '('], ['\rparen', ')'],
    ['\lbrace', '('], ['\rbrace', ')'],
    ['\{', '('], ['\}', ')'],
    ['\bigl', ''], ['\bigr', ''], ['\Bigl', ''], ['\Bigr', ''], ['\big', ''], ['\Big', ''],
    ['\left', ''], ['\right', ''],
    ['\qquad', ''], ['\quad', ''], ['\,', ''], ['\;', ''], ['\:', ''], ['\!', ''],
    ['\ ', ''], ['\space', ''],
    ['∧', '&'], ['∨', '|'], ['¬', '!'], ['~', '!'], ['→', '>'], ['⇒', '>'],
    ['↔', '='], ['⇔', '='], ['[', '('], [']', ')']
  ] LOOP
    s := replace(s, pair[1], pair[2]);
  END LOOP;
  s := regexp_replace(s, '[\s{}]', '', 'g');
  IF s = '' OR s !~ '^[A-Za-z&|!>=()⊤⊥≡]+$' THEN RETURN NULL; END IF;
  RETURN s;
END $$;

-- One side of a line: tokens with no ≡ in them (073's logic_parse body).
CREATE OR REPLACE FUNCTION public.logic_parse_side(s text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  c text; top text; i int;
  out jsonb[] := ARRAY[]::jsonb[]; ops text[] := ARRAY[]::text[];
  operand boolean := true;
  prec constant jsonb := '{"!":4,"&":3,"|":2,">":1,"=":0}';
BEGIN
  IF coalesce(s, '') = '' THEN RETURN NULL; END IF;
  FOR i IN 1..length(s) LOOP
    c := substr(s, i, 1);
    IF operand THEN
      IF c = '!' OR c = '(' THEN ops := ops || c;
      ELSIF c ~ '^[A-Za-z⊤⊥]$' THEN
        out := out || to_jsonb(CASE WHEN c IN ('⊤','t','T') THEN '1'
                                    WHEN c IN ('⊥','c','C','F') THEN '0' ELSE c END);
        operand := false;
      ELSE RETURN NULL;
      END IF;
    ELSIF c = ')' THEN
      WHILE cardinality(ops) > 0 AND ops[cardinality(ops)] <> '(' LOOP
        out := public.logic_apply(out, ops[cardinality(ops)]);
        IF out IS NULL THEN RETURN NULL; END IF;
        ops := ops[1:cardinality(ops)-1];
      END LOOP;
      IF cardinality(ops) = 0 THEN RETURN NULL; END IF;
      ops := ops[1:cardinality(ops)-1];
    ELSIF c IN ('&','|','>','=') THEN
      WHILE cardinality(ops) > 0 AND ops[cardinality(ops)] <> '(' LOOP
        top := ops[cardinality(ops)];
        IF (prec ->> top)::int > (prec ->> c)::int
           OR ((prec ->> top)::int = (prec ->> c)::int AND c NOT IN ('>','=')) THEN
          out := public.logic_apply(out, top);
          IF out IS NULL THEN RETURN NULL; END IF;
          ops := ops[1:cardinality(ops)-1];
        ELSE EXIT;
        END IF;
      END LOOP;
      ops := ops || c;
      operand := true;
    ELSE RETURN NULL;
    END IF;
  END LOOP;
  IF operand THEN RETURN NULL; END IF;
  WHILE cardinality(ops) > 0 LOOP
    top := ops[cardinality(ops)];
    IF top = '(' THEN RETURN NULL; END IF;
    out := public.logic_apply(out, top);
    IF out IS NULL THEN RETURN NULL; END IF;
    ops := ops[1:cardinality(ops)-1];
  END LOOP;
  IF cardinality(out) <> 1 THEN RETURN NULL; END IF;
  RETURN out[1];
END $$;

-- A line as the statement it ends on. Every side must be equivalent to the
-- last; a ≡ at either end is dropped.
CREATE OR REPLACE FUNCTION public.logic_parse(p text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  s text := public.logic_tokens(p);
  sides text[]; t jsonb; trees jsonb[] := ARRAY[]::jsonb[]; v_last jsonb; i int;
BEGIN
  IF s IS NULL OR length(s) > 40 THEN RETURN NULL; END IF;
  sides := string_to_array(s, '≡');
  WHILE cardinality(sides) > 1 AND sides[1] = '' LOOP sides := sides[2:]; END LOOP;
  WHILE cardinality(sides) > 1 AND sides[cardinality(sides)] = '' LOOP
    sides := sides[1:cardinality(sides)-1];
  END LOOP;
  FOR i IN 1..cardinality(sides) LOOP
    t := public.logic_parse_side(sides[i]);
    IF t IS NULL THEN RETURN NULL; END IF;
    trees := trees || t;
  END LOOP;
  v_last := trees[cardinality(trees)];
  FOR i IN 1..cardinality(trees) - 1 LOOP
    IF trees[i] <> v_last AND public.logic_equivalent(trees[i], v_last) IS DISTINCT FROM true THEN
      RETURN NULL;
    END IF;
  END LOOP;
  RETURN v_last;
END $$;

-- ---------------------------------------------------------------------
-- 2. How many laws a step is short of: 1, 2, or NULL for a leap
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.logic_laws_short(a jsonb, b jsonb, p_named text[], p_costed boolean)
RETURNS int
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  step_laws constant text[] := ARRAY['commutative','associative','distributive','identity',
    'complement','double_negation','idempotent','domination','de_morgan','absorption',
    'implication','biconditional','contrapositive'];
  k text; i int; j int;
BEGIN
  -- A line two uses of any law give is costed as 073 costed it; only a line
  -- that 073 called a leap is searched further, so no line marks slower.
  IF public.logic_step_follows(a, b, step_laws, 2) THEN
    -- A line that only goes back to an earlier one costs nothing: is it a step?
    IF NOT p_costed THEN RETURN 1; END IF;
    FOREACH k IN ARRAY step_laws LOOP
      IF public.logic_step_follows(a, b, p_named || k, 2) THEN RETURN 1; END IF;
    END LOOP;
    RETURN 2;
  END IF;
  FOREACH k IN ARRAY step_laws LOOP
    IF public.logic_step_follows(a, b, p_named || k, 3) THEN RETURN 1; END IF;
  END LOOP;
  FOR i IN 1..cardinality(step_laws) LOOP
    FOR j IN i + 1..cardinality(step_laws) LOOP
      IF public.logic_step_follows(a, b, ARRAY[step_laws[i], step_laws[j]], 3) THEN RETURN 2; END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------
-- 3. The marker (073's body, with the step test above)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.logic_mark(p_lines jsonb, p_rubric jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  v_mode text := p_rubric ->> 'mode';
  v_of numeric; v_work text[]; v_n int; v_ls jsonb := '[]'::jsonb;
  v_stmt text[] := ARRAY[]::text[]; v_laws jsonb := '[]'::jsonb; v_idx int[] := ARRAY[]::int[];
  v_accept jsonb[] := ARRAY[]::jsonb[]; v_starts jsonb[];
  v_given jsonb; v_t jsonb; v_prev jsonb; v_keys text[];
  v_last int; v_i int; v_w int; v_line int; v_ok boolean; v_law_ok boolean;
  v_rm numeric; v_lm numeric; v_marks numeric;
  v_key_steps int; v_right int := 0; v_wrong int[] := ARRAY[]::int[]; v_missing int := 0; v_short int;
  v_reached boolean; v_stop text; v_earlier jsonb[]; v_partial numeric; v_note text := '';
  v_eq boolean; v_repeat boolean; x text;
BEGIN
  v_of := CASE WHEN (p_rubric ->> 'marks') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' AND (p_rubric ->> 'marks')::numeric > 0
               THEN (p_rubric ->> 'marks')::numeric
               ELSE coalesce(nullif(p_rubric -> 'steps' -> -1 ->> 'marks', '')::numeric, 1) END;
  SELECT coalesce(array_agg(t ORDER BY o), ARRAY[]::text[]) INTO v_work
  FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines ELSE '[]'::jsonb END)
       WITH ORDINALITY AS e(t, o)
  WHERE btrim(t) <> '';
  v_n := cardinality(v_work);
  FOR v_i IN 1..v_n LOOP
    v_ls := v_ls || 'null'::jsonb;
    IF public.logic_line_statement(v_work[v_i]) <> '' THEN
      v_stmt := v_stmt || public.logic_line_statement(v_work[v_i]);
      v_laws := v_laws || jsonb_build_array(to_jsonb(public.logic_line_laws(v_work[v_i])));
      v_idx := v_idx || v_i;
    END IF;
  END LOOP;
  IF cardinality(v_stmt) = 0 THEN
    RETURN jsonb_build_object('marks', 0, 'of', v_of, 'reason', 'Nothing was written.', 'line_steps', v_ls);
  END IF;

  -- The accepted statements: the last step, then the accept list.
  FOR x IN
    SELECT v FROM (
      SELECT p_rubric -> 'steps' -> -1 ->> 'latex' AS v, 0::bigint AS o
      UNION ALL
      SELECT e.v, e.o FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p_rubric -> 'accept') = 'array' THEN p_rubric -> 'accept' ELSE '[]'::jsonb END)
        WITH ORDINALITY AS e(v, o)) s
    ORDER BY o
  LOOP
    v_t := public.logic_parse(x);
    IF v_t IS NOT NULL THEN v_accept := v_accept || v_t; END IF;
  END LOOP;

  v_last := cardinality(v_stmt);

  IF v_mode = 'logic' THEN
    v_t := public.logic_parse(v_stmt[v_last]);
    IF v_t IS NULL THEN
      RETURN jsonb_build_object('marks', 0, 'of', v_of,
        'reason', 'The answer could not be read as a statement.', 'line_steps', v_ls);
    END IF;
    v_ok := v_t = ANY (v_accept);
    IF v_ok THEN v_ls := jsonb_set(v_ls, ARRAY[(v_idx[v_last] - 1)::text], '1'); END IF;
    RETURN jsonb_build_object('marks', CASE WHEN v_ok THEN v_of ELSE 0 END, 'of', v_of,
      'reason', CASE WHEN v_ok THEN 'Correct answer.' ELSE 'Not an accepted answer.' END,
      'line_steps', v_ls);
  END IF;

  v_given := public.logic_parse(p_rubric ->> 'given');
  IF v_given IS NULL OR cardinality(v_accept) = 0 THEN
    RETURN jsonb_build_object('marks', 0, 'of', v_of, 'reason', 'This question has no answer key.', 'line_steps', v_ls);
  END IF;

  IF v_mode = 'simplify' THEN
    v_t := public.logic_parse(v_stmt[v_last]);
    v_rm := coalesce(nullif(p_rubric ->> 'result_marks', '')::numeric, 1);
    v_lm := coalesce(nullif(p_rubric ->> 'law_marks', '')::numeric, 1);
    v_ok := v_t IS NOT NULL AND v_t = ANY (v_accept);
    SELECT coalesce(array_agg(public.logic_law_key(l)), ARRAY[]::text[]) INTO v_keys
    FROM jsonb_array_elements_text(v_laws -> (v_last - 1)) AS l;
    v_keys := array_remove(array_remove(v_keys, NULL), 'given');
    v_law_ok := cardinality(v_keys) > 0 AND public.logic_step_follows(v_given, v_accept[1], v_keys, 3);
    IF v_ok THEN v_ls := jsonb_set(v_ls, ARRAY[(v_idx[v_last] - 1)::text], '1'); END IF;
    v_marks := (CASE WHEN v_ok THEN v_rm ELSE 0 END) + (CASE WHEN v_law_ok THEN v_lm ELSE 0 END);
    RETURN jsonb_build_object('marks', greatest(0, least(v_marks, v_of)), 'of', v_of,
      'reason', CASE
        WHEN v_ok AND v_law_ok THEN 'Correct result and law.'
        WHEN v_ok THEN CASE WHEN jsonb_array_length(v_laws -> (v_last - 1)) > 0
                            THEN 'The result is right; the law named does not give it.'
                            ELSE 'The result is right; the law is missing.' END
        WHEN v_law_ok THEN CASE WHEN v_t IS NOT NULL
                                THEN 'The law is right; the result is not simplified correctly.'
                                ELSE 'The law is right; the result could not be read as a statement.' END
        WHEN v_t IS NULL THEN 'The result could not be read as a statement.'
        ELSE 'Neither the result nor the law is right.' END,
      'line_steps', v_ls);
  END IF;

  -- A proof.
  v_starts := ARRAY[v_given];
  FOR x IN SELECT e FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(p_rubric -> 'given_accept') = 'array' THEN p_rubric -> 'given_accept' ELSE '[]'::jsonb END) AS e
  LOOP
    v_t := public.logic_parse(x);
    IF v_t IS NOT NULL THEN v_starts := v_starts || v_t; END IF;
  END LOOP;
  v_key_steps := greatest(1, coalesce(CASE WHEN (p_rubric ->> 'key_steps') ~ '^\s*[0-9]+\s*$'
                                           THEN (p_rubric ->> 'key_steps')::int END, 1));
  v_prev := v_given;
  v_reached := v_given = v_accept[1];
  v_earlier := ARRAY[v_given];
  v_w := 0;
  -- Forty lines is far longer than any proof here; past that nothing is read.
  WHILE v_w < least(v_last, 40) AND NOT v_reached LOOP
    v_w := v_w + 1;
    v_line := v_idx[v_w];
    v_t := public.logic_parse(v_stmt[v_w]);
    IF v_t IS NULL THEN
      v_stop := 'Line ' || v_line || ' could not be read as a statement, so the work stops counting there.';
      EXIT;
    END IF;
    IF v_w = 1 AND v_t = ANY (v_starts) THEN
      v_ls := jsonb_set(v_ls, ARRAY[(v_line - 1)::text], '1');
      v_prev := v_t; v_earlier := v_earlier || v_t;
      CONTINUE;
    END IF;
    IF v_t = v_prev THEN CONTINUE; END IF;
    v_eq := public.logic_equivalent(v_prev, v_t);
    IF v_eq IS DISTINCT FROM true THEN
      v_stop := 'Line ' || v_line || ' is not equivalent to the line before it, so the work stops counting there.';
      EXIT;
    END IF;
    v_repeat := v_t = ANY (v_earlier);
    SELECT coalesce(array_agg(public.logic_law_key(l)), ARRAY[]::text[]) INTO v_keys
    FROM jsonb_array_elements_text(v_laws -> (v_w - 1)) AS l;
    v_keys := array_remove(array_remove(v_keys, NULL), 'given');
    v_short := CASE WHEN cardinality(v_keys) > 0 AND public.logic_step_follows(v_prev, v_t, v_keys, 3)
                    THEN 0 ELSE public.logic_laws_short(v_prev, v_t, v_keys, NOT v_repeat) END;
    IF v_short = 0 THEN
      IF NOT v_repeat THEN
        v_right := v_right + 1;
        v_ls := jsonb_set(v_ls, ARRAY[(v_line - 1)::text], '1');
      END IF;
    ELSIF v_short IS NOT NULL THEN
      -- A step needing two laws costs 1 for each one not named.
      IF NOT v_repeat THEN
        v_wrong := v_wrong || v_line;
        v_missing := v_missing + v_short;
      END IF;
    ELSE
      v_stop := 'Line ' || v_line || ' does not follow from the line before it by one or two laws: write each step on its own line.';
      EXIT;
    END IF;
    v_prev := v_t; v_earlier := v_earlier || v_t;
    IF v_t = ANY (v_accept) THEN v_reached := true; END IF;
  END LOOP;

  v_partial := least(v_right, v_key_steps - 1, v_of - 1);
  IF cardinality(v_wrong) = 1 THEN
    v_note := ' The law on ' || public.logic_line_list(v_wrong) || ' is missing or does not give that step.';
  ELSIF cardinality(v_wrong) > 1 THEN
    v_note := ' The laws on ' || public.logic_line_list(v_wrong) || ' are missing or do not give those steps.';
  END IF;
  IF v_reached THEN
    v_marks := greatest(v_of - v_missing, v_partial, 0);
    RETURN jsonb_build_object('marks', greatest(0, least(v_marks, v_of)), 'of', v_of,
      'reason', CASE WHEN v_missing > 0
        THEN 'Proved, but ' || v_missing || CASE WHEN v_missing = 1 THEN ' law is' ELSE ' laws are' END
             || ' missing or wrong.' || v_note
        ELSE 'Proved, with a law for every step.' END,
      'line_steps', v_ls);
  END IF;
  RETURN jsonb_build_object('marks', greatest(0, least(greatest(v_partial, 0), v_of)), 'of', v_of,
    'reason', coalesce(v_stop, 'The proof does not reach the statement it has to reach.') || v_note,
    'line_steps', v_ls);
END $$;

REVOKE ALL ON FUNCTION public.logic_mark(jsonb, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.logic_laws_short(jsonb, jsonb, text[], boolean) FROM public, anon, authenticated;

-- When these rules came in, so sql/077 knows which sittings to mark again.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'remark_076_since') THEN
    EXECUTE format('CREATE FUNCTION public.remark_076_since() RETURNS timestamptz '
                   'LANGUAGE sql IMMUTABLE AS $f$ SELECT %L::timestamptz $f$', now());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.remark_076_since() FROM public, anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row. Every true/false column true; the last is how many
-- submitted sittings hold a logic item (if it is not 0, run sql/077).
-- Look-alike items, not a paper's.
-- =====================================================================
SELECT
  public.logic_parse('(s\land u)\lor c\equiv s\land u') = '["and","s","u"]'::jsonb AS equation_is_its_last_side,
  public.logic_parse('(s\land u)\lor c=s\land u') = '["and","s","u"]'::jsonb AS equals_is_equivalent,
  public.logic_parse('s\leftrightarrow u') = '["iff","s","u"]'::jsonb AS arrow_is_still_iff,
  public.logic_parse('(s\land u)\lor c\equiv s\lor u') IS NULL AS false_equation_unread,
  public.logic_parse('\equiv s\land u') = '["and","s","u"]'::jsonb AS leading_equiv_dropped,
  (public.logic_mark(jsonb_build_array(
       '(s\land\sim s)\land u\qquad\text{(Associative)}',
       'c\land u\qquad\text{(Complement)}',
       'c\qquad\text{(Domination)}'),
     '{"mode":"proof","given":"(s\\land u)\\land\\neg s","steps":[{"latex":"c","marks":5}],"marks":5,"key_steps":4}'::jsonb)
     ->> 'marks')::numeric = 4 AS one_missing_law_costs_one,
  (public.logic_mark('["s\\land u\\qquad\\text{(Identity)}"]'::jsonb,
     '{"mode":"proof","given":"s\\land(\\neg s\\lor u)","steps":[{"latex":"s\\land u","marks":5}],"marks":5,"key_steps":4}'::jsonb)
     ->> 'marks')::numeric = 0 AS a_leap_is_still_a_leap,
  (SELECT count(*) FROM public.results res
    WHERE EXISTS (SELECT 1 FROM public.questions q
                  WHERE q.exam_id = coalesce(res.assessment_id, res.exam_id)
                    AND q.work_rubric ->> 'mode' IN ('logic','simplify','proof')))
  + (SELECT count(*) FROM public.review_attempts ra
    WHERE EXISTS (SELECT 1 FROM public.questions q
                  WHERE q.exam_id = ra.assessment_id
                    AND q.work_rubric ->> 'mode' IN ('logic','simplify','proof'))) AS sittings_with_logic_items;
