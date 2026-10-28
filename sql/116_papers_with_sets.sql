-- =====================================================================
-- 116 — a paper can hold several sets of questions (Set A, Set B, …)
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent. Needs 115.
-- Run it BEFORE the frontend that comes with it: the student and
-- instructor screens select assessments.set_labels, and PostgREST refuses
-- a select that names a missing column — the exam list would fail.
--
-- Until now a set was only a label (107): every student got every
-- question. Now a question may belong to one set — questions.set_label,
-- 'A'…'Z' — or to every set (NULL, as every question so far). A paper
-- whose questions carry set labels offers one Start button per set; the
-- student sits that set alone:
--
--   1. questions.set_label, and assessments.set_labels — the paper's sets,
--      kept up to date by a trigger, read by the Start screen.
--   2. paper_set_choices: which set each student is sitting, recorded by
--      get_exam_questions() the first time; read by the paper's
--      instructors only. Mid-sitting, or once a one-attempt paper is filed,
--      a student cannot swap to another set.
--   3. get_exam_questions() hands over only the chosen set and the items in
--      every set; score_answers(), submit_assessment(),
--      score_worked_answers() and get_answer_review() mark, count and show
--      only those — so a Set C paper is out of Set C's points, not all eight
--      sets'. duplicate_paper() copies the labels.
--   Each function is the body last defined (115, 025, 083, 105, 042, 110)
--   with the set filter added. A paper without set labels is unchanged.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'assessments' AND column_name = 'requires_admission') THEN
    RAISE EXCEPTION 'Run sql/115 first. Nothing was changed.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Which set a question is in, and a paper's sets
-- ---------------------------------------------------------------------
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS set_label text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_set_label_chk') THEN
    ALTER TABLE public.questions ADD CONSTRAINT questions_set_label_chk
      CHECK (set_label IS NULL OR set_label ~ '^[A-Z]$');
  END IF;
END $$;
COMMENT ON COLUMN public.questions.set_label IS
  'The set this item is in, A-Z; NULL = in every set (116).';

ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS set_labels text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.assessments.set_labels IS
  'The sets this paper''s questions are in, sorted. Kept by trigger from questions.set_label (116).';
