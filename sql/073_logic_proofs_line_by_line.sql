-- =====================================================================
-- 073 — proofs by logical equivalence, marked line by line
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 042 and 046. Run it BEFORE loading any paper with a logic item.
-- Ship the build that goes with it first or after: until a paper holds a
-- logic item, nothing on screen or in any mark changes.
--
-- WHY
-- A proof that r ∧ (¬r ∨ s) ≡ r ∧ s is a column of statements, each with
-- the law that gives it, and there is more than one right route. Matching
-- lines against a list (mode "lines", 042) can only follow the key's
-- route, and LaTeX strings make \land and \wedge two different answers.
-- A statement is now READ — into a tree — so the comparison is about the
-- logic, not the spelling, and a proof is checked step by step:
--
--   * each line must have the same truth table as the line before it; the
--     first that does not, or cannot be read, ends the work that counts;
--   * each line's law must give it from the line before it — once, at
--     several places at once, or two laws named on one line together;
--     each missing or wrong law costs 1 (a line that takes two laws and
--     names neither costs 2);
--   * a line that no one or two laws give from the line before it skips
--     working, and ends the work that counts too.
--
--   Reaching the target: full marks less 1 for each missing or wrong law.
--   Not reaching it: 1 for each step with its law, never more than the
--   key's steps less one. Nothing a correct line earns is taken away by a
--   later one.
--
-- WHAT THIS ADDS — three rubric modes on a worked_solution row
--   "logic"    one statement; right when it IS an accepted statement.
--   "simplify" one statement and its law: result_marks for the result,
--              law_marks for a law that gives it from "given".
--   "proof"    from "given" (or a "given_accept" form) to steps[-1], with
--              "key_steps" the length of the key's route.
--   A line carries its law after the statement, as
--     <statement>\qquad\text{(Law)}   or   \text{(Commutative, Identity)}
--   so the stored shape of an answer, its filing on submit (039), the
--   review and the export are all unchanged.
--   get_exam_questions() already sends work_mode (042): that is how the
--   exam screen knows to offer a law beside each line.
--
-- JS twin: src/lib/logicProof.js. sql/test/logic_proofs.test.mjs runs both
-- over the same statements, steps and proofs.
--
-- WHAT IS NOT TOUCHED
--   Every other item is marked exactly as before: the only change to
--   score_worked_answers() (046's body) is one branch for the three modes.
--
-- REHEARSE IT FIRST
--   1. Change  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file and read the VERIFY output.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='text_answer_verdict') THEN
    RAISE EXCEPTION 'text_answer_verdict() is missing — run sql/046 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. A law, by any of its names
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.logic_law_key(p_name text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN s IN ('given','premise') THEN 'given'
    WHEN s IN ('commutative','commutativity','commutation') THEN 'commutative'
    WHEN s IN ('associative','associativity','association') THEN 'associative'
    WHEN s IN ('distributive','distributivity','distribution') THEN 'distributive'
    WHEN s IN ('identity') THEN 'identity'
    WHEN s IN ('complement','complements','negation','negations','inverse') THEN 'complement'
    WHEN s IN ('doublenegation','doublenegative','involution') THEN 'double_negation'
    WHEN s IN ('idempotent','idempotence','idempotency') THEN 'idempotent'
    WHEN s IN ('domination','dominance','universalbound','universalbounds','null') THEN 'domination'
    WHEN s IN ('demorgan','demorgans') THEN 'de_morgan'
    WHEN s IN ('absorption') THEN 'absorption'
    WHEN s IN ('implication','conditional','materialimplication') THEN 'implication'
    WHEN s IN ('biconditional','equivalence') THEN 'biconditional'
    WHEN s IN ('contrapositive','contraposition','transposition') THEN 'contrapositive'
  END
  FROM (SELECT regexp_replace(
                 regexp_replace(regexp_replace(lower(coalesce(p_name, '')), '[^a-z]', '', 'g'),
                                '^(thelawof|lawof|the)', ''),
                 '(laws|law|property|rule)$', '') AS s) x;
$$;

-- ---------------------------------------------------------------------
-- 2. A stored line: the statement, and the laws written after it
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.logic_line_statement(p_line text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           regexp_replace(coalesce(p_line, ''), '\\qquad\s*\\text\{\(([^{}]*)\)\}\s*$', ''),
           '^\s+|\s+$', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.logic_line_laws(p_line text)
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(btrim(v) ORDER BY o) FILTER (WHERE btrim(v) <> ''), ARRAY[]::text[])
  FROM unnest(string_to_array(
         substring(coalesce(p_line, '') FROM '\\qquad\s*\\text\{\(([^{}]*)\)\}\s*$'), ','))
       WITH ORDINALITY AS u(v, o);
$$;

-- ---------------------------------------------------------------------
-- 3. Reading a statement
-- ---------------------------------------------------------------------
-- Every spelling reduced to one character: & | ! > = ( ) for the
-- connectives and brackets, ⊤ ⊥ for t and c, and nothing else but
-- letters; NULL if anything else is left. The order of the replacements
-- matters: \longleftrightarrow before \leftrightarrow before \rightarrow,
-- \top before \to, the arrows before \left and \right.
CREATE OR REPLACE FUNCTION public.logic_tokens(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE s text := coalesce(p, ''); pair text[];
BEGIN
  s := regexp_replace(s, '\\(?:text|mathrm|mathit|mathbf|mathsf|mathtt|textrm|textit|operatorname)\s*\{([^{}]*)\}', '\1', 'g');
  s := regexp_replace(s, '^[\s{}]*(?:\\equiv|≡)', '');
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
  IF s = '' OR s !~ '^[A-Za-z&|!>=()⊤⊥]+$' THEN RETURN NULL; END IF;
  RETURN s;
END $$;

-- One connective applied to the trees on top of the output stack.
CREATE OR REPLACE FUNCTION public.logic_apply(p_out jsonb[], p_op text)
RETURNS jsonb[]
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE n int := coalesce(cardinality(p_out), 0);
BEGIN
  IF p_op = '!' THEN
    IF n < 1 THEN RETURN NULL; END IF;
    RETURN p_out[1:n-1] || jsonb_build_array('not', p_out[n]);
  END IF;
  IF n < 2 THEN RETURN NULL; END IF;
  RETURN p_out[1:n-2] || jsonb_build_array(
    CASE p_op WHEN '&' THEN 'and' WHEN '|' THEN 'or' WHEN '>' THEN 'imp' ELSE 'iff' END,
    p_out[n-1], p_out[n]);
END $$;

-- A statement as a tree, or NULL when it cannot be read: a letter is a
-- string ("p"), t and c are "1" and "0", a connective an array —
-- ["not",a] ["and",a,b] ["or",a,b] ["imp",a,b] ["iff",a,b]. ¬ binds
-- tightest, then ∧, ∨, → and ↔; ∧ and ∨ group from the left, → and ↔ from
-- the right. t and T are true; c, C and F are false.
CREATE OR REPLACE FUNCTION public.logic_parse(p text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  s text := public.logic_tokens(p);
  c text; top text; i int;
  out jsonb[] := ARRAY[]::jsonb[]; ops text[] := ARRAY[]::text[];
  operand boolean := true;
  prec constant jsonb := '{"!":4,"&":3,"|":2,">":1,"=":0}';
BEGIN
  IF s IS NULL OR length(s) > 40 THEN RETURN NULL; END IF;
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

-- ---------------------------------------------------------------------
-- 4. Truth tables
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.logic_letters(t jsonb)
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE v text; acc text[] := ARRAY[]::text[]; i int;
BEGIN
  IF jsonb_typeof(t) = 'string' THEN
    v := t #>> '{}';
    RETURN CASE WHEN v IN ('1','0') THEN ARRAY[]::text[] ELSE ARRAY[v] END;
  END IF;
  FOR i IN 1..jsonb_array_length(t) - 1 LOOP
    acc := acc || public.logic_letters(t -> i);
  END LOOP;
  RETURN acc;
END $$;

-- Bit r of the result is the statement's value on row r, where letter i
-- (1-based in p_vars) is true on row r when bit i-1 of r is set.
CREATE OR REPLACE FUNCTION public.logic_truth(t jsonb, p_vars text[], p_rows int, p_mask bigint)
RETURNS bigint
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE v text; i int; r int; acc bigint := 0; a bigint; b bigint;
BEGIN
  IF jsonb_typeof(t) = 'string' THEN
    v := t #>> '{}';
    IF v = '1' THEN RETURN p_mask; END IF;
    IF v = '0' THEN RETURN 0; END IF;
    i := array_position(p_vars, v) - 1;
    FOR r IN 0..p_rows - 1 LOOP
      IF (r >> i) & 1 = 1 THEN acc := acc | (1::bigint << r); END IF;
    END LOOP;
    RETURN acc;
  END IF;
  a := public.logic_truth(t -> 1, p_vars, p_rows, p_mask);
  IF t ->> 0 = 'not' THEN RETURN ~a & p_mask; END IF;
  b := public.logic_truth(t -> 2, p_vars, p_rows, p_mask);
  RETURN CASE t ->> 0
    WHEN 'and' THEN a & b
    WHEN 'or'  THEN a | b
    WHEN 'imp' THEN (~a | b) & p_mask
    ELSE ~(a # b) & p_mask
  END;
END $$;

-- Same truth table? NULL when it cannot be told (more than five letters).
CREATE OR REPLACE FUNCTION public.logic_equivalent(a jsonb, b jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE vars text[]; n int; rows int; mask bigint;
BEGIN
  SELECT coalesce(array_agg(DISTINCT v), ARRAY[]::text[]) INTO vars
  FROM unnest(public.logic_letters(a) || public.logic_letters(b)) AS u(v);
  n := cardinality(vars);
  IF n > 5 THEN RETURN NULL; END IF;
  rows := 1 << n;
  mask := (1::bigint << rows) - 1;
  RETURN public.logic_truth(a, vars, rows, mask) = public.logic_truth(b, vars, rows, mask);
END $$;

-- ---------------------------------------------------------------------
-- 5. The laws, as rewrites
-- ---------------------------------------------------------------------
-- What a target holds, as bits: 1 a t, 2 a c, 4 a double negation, 8 an
-- X∧X or X∨X — so a rewrite that BUILDS one is only tried when it could help.
CREATE OR REPLACE FUNCTION public.logic_features(t jsonb)
RETURNS int
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE f int := 0; i int;
BEGIN
  IF jsonb_typeof(t) = 'string' THEN
    RETURN CASE t #>> '{}' WHEN '1' THEN 1 WHEN '0' THEN 2 ELSE 0 END;
  END IF;
  IF t ->> 0 = 'not' AND jsonb_typeof(t -> 1) = 'array' AND t -> 1 ->> 0 = 'not' THEN f := f | 4; END IF;
  IF t ->> 0 IN ('and','or') AND t -> 1 = t -> 2 THEN f := f | 8; END IF;
  FOR i IN 1..jsonb_array_length(t) - 1 LOOP
    f := f | public.logic_features(t -> i);
  END LOOP;
  RETURN f;
END $$;

CREATE OR REPLACE FUNCTION public.logic_is(t jsonb, p_op text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(t) = 'array' AND t ->> 0 = p_op;
$$;

-- Every statement one use of p_law at the top of n gives.
CREATE OR REPLACE FUNCTION public.logic_root_rewrites(n jsonb, p_law text, f int)
RETURNS jsonb[]
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  r jsonb[] := ARRAY[]::jsonb[];
  op text := CASE WHEN jsonb_typeof(n) = 'array' THEN n ->> 0 END;
  a jsonb := n -> 1; b jsonb := n -> 2;
  t1 constant jsonb := '"1"'; t0 constant jsonb := '"0"';
  o text;
BEGIN
  IF p_law = 'commutative' THEN
    IF op IN ('and','or','iff') THEN r := r || jsonb_build_array(op, b, a); END IF;
  ELSIF p_law = 'associative' THEN
    FOREACH o IN ARRAY ARRAY['and','or'] LOOP
      IF op = o AND public.logic_is(a, o) THEN
        r := r || jsonb_build_array(o, a -> 1, jsonb_build_array(o, a -> 2, b)); END IF;
      IF op = o AND public.logic_is(b, o) THEN
        r := r || jsonb_build_array(o, jsonb_build_array(o, a, b -> 1), b -> 2); END IF;
    END LOOP;
  ELSIF p_law = 'distributive' THEN
    IF op = 'and' AND public.logic_is(b, 'or') THEN
      r := r || jsonb_build_array('or', jsonb_build_array('and', a, b -> 1), jsonb_build_array('and', a, b -> 2)); END IF;
    IF op = 'or' AND public.logic_is(b, 'and') THEN
      r := r || jsonb_build_array('and', jsonb_build_array('or', a, b -> 1), jsonb_build_array('or', a, b -> 2)); END IF;
    IF op = 'or' AND public.logic_is(a, 'and') AND public.logic_is(b, 'and') AND a -> 1 = b -> 1 THEN
      r := r || jsonb_build_array('and', a -> 1, jsonb_build_array('or', a -> 2, b -> 2)); END IF;
    IF op = 'and' AND public.logic_is(a, 'or') AND public.logic_is(b, 'or') AND a -> 1 = b -> 1 THEN
      r := r || jsonb_build_array('or', a -> 1, jsonb_build_array('and', a -> 2, b -> 2)); END IF;
  ELSIF p_law = 'identity' THEN
    IF op = 'and' AND b = t1 THEN r := r || a; END IF;
    IF op = 'and' AND a = t1 THEN r := r || b; END IF;
    IF op = 'or' AND b = t0 THEN r := r || a; END IF;
    IF op = 'or' AND a = t0 THEN r := r || b; END IF;
    IF f & 1 = 1 THEN r := r || jsonb_build_array('and', n, t1) || jsonb_build_array('and', t1, n); END IF;
    IF f & 2 = 2 THEN r := r || jsonb_build_array('or', n, t0) || jsonb_build_array('or', t0, n); END IF;
  ELSIF p_law = 'complement' THEN
    IF op = 'or' AND public.logic_is(b, 'not') AND a = b -> 1 THEN r := r || t1; END IF;
    IF op = 'or' AND public.logic_is(a, 'not') AND a -> 1 = b THEN r := r || t1; END IF;
    IF op = 'and' AND public.logic_is(b, 'not') AND a = b -> 1 THEN r := r || t0; END IF;
    IF op = 'and' AND public.logic_is(a, 'not') AND a -> 1 = b THEN r := r || t0; END IF;
    IF op = 'not' AND a = t1 THEN r := r || t0; END IF;
    IF op = 'not' AND a = t0 THEN r := r || t1; END IF;
  ELSIF p_law = 'double_negation' THEN
    IF op = 'not' AND public.logic_is(a, 'not') THEN r := r || (a -> 1); END IF;
    IF f & 4 = 4 THEN r := r || jsonb_build_array('not', jsonb_build_array('not', n)); END IF;
  ELSIF p_law = 'idempotent' THEN
    IF op IN ('and','or') AND a = b THEN r := r || a; END IF;
    IF f & 8 = 8 THEN r := r || jsonb_build_array('and', n, n) || jsonb_build_array('or', n, n); END IF;
  ELSIF p_law = 'domination' THEN
    IF op = 'or' AND (a = t1 OR b = t1) THEN r := r || t1; END IF;
    IF op = 'and' AND (a = t0 OR b = t0) THEN r := r || t0; END IF;
  ELSIF p_law = 'de_morgan' THEN
    IF op = 'not' AND public.logic_is(a, 'and') THEN
      r := r || jsonb_build_array('or', jsonb_build_array('not', a -> 1), jsonb_build_array('not', a -> 2)); END IF;
    IF op = 'not' AND public.logic_is(a, 'or') THEN
      r := r || jsonb_build_array('and', jsonb_build_array('not', a -> 1), jsonb_build_array('not', a -> 2)); END IF;
    IF op = 'or' AND public.logic_is(a, 'not') AND public.logic_is(b, 'not') THEN
      r := r || jsonb_build_array('not', jsonb_build_array('and', a -> 1, b -> 1)); END IF;
    IF op = 'and' AND public.logic_is(a, 'not') AND public.logic_is(b, 'not') THEN
      r := r || jsonb_build_array('not', jsonb_build_array('or', a -> 1, b -> 1)); END IF;
  ELSIF p_law = 'absorption' THEN
    IF op = 'or' AND public.logic_is(b, 'and') AND a = b -> 1 THEN r := r || a; END IF;
    IF op = 'and' AND public.logic_is(b, 'or') AND a = b -> 1 THEN r := r || a; END IF;
  ELSIF p_law = 'implication' THEN
    IF op = 'imp' THEN r := r || jsonb_build_array('or', jsonb_build_array('not', a), b); END IF;
    IF op = 'or' AND public.logic_is(a, 'not') THEN r := r || jsonb_build_array('imp', a -> 1, b); END IF;
  ELSIF p_law = 'biconditional' THEN
    IF op = 'iff' THEN
      r := r || jsonb_build_array('and', jsonb_build_array('imp', a, b), jsonb_build_array('imp', b, a)); END IF;
    IF op = 'and' AND public.logic_is(a, 'imp') AND public.logic_is(b, 'imp')
       AND a -> 1 = b -> 2 AND a -> 2 = b -> 1 THEN
      r := r || jsonb_build_array('iff', a -> 1, a -> 2); END IF;
  ELSIF p_law = 'contrapositive' THEN
    IF op = 'imp' THEN
      r := r || jsonb_build_array('imp', jsonb_build_array('not', b), jsonb_build_array('not', a)); END IF;
    IF op = 'imp' AND public.logic_is(a, 'not') AND public.logic_is(b, 'not') THEN
      r := r || jsonb_build_array('imp', b -> 1, a -> 1); END IF;
  END IF;
  RETURN r;
END $$;

-- Every statement one use of one of p_laws, anywhere in n, gives.
CREATE OR REPLACE FUNCTION public.logic_rewrites(n jsonb, p_laws text[], f int)
RETURNS jsonb[]
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE out jsonb[] := ARRAY[]::jsonb[]; law text; i int; c jsonb;
BEGIN
  FOREACH law IN ARRAY p_laws LOOP
    out := out || public.logic_root_rewrites(n, law, f);
  END LOOP;
  IF jsonb_typeof(n) = 'array' THEN
    FOR i IN 1..jsonb_array_length(n) - 1 LOOP
      FOREACH c IN ARRAY public.logic_rewrites(n -> i, p_laws, f) LOOP
        out := out || jsonb_set(n, ARRAY[i::text], c);
      END LOOP;
    END LOOP;
  END IF;
  RETURN out;
END $$;

-- Can b be reached from a by at most p_depth uses of p_laws? Level by
-- level: every statement one more use away, the ones already seen dropped.
-- b is looked for once a level is complete, and a level of more than 300
-- different statements ends the search. A level is a SET, so where the
-- search stops never depends on the order rewrites are tried in, and the JS
-- twin stops at the same place.
CREATE OR REPLACE FUNCTION public.logic_reachable(a jsonb, b jsonb, p_laws text[], p_depth int, f int)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE seen jsonb[] := ARRAY[a]; frontier jsonb[] := ARRAY[a]; nxt jsonb[]; d int;
BEGIN
  FOR d IN 1..p_depth LOOP
    EXIT WHEN cardinality(frontier) = 0;
    nxt := ARRAY(
      SELECT r FROM unnest(frontier) AS fr(x), unnest(public.logic_rewrites(fr.x, p_laws, f)) AS g(r)
      EXCEPT
      SELECT s FROM unnest(seen) AS sn(s));
    IF b = ANY (nxt) THEN RETURN true; END IF;
    IF cardinality(nxt) > 300 THEN RETURN false; END IF;
    seen := seen || nxt;
    frontier := nxt;
  END LOOP;
  RETURN false;
END $$;

-- Does b follow from a by p_laws? Where the two differ in several places,
-- each is judged on its own, so a law used at two places at once counts.
CREATE OR REPLACE FUNCTION public.logic_step_follows(a jsonb, b jsonb, p_laws text[], p_depth int DEFAULT 3)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE i int; ok boolean := true;
BEGIN
  IF a = b THEN RETURN true; END IF;
  IF jsonb_typeof(a) = 'array' AND jsonb_typeof(b) = 'array' AND a ->> 0 = b ->> 0
     AND jsonb_array_length(a) = jsonb_array_length(b) THEN
    FOR i IN 1..jsonb_array_length(a) - 1 LOOP
      IF NOT public.logic_step_follows(a -> i, b -> i, p_laws, p_depth) THEN ok := false; EXIT; END IF;
    END LOOP;
    IF ok THEN RETURN true; END IF;
  END IF;
  RETURN public.logic_reachable(a, b, p_laws, p_depth, public.logic_features(b));
END $$;

-- ---------------------------------------------------------------------
-- 6. Marking (markLogic() in the JS twin)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.logic_line_list(p int[])
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN cardinality(p) = 1 THEN 'line ' || p[1]
    ELSE 'lines ' || array_to_string(p[1:cardinality(p)-1], ', ') || ' and ' || p[cardinality(p)] END;
$$;

CREATE OR REPLACE FUNCTION public.logic_mark(p_lines jsonb, p_rubric jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  step_laws constant text[] := ARRAY['commutative','associative','distributive','identity',
    'complement','double_negation','idempotent','domination','de_morgan','absorption',
    'implication','biconditional','contrapositive'];
  v_mode text := p_rubric ->> 'mode';
  v_of numeric; v_work text[]; v_n int; v_ls jsonb := '[]'::jsonb;
  v_stmt text[] := ARRAY[]::text[]; v_laws jsonb := '[]'::jsonb; v_idx int[] := ARRAY[]::int[];
  v_accept jsonb[] := ARRAY[]::jsonb[]; v_starts jsonb[];
  v_given jsonb; v_t jsonb; v_prev jsonb; v_keys text[];
  v_last int; v_i int; v_w int; v_line int; v_ok boolean; v_law_ok boolean;
  v_rm numeric; v_lm numeric; v_marks numeric;
  v_key_steps int; v_right int := 0; v_wrong int[] := ARRAY[]::int[]; v_missing int := 0; k text; v_short int;
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
    IF cardinality(v_keys) > 0 AND public.logic_step_follows(v_prev, v_t, v_keys, 3) THEN
      IF NOT v_repeat THEN
        v_right := v_right + 1;
        v_ls := jsonb_set(v_ls, ARRAY[(v_line - 1)::text], '1');
      END IF;
    ELSIF public.logic_step_follows(v_prev, v_t, step_laws, 2) THEN
      -- A step needing two laws costs 1 for each one not named: 1 when one
      -- more law beside those named would give it, 2 when it takes two.
      IF NOT v_repeat THEN
        v_wrong := v_wrong || v_line;
        v_short := 2;
        FOREACH k IN ARRAY step_laws LOOP
          IF public.logic_step_follows(v_prev, v_t, v_keys || k, 2) THEN v_short := 1; EXIT; END IF;
        END LOOP;
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

-- Only the marker calls these; nothing on either screen does.
REVOKE ALL ON FUNCTION public.logic_mark(jsonb, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.logic_step_follows(jsonb, jsonb, text[], int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.logic_reachable(jsonb, jsonb, text[], int, int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.logic_rewrites(jsonb, text[], int) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. The marker takes the logic branch (body otherwise that of 046)
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
-- VERIFY — one row, every column true. Look-alike proofs, not a paper's.
-- =====================================================================
SELECT
  public.logic_parse('\neg(p\land q)') = public.logic_parse('\sim(p\wedge q)') AS spellings_read_alike,
  public.logic_parse('\lbrack p\to q\rbrack') = public.logic_parse('(p\rightarrow q)') AS brackets_read_alike,
  public.logic_parse('p q') IS NULL AS nonsense_unread,
  public.logic_equivalent(public.logic_parse('p\to q'), public.logic_parse('\neg p\lor q')) AS truth_tables,
  NOT public.logic_equivalent(public.logic_parse('p\to q'), public.logic_parse('q\to p')) AS converse_differs,
  public.logic_step_follows(public.logic_parse('\neg(p\lor q)'), public.logic_parse('\neg p\land\neg q'),
                            ARRAY['de_morgan']) AS law_gives_step,
  NOT public.logic_step_follows(public.logic_parse('\neg(p\lor q)'), public.logic_parse('\neg p\land\neg q'),
                                ARRAY['distributive']) AS wrong_law_refused,
  (public.logic_mark('["r\\land(r\\lor s)\\qquad\\text{(Given)}", "\\equiv r\\qquad\\text{(Absorption)}"]'::jsonb,
     '{"mode":"proof","given":"r\\land(r\\lor s)","steps":[{"latex":"r","marks":2}],"marks":2,"key_steps":1}'::jsonb)
     ->> 'marks')::numeric = 2 AS a_proof_marks,
  (SELECT prosrc LIKE '%logic_mark%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='score_worked_answers') AS marker_takes_logic_branch;