GRANT SELECT (set_labels) ON public.assessments TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_paper_sets(p_paper uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.assessments a
     SET set_labels = coalesce((SELECT array_agg(DISTINCT q.set_label ORDER BY q.set_label)
                                  FROM public.questions q
                                 WHERE (q.exam_id = p_paper OR q.assessment_id = p_paper)
                                   AND q.set_label IS NOT NULL), '{}')
   WHERE a.id = p_paper;
$$;
REVOKE ALL ON FUNCTION public.refresh_paper_sets(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.questions_refresh_sets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.refresh_paper_sets(coalesce(OLD.assessment_id, OLD.exam_id));
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.refresh_paper_sets(coalesce(NEW.assessment_id, NEW.exam_id));
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.questions_refresh_sets() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS questions_refresh_sets ON public.questions;
CREATE TRIGGER questions_refresh_sets
  AFTER INSERT OR DELETE OR UPDATE OF set_label, exam_id, assessment_id ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.questions_refresh_sets();

-- In a set, or in every set.
CREATE OR REPLACE FUNCTION public.question_in_set(p_label text, p_set text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_label IS NULL OR p_label = p_set;
$$;

-- ---------------------------------------------------------------------
-- 2. Which set each student is sitting
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.paper_set_choices (
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  set_label     text NOT NULL CHECK (set_label ~ '^[A-Z]$'),
  chosen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assessment_id, student_id)
);
COMMENT ON TABLE public.paper_set_choices IS
  'The set each student sits on a paper with sets; written by get_exam_questions() (116).';
ALTER TABLE public.paper_set_choices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_set_choices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.paper_set_choices TO authenticated;
DROP POLICY IF EXISTS paper_set_choices_read_by_paper ON public.paper_set_choices;
CREATE POLICY paper_set_choices_read_by_paper ON public.paper_set_choices
  FOR SELECT TO authenticated USING (public.can_manage_paper(assessment_id));

-- ---------------------------------------------------------------------
-- 3. Handed over, marked, counted and reviewed by set
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_exam_questions(uuid, uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.get_exam_questions(
  p_assessment_id uuid,
  p_student_id    uuid,
  p_session_token text,
  p_entry         uuid DEFAULT NULL,
  p_set           text DEFAULT NULL
) RETURNS TABLE (
  id              uuid,
  exam_id         uuid,
  assessment_id   uuid,
  question_number integer,
  question_text   text,
  question_type   text,
  category        text,
  choices         jsonb,
  choice_a        text,
  choice_b        text,
  choice_c        text,
  choice_d        text,
  choice_e        text,
  image_url       text,
  created_at      timestamptz,
  marks           integer,
  work_given      text,
  work_variable   text,
  work_mode       text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student  uuid;
  v_paper    public.assessments%ROWTYPE;
  v_sections text;
  v_sitting  boolean;
  v_set      text;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_paper FROM public.assessments a WHERE a.id = p_assessment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That assessment no longer exists.' USING ERRCODE = '42704';
  END IF;

  SELECT u.section INTO v_sections FROM public.users u WHERE u.id = v_student;
  IF NOT public.sections_overlap(v_sections, v_paper.target_section) THEN
    RAISE EXCEPTION 'This assessment is not for your section.' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.live_sessions ls
    WHERE ls.student_id = v_student
      AND ls.exam_id = p_assessment_id
      AND ls.status IS DISTINCT FROM 'finished'
  ) INTO v_sitting;

  IF NOT v_sitting AND NOT public.assessment_is_available(
       v_paper.is_open, v_paper.opens_at, v_paper.closes_at, v_paper.archived_at) THEN
    RAISE EXCEPTION 'This assessment is not open.' USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_paper.has_password, false) AND NOT v_sitting THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.exam_unlocks x
      WHERE x.assessment_id = p_assessment_id AND x.student_id = v_student
    ) THEN
      RAISE EXCEPTION 'Enter the exam password first.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Every entry, mid-sitting or not: the instructor lets each one in.
  IF coalesce(v_paper.requires_admission, false) THEN
    UPDATE public.exam_admissions x
       SET used_at = coalesce(x.used_at, now())
     WHERE x.assessment_id = p_assessment_id AND x.student_id = v_student
       AND x.entry = p_entry AND x.status = 'admitted'
       AND (x.used_at IS NOT NULL OR x.decided_at > now() - interval '15 minutes');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Your instructor has not let you in yet.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A paper with sets: the student sits one, chosen at Start and recorded
  -- here the first time. Mid-sitting, or once a one-attempt paper is filed,
  -- it cannot be swapped for another.
  IF cardinality(coalesce(v_paper.set_labels, '{}')) > 0 THEN
    IF p_set IS NULL OR NOT (p_set = ANY (v_paper.set_labels)) THEN
      RAISE EXCEPTION 'Choose your set first.' USING ERRCODE = '22023';
    END IF;
    SELECT c.set_label INTO v_set FROM public.paper_set_choices c
     WHERE c.assessment_id = p_assessment_id AND c.student_id = v_student;
    IF v_set IS DISTINCT FROM p_set THEN
      IF v_set IS NOT NULL AND (v_sitting OR (NOT coalesce(v_paper.allow_retakes, false) AND EXISTS (
           SELECT 1 FROM public.results r
            WHERE r.student_id = v_student AND coalesce(r.assessment_id, r.exam_id) = p_assessment_id))) THEN
        RAISE EXCEPTION 'You are sitting Set %. Open that set.', v_set USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.paper_set_choices (assessment_id, student_id, set_label)
      VALUES (p_assessment_id, v_student, p_set)
      ON CONFLICT ON CONSTRAINT paper_set_choices_pkey DO UPDATE SET set_label = EXCLUDED.set_label, chosen_at = now();
    END IF;
    v_set := p_set;
  END IF;

  RETURN QUERY
  SELECT q.id, q.exam_id, q.assessment_id, q.question_number, q.question_text,
         coalesce(q.question_type, 'multiple_choice'), q.category, q.choices,
         q.choice_a, q.choice_b, q.choice_c, q.choice_d, q.choice_e,
         q.image_url, q.created_at,
         coalesce(q.marks, 1), q.work_given, coalesce(q.work_variable, 'x'),
         q.work_rubric ->> 'mode'
  FROM public.questions q
  WHERE (q.exam_id = p_assessment_id OR q.assessment_id = p_assessment_id)
    AND public.question_in_set(q.set_label, v_set)
  ORDER BY q.question_number NULLS LAST, q.id;
END $$;
REVOKE ALL ON FUNCTION public.get_exam_questions(uuid, uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_exam_questions(uuid, uuid, text, uuid, text) TO anon, authenticated;

-- 025's scorer, with the set. Dropped, not replaced: a new argument.
DROP FUNCTION IF EXISTS public.score_answers(uuid, jsonb);
DROP FUNCTION IF EXISTS public.score_answers(uuid, jsonb, text);
CREATE FUNCTION public.score_answers(
  p_assessment_id uuid, p_answers jsonb, p_set text DEFAULT NULL
) RETURNS TABLE (
  score         int,
  total_items   int,
  answers_json  jsonb,
  points_earned numeric,
  points_total  numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mc AS (
    SELECT q.id,
           coalesce(q.question_type,'multiple_choice') = 'multi_select' AS is_multi,
           -- An item with no marks stated is worth one, exactly as before.
           coalesce(q.marks, 1)::numeric AS marks,
           CASE WHEN coalesce(q.question_type,'multiple_choice') = 'multi_select'
                THEN public.answer_index_set(q.correct_answers)
                ELSE public.answer_index_set(to_jsonb(q.correct_answer))
           END AS key_set
    FROM public.questions q
    WHERE q.exam_id = p_assessment_id
      AND coalesce(q.question_type,'multiple_choice') NOT IN ('essay','worked_solution')
      AND public.question_in_set(q.set_label, p_set)
  ), judged AS (
    SELECT mc.id, mc.is_multi, mc.marks,
           public.answer_index_set(p_answers -> mc.id::text) AS chosen_set,
           CASE WHEN public.answer_index_set(p_answers -> mc.id::text) IS NULL THEN NULL
                ELSE public.answer_index_set(p_answers -> mc.id::text) = mc.key_set
           END AS is_correct
    FROM mc
  )
  SELECT coalesce(count(*) FILTER (WHERE is_correct), 0)::int,
         (SELECT count(*) FROM mc)::int,
         coalesce(jsonb_object_agg(id::text, jsonb_build_object(
           'chosen', CASE WHEN is_multi THEN to_jsonb(chosen_set)
                          ELSE to_jsonb(chosen_set[1]) END,
           'is_correct', is_correct,
           -- Carried per item so a student's answer review can say "2 of 5"
           -- on the item itself rather than only in the paper's total.
           'marks', marks
         )) FILTER (WHERE chosen_set IS NOT NULL), '{}'::jsonb),
         coalesce(sum(marks) FILTER (WHERE is_correct), 0)::numeric,
         (SELECT coalesce(sum(marks), 0) FROM mc)::numeric
  FROM judged;
$$;
REVOKE ALL ON FUNCTION public.score_answers(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_assessment(
  p_student_id         uuid,
  p_assessment_id      uuid,
  p_answers            jsonb,
  p_time_taken_seconds integer DEFAULT NULL,
  p_tab_switches       integer DEFAULT 0,
  p_violation_logs     jsonb   DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE s int; t int; a jsonb; pe numeric; pt numeric; n int;
        retakes boolean; reveal boolean;
        v_filed int := 0; v_work jsonb; v_patch jsonb; v_scored jsonb; v_set text;
BEGIN
  SELECT allow_retakes, show_answers INTO retakes, reveal
  FROM public.assessments WHERE id = p_assessment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown assessment'; END IF;

  -- The set this student sat (116): only its items, and those in every
  -- set, are marked and counted in the total.
  SELECT c.set_label INTO v_set FROM public.paper_set_choices c
   WHERE c.assessment_id = p_assessment_id AND c.student_id = p_student_id;

  SELECT score, total_items, answers_json, points_earned, points_total
    INTO s, t, a, pe, pt
  FROM public.score_answers(p_assessment_id, p_answers, v_set);

  IF retakes THEN
    SELECT coalesce(max(attempt_no),0)+1 INTO n FROM public.review_attempts
    WHERE student_id = p_student_id AND assessment_id = p_assessment_id;

    INSERT INTO public.review_attempts
      (student_id, assessment_id, attempt_no, score, total_items, answers_json,
       time_taken_seconds, points_earned, points_total)
    VALUES (p_student_id, p_assessment_id, n, s, t, a,
            p_time_taken_seconds, pe, pt);
    GET DIAGNOSTICS v_filed = ROW_COUNT;
  ELSE
    n := 1;
    INSERT INTO public.results
      (student_id, exam_id, assessment_id, score, total_items, answers_json,
       time_taken_seconds, tab_switches, violation_logs, submitted_at,
       points_earned, points_total)
    VALUES (p_student_id, p_assessment_id, p_assessment_id, s, t, a,
            p_time_taken_seconds, coalesce(p_tab_switches,0),
            coalesce(p_violation_logs,'[]'::jsonb), now(), pe, pt)
    ON CONFLICT ON CONSTRAINT results_student_exam_key DO NOTHING;
    GET DIAGNOSTICS v_filed = ROW_COUNT;
  END IF;

  -- The working, from the live session (one row per student per paper).
  -- Only for a row this call wrote, and only on a paper with worked items.
  IF v_filed > 0 AND EXISTS (
       SELECT 1 FROM public.questions q
       WHERE q.exam_id = p_assessment_id
         AND coalesce(q.question_type,'multiple_choice') = 'worked_solution') THEN
    BEGIN
      SELECT ls.work_answers_json INTO v_work
      FROM public.live_sessions ls
      WHERE ls.student_id = p_student_id AND ls.exam_id = p_assessment_id
      LIMIT 1;

      -- Exactly the shape save_worked_answers() stores: this paper's worked
      -- items only, blank lines dropped, marks left for the marker.
      SELECT jsonb_object_agg(k, jsonb_build_object('type','worked','lines',lines,'marks',NULL))
        INTO v_patch
      FROM (
        SELECT e.key AS k,
               (SELECT jsonb_agg(l) FROM jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(e.value -> 'lines') = 'array'
                       THEN e.value -> 'lines' ELSE '[]'::jsonb END) AS l
                 WHERE btrim(l) <> '') AS lines
        FROM jsonb_each(CASE WHEN jsonb_typeof(v_work) = 'object'
                             THEN v_work ELSE '{}'::jsonb END) AS e
        WHERE EXISTS (SELECT 1 FROM public.questions q
                      WHERE q.id::text = e.key AND q.exam_id = p_assessment_id
                        AND coalesce(q.question_type,'multiple_choice') = 'worked_solution')
      ) w
      WHERE lines IS NOT NULL;

      IF v_patch IS NOT NULL THEN
        IF retakes THEN
          UPDATE public.review_attempts ra
             SET answers_json = coalesce(ra.answers_json,'{}'::jsonb) || v_patch
           WHERE ra.student_id = p_student_id AND ra.assessment_id = p_assessment_id
             AND ra.attempt_no = n;
        ELSE
          UPDATE public.results r
             SET answers_json = coalesce(r.answers_json,'{}'::jsonb) || v_patch
           WHERE r.student_id = p_student_id AND r.assessment_id = p_assessment_id;
        END IF;
      END IF;
    EXCEPTION WHEN others THEN
      -- Never at the cost of the submission. The row stands as 025 filed it,
      -- and the dashboard's Recover working finds it (no work_total).
      RAISE WARNING 'submit_assessment: working not filed for % on %: %',
        p_student_id, p_assessment_id, SQLERRM;
      v_patch := NULL;
    END;

    -- 083: marked in a block of its own, AFTER the working is filed, so a
    -- marking that runs out of time leaves the paper and its working on file
    -- with the marks pending — never the submission refused. A statement
    -- timeout is query_canceled, which WHEN others does not catch: it is
    -- named here on purpose.
    BEGIN
      -- Marked even when nothing was written: a blank item is a real 0, and
      -- this is what records the marks available, so the paper reads out of
      -- its full total rather than the picked items alone.
      v_scored := public.score_worked_answers(p_student_id, p_assessment_id,
                                              CASE WHEN retakes THEN n END);
    EXCEPTION
      WHEN query_canceled THEN
        RAISE WARNING 'submit_assessment: marking ran out of time for % on %; filed, marks pending',
          p_student_id, p_assessment_id;
        v_scored := NULL;
      WHEN others THEN
        RAISE WARNING 'submit_assessment: working not marked for % on %: %',
          p_student_id, p_assessment_id, SQLERRM;
        v_scored := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'score', s, 'total_items', t, 'attempt_no', n, 'can_review', reveal,
    'points_earned', pe, 'points_total', pt,
    'work_marks', v_scored -> 'work_marks', 'work_total', v_scored -> 'work_total'
  );
END $$;

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
  v_set text;
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

  -- Only the set this student sat (116), and the items in every set.
  SELECT c.set_label INTO v_set FROM public.paper_set_choices c
   WHERE c.assessment_id = p_assessment_id AND c.student_id = p_student_id;

  FOR r IN
    SELECT q.id, coalesce(q.marks,1)::numeric AS marks, q.work_rubric,
           public.accepted_answers(q.work_rubric) AS accepted
    FROM public.questions q
    WHERE q.exam_id = p_assessment_id
      AND coalesce(q.question_type,'multiple_choice') = 'worked_solution'
      AND public.question_in_set(q.set_label, v_set)
  LOOP
    v_total := v_total + r.marks;
    v_lines := CASE WHEN jsonb_typeof(v_answers -> r.id::text -> 'lines') = 'array'
                    THEN v_answers -> r.id::text -> 'lines' ELSE '[]'::jsonb END;

    IF r.work_rubric ->> 'mode' = 'quantity' THEN
      v_m := public.mark_quantities(v_lines, r.work_rubric);
      v_m := jsonb_set(v_m, '{marks}', to_jsonb(least((v_m ->> 'marks')::numeric, r.marks)));
      v_earned := v_earned + (v_m ->> 'marks')::numeric;
      v_patch := v_patch || jsonb_build_object(r.id::text, jsonb_build_object(
        'type','worked', 'lines', v_lines,
        'marks', (v_m ->> 'marks')::numeric, 'of', r.marks,
        'correct', (v_m ->> 'marks')::numeric >= r.marks,
        'reason', v_m ->> 'reason', 'parts', v_m -> 'parts'));
      CONTINUE;
    END IF;

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

CREATE OR REPLACE FUNCTION public.get_answer_review(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_attempt_no    integer,
  p_session_token text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student uuid;
  reveal    boolean;
  show_key  boolean;
  ans       jsonb;
  v_set     text;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  SELECT show_answers, review_shows_key INTO reveal, show_key
  FROM public.assessments WHERE id = p_assessment_id;
  IF NOT coalesce(reveal, false) THEN
    RAISE EXCEPTION 'Answers are not available for this assessment';
  END IF;
  show_key := coalesce(show_key, true);

  SELECT ra.answers_json INTO ans
  FROM public.review_attempts ra
  WHERE ra.student_id = v_student AND ra.assessment_id = p_assessment_id
    AND (p_attempt_no IS NULL OR ra.attempt_no = p_attempt_no)
  ORDER BY ra.attempt_no DESC LIMIT 1;

  IF ans IS NULL THEN
    SELECT r.answers_json INTO ans FROM public.results r
    WHERE r.student_id = v_student AND r.assessment_id = p_assessment_id;
  END IF;

  IF ans IS NULL THEN
    RAISE EXCEPTION 'Submit this assessment before viewing the answers';
  END IF;

  -- Only the set this student sat (116), and the items in every set.
  SELECT c.set_label INTO v_set FROM public.paper_set_choices c
   WHERE c.assessment_id = p_assessment_id AND c.student_id = v_student;

  RETURN (
    SELECT coalesce(jsonb_agg(x ORDER BY (x->>'question_number')::int NULLS LAST), '[]'::jsonb)
    FROM (
      -- Picked items. The key goes only where it may: always on a paper
      -- that shows it, otherwise only on an item already answered right
      -- (where it is the student's own answer back).
      SELECT jsonb_build_object(
        'question_id', q.id, 'question_number', q.question_number,
        'question_text', q.question_text,
        'question_type', coalesce(q.question_type,'multiple_choice'),
        'choices', q.choices,
        'correct', CASE WHEN show_key OR ok THEN to_jsonb(q.correct_answer) END,
        'marks', coalesce(q.marks, 1),
        'correct_set', CASE
          WHEN coalesce(q.question_type,'multiple_choice') = 'multi_select' AND (show_key OR ok)
          THEN coalesce(to_jsonb(public.answer_index_set(q.correct_answers)), '[]'::jsonb)
        END,
        'chosen', ans -> q.id::text -> 'chosen',
        'is_correct', ok,
        'key_hidden', NOT (show_key OR ok)
      ) AS x
      FROM public.questions q
      CROSS JOIN LATERAL (SELECT coalesce((ans -> q.id::text ->> 'is_correct')::boolean, false) AS ok) k
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') NOT IN ('essay','worked_solution')
        AND public.question_in_set(q.set_label, v_set)

      UNION ALL

      -- Worked items: the problem, every line written, which step each line
      -- was, what it earned, and — where allowed — the answer. The accept
      -- lists and the intermediate steps of the rubric are NOT released.
      SELECT jsonb_build_object(
        'question_id', q.id, 'question_number', q.question_number,
        'question_text', q.question_text,
        'question_type', 'worked_solution',
        'work_given', q.work_given,
        'work_mode', q.work_rubric ->> 'mode',
        'marks', coalesce(q.marks, 1),
        'earned', coalesce((ans -> q.id::text ->> 'marks')::numeric, 0),
        'chosen', (
          SELECT t FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(ans -> q.id::text -> 'lines') = 'array'
                        THEN ans -> q.id::text -> 'lines' ELSE '[]'::jsonb END)
                 WITH ORDINALITY AS e(t, ord)
           WHERE btrim(t) <> '' ORDER BY ord DESC LIMIT 1),
        'lines', CASE WHEN jsonb_typeof(ans -> q.id::text -> 'lines') = 'array'
                      THEN ans -> q.id::text -> 'lines' ELSE '[]'::jsonb END,
        'line_steps', ans -> q.id::text -> 'line_steps',
        'reason', ans -> q.id::text ->> 'reason',
        'correct_latex', CASE WHEN show_key OR ok THEN q.work_rubric -> 'steps' -> -1 ->> 'latex' END,
        -- The worked solution, step by step, for a line-by-line item — only
        -- on a paper that shows its key.
        'solution', CASE WHEN show_key AND q.work_rubric ->> 'mode' = 'lines'
                         THEN (SELECT jsonb_agg(s ->> 'latex' ORDER BY o)
                                 FROM jsonb_array_elements(q.work_rubric -> 'steps') WITH ORDINALITY AS z(s, o)) END,
        'is_correct', ok,
        'key_hidden', NOT (show_key OR ok)
      ) AS x
      FROM public.questions q
      CROSS JOIN LATERAL (SELECT coalesce((ans -> q.id::text ->> 'correct')::boolean, false) AS ok) k
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') = 'worked_solution'
        AND public.question_in_set(q.set_label, v_set)
    ) s
  );
END $$;

CREATE OR REPLACE FUNCTION public.duplicate_paper(
  p_source_id            uuid,
  p_new_title            text,
  p_target_section       text,
  p_target_instructor_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_owner uuid := coalesce(p_target_instructor_id, auth.uid());
  v_new   uuid;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_me) THEN
    RAISE EXCEPTION 'Only a signed-in instructor can duplicate a paper.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.assessments a
     WHERE a.id = p_source_id
       AND (a.instructor_id = v_me
            OR EXISTS (SELECT 1 FROM public.exam_shares s
                        WHERE s.exam_id = a.id AND s.shared_with = v_me))
  ) THEN
    RAISE EXCEPTION 'You can duplicate only a paper you own or one shared with you.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_owner) THEN
    RAISE EXCEPTION 'The instructor to give the copy to was not found.' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_new_title, '')) = '' OR btrim(coalesce(p_target_section, '')) = '' THEN
    RAISE EXCEPTION 'The copy needs a title and a section.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.assessments
    (kind, title, description, target_section, instructor_id, is_open,
     opens_at, closes_at, duration_minutes, exam_password, has_password,
     allow_retakes, show_answers, score_policy, review_shows_key,
     shuffle_choices, shuffle_questions, uses_sets)
  SELECT a.kind, btrim(p_new_title), a.description, btrim(p_target_section), v_owner, false,
         NULL, NULL, a.duration_minutes, a.exam_password, a.has_password,
         a.allow_retakes, a.show_answers, a.score_policy, a.review_shows_key,
         a.shuffle_choices, a.shuffle_questions, a.uses_sets
    FROM public.assessments a
   WHERE a.id = p_source_id
  RETURNING id INTO v_new;

  INSERT INTO public.questions
    (exam_id, assessment_id, question_number, question_text, question_type,
     category, choices, correct_answer, correct_answers, image_url,
     marks, work_given, work_variable, work_rubric, set_label)
  SELECT v_new, v_new, q.question_number, q.question_text, q.question_type,
         q.category, q.choices, q.correct_answer, q.correct_answers, q.image_url,
         q.marks, q.work_given, q.work_variable, q.work_rubric, q.set_label
    FROM public.questions q
   WHERE q.exam_id = p_source_id OR q.assessment_id = p_source_id;

  RETURN v_new;
END $$;

-- ---------------------------------------------------------------------
-- 4. A unit typed with a superscript reads as one with a digit
-- ---------------------------------------------------------------------
-- 105's key dropped every character that is not a letter, digit, / % or $,
-- so "kg/m³" read as "kg/m" — a phone's ³ lost the mark, and listing
-- "kg/m³" would have let a bare "kg/m" through. ² and ³ (and ¹) are now
-- their digits first. JS twin: quantityUnitKey() in src/lib/quantityAnswer.js.
CREATE OR REPLACE FUNCTION public.quantity_unit_key(p_unit text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 translate(replace(lower(coalesce(p_unit, '')), '₱', 'php'), '¹²³', '123'),
                 '\mper\M', '/', 'g'),
               '[^a-z0-9/%$]', '', 'g'),
             '/+', '/', 'g'),
           '([a-z]*[a-rt-z])s(?![a-z])', '\1', 'g');
$$;

-- Every paper's sets, from its questions as they stand.
UPDATE public.assessments a
   SET set_labels = coalesce((SELECT array_agg(DISTINCT q.set_label ORDER BY q.set_label)
                                FROM public.questions q
                               WHERE (q.exam_id = a.id OR q.assessment_id = a.id)
                                 AND q.set_label IS NOT NULL), '{}')
 WHERE a.set_labels IS DISTINCT FROM coalesce((SELECT array_agg(DISTINCT q.set_label ORDER BY q.set_label)
                                FROM public.questions q
                               WHERE (q.exam_id = a.id OR q.assessment_id = a.id)
                                 AND q.set_label IS NOT NULL), '{}');

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
           AND table_name = 'questions' AND column_name = 'set_label')                 AS questions_have_sets,
  has_column_privilege('anon', 'public.assessments', 'set_labels', 'SELECT')           AS students_see_a_papers_sets,
  NOT EXISTS (SELECT 1 FROM public.assessments WHERE cardinality(set_labels) > 0)      AS no_paper_has_sets_yet,
  NOT has_table_privilege('anon', 'public.paper_set_choices', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.paper_set_choices', 'INSERT')
    AND has_table_privilege('authenticated', 'public.paper_set_choices', 'SELECT')    AS choices_read_by_instructors_only,
  has_function_privilege('anon', 'public.get_exam_questions(uuid,uuid,text,uuid,text)', 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public' AND p.proname = 'get_exam_questions' AND p.pronargs <> 5) AS gate_takes_the_set,
  NOT has_function_privilege('anon', 'public.score_answers(uuid,jsonb,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.score_answers(uuid,jsonb,text)', 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public' AND p.proname = 'score_answers' AND p.pronargs = 2) AS scorer_takes_the_set,
  (SELECT bool_and(prosrc LIKE '%question_in_set%') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (p.proname IN ('score_answers', 'score_worked_answers')
                                    OR (p.proname = 'get_answer_review' AND p.pronargs = 4)))
    AND (SELECT bool_and(prosrc LIKE '%paper_set_choices%') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (p.proname IN ('submit_assessment', 'score_worked_answers')
                                    OR (p.proname = 'get_answer_review' AND p.pronargs = 4))) AS marking_and_review_by_set,
  (SELECT prosrc LIKE '%set_label)%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'duplicate_paper')                     AS duplicate_keeps_sets,
  public.quantity_unit_key('kg/m³') = public.quantity_unit_key('kg/m^3')
    AND public.quantity_unit_key('lb/ft²') = 'lb/ft2'
    AND public.quantity_unit_key('kg/m³') <> public.quantity_unit_key('kg/m')           AS superscript_units_read;
