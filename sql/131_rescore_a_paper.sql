-- =====================================================================
-- 131 — Re-score a paper after its key changes
--
-- Run once in the Supabase SQL editor. Safe to run twice.
--
-- A mark is written when a sitting is filed; editing a key afterwards (a
-- new right choice, an "also counts" choice from sql/130, a fixed maths
-- form or unit) changed nothing already recorded. rescore_paper() marks
-- every filed sitting of a paper again against the key as it is now.
--
--   p_mode 'raise' — an item only ever goes up: for a key that was too
--                    strict (another choice also counts, a unit to accept).
--   p_mode 'full'  — every item takes its new mark, up or down: for a key
--                    that was simply wrong.
--   p_apply false  — a preview: who would change, and how; nothing written.
--   p_apply true   — writes those changes.
--   p_offset/p_limit — a page of sittings (in name order), so a long paper
--                    stays inside the 30 s an instructor's request may run
--                    (sql/054); the dashboard asks page by page.
--
-- Picked items are marked by score_answers() (sql/130), on the student's
-- set (sql/116). Typed items are marked by score_worked_answers() inside a
-- block that is rolled back, so only what this function decides is
-- written. An item marked by hand ("Marked by instructor") is never
-- touched. Only the paper's instructor, or one it is shared with, may call
-- it. Graded sittings (results); a practice paper's retakes are not
-- re-scored.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.rescore_paper(
  p_assessment_id uuid,
  p_mode          text    DEFAULT 'raise',
  p_apply         boolean DEFAULT false,
  p_offset        integer DEFAULT 0,
  p_limit         integer DEFAULT 10
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; v_set text; v_pick jsonb; v_new record; v_old jsonb; v_final jsonb;
  v_after jsonb; k text; o jsonb; n jsonb; v_items jsonb; v_rows jsonb := '[]'::jsonb;
  v_score int; v_points numeric; v_work numeric; v_worked_changed boolean;
  v_total int; v_has_worked boolean; v_n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('raise', 'full') THEN
    RAISE EXCEPTION 'The mode is raise or full.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = p_assessment_id
      AND (a.instructor_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.exam_shares s WHERE s.exam_id = a.id AND s.shared_with = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'You do not have access to this paper.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.results WHERE assessment_id = p_assessment_id;
  v_has_worked := EXISTS (SELECT 1 FROM public.questions q
                          WHERE q.exam_id = p_assessment_id AND q.question_type = 'worked_solution');

  FOR r IN
    SELECT res.id, res.student_id, res.answers_json, res.points_earned, res.work_marks,
           res.points_total, res.work_total, coalesce(u.full_name, 'Student') AS name
    FROM public.results res LEFT JOIN public.users u ON u.id = res.student_id
    WHERE res.assessment_id = p_assessment_id
    ORDER BY u.full_name NULLS LAST, res.id
    OFFSET greatest(coalesce(p_offset, 0), 0) LIMIT least(greatest(coalesce(p_limit, 10), 1), 50)
  LOOP
    v_old := coalesce(r.answers_json, '{}'::jsonb);
    v_final := v_old;
    v_items := '[]'::jsonb;
    v_worked_changed := false;
    SELECT c.set_label INTO v_set FROM public.paper_set_choices c
     WHERE c.assessment_id = p_assessment_id AND c.student_id = r.student_id;

    -- Picked items: the student's choices, marked against the key as it is now.
    SELECT coalesce(jsonb_object_agg(e.key, CASE WHEN jsonb_typeof(e.value) = 'object' THEN e.value -> 'chosen' ELSE e.value END), '{}'::jsonb)
      INTO v_pick
      FROM jsonb_each(v_old) e JOIN public.questions q ON q.id::text = e.key AND q.exam_id = p_assessment_id
     WHERE coalesce(q.question_type, 'multiple_choice') IN ('multiple_choice', 'multi_select')
       AND (jsonb_typeof(e.value) <> 'object' OR e.value ? 'chosen');
    SELECT * INTO v_new FROM public.score_answers(p_assessment_id, v_pick, v_set);

    FOR k, n IN SELECT key, value FROM jsonb_each(coalesce(v_new.answers_json, '{}'::jsonb)) LOOP
      o := v_old -> k;
      CONTINUE WHEN coalesce((o ->> 'is_correct')::boolean, false) = coalesce((n ->> 'is_correct')::boolean, false);
      CONTINUE WHEN p_mode = 'raise' AND coalesce((o ->> 'is_correct')::boolean, false);
      SELECT question_number INTO v_n FROM public.questions WHERE id::text = k;
      v_items := v_items || jsonb_build_array(jsonb_build_object('n', v_n,
        'from', CASE WHEN coalesce((o ->> 'is_correct')::boolean, false) THEN 'right' ELSE 'wrong' END,
        'to',   CASE WHEN coalesce((n ->> 'is_correct')::boolean, false) THEN 'right' ELSE 'wrong' END));
      v_final := jsonb_set(v_final, ARRAY[k], CASE WHEN jsonb_typeof(o) = 'object' THEN o || n ELSE n END);
    END LOOP;

    -- Typed items: marked by the database's marker in a block rolled back
    -- straight after, so only what is decided below is written.
    v_after := NULL;
    IF v_has_worked THEN
      BEGIN
        PERFORM public.score_worked_answers(r.student_id, p_assessment_id, NULL);
        SELECT answers_json INTO v_after FROM public.results WHERE id = r.id;
        RAISE EXCEPTION USING ERRCODE = 'P0131', MESSAGE = 'rescore preview';
      EXCEPTION WHEN SQLSTATE 'P0131' THEN NULL;
      END;
      FOR k, n IN SELECT key, value FROM jsonb_each(coalesce(v_after, '{}'::jsonb))
                  WHERE jsonb_typeof(value) = 'object' AND value ->> 'type' = 'worked' LOOP
        o := v_old -> k;
        CONTINUE WHEN coalesce(o ->> 'reason', '') LIKE 'Marked by instructor%';
        CONTINUE WHEN coalesce((n ->> 'marks')::numeric, 0) = coalesce((o ->> 'marks')::numeric, 0);
        CONTINUE WHEN p_mode = 'raise' AND coalesce((n ->> 'marks')::numeric, 0) < coalesce((o ->> 'marks')::numeric, 0);
        SELECT question_number INTO v_n FROM public.questions WHERE id::text = k;
        v_items := v_items || jsonb_build_array(jsonb_build_object('n', v_n,
          'from', coalesce((o ->> 'marks')::numeric, 0), 'to', coalesce((n ->> 'marks')::numeric, 0)));
        v_final := jsonb_set(v_final, ARRAY[k], n);
        v_worked_changed := true;
      END LOOP;
    END IF;

    CONTINUE WHEN jsonb_array_length(v_items) = 0;

    -- Totals from what is now recorded, item by item.
    SELECT count(*) FILTER (WHERE (v_final -> q.id::text ->> 'is_correct')::boolean),
           coalesce(sum(coalesce(q.marks, 1)) FILTER (WHERE (v_final -> q.id::text ->> 'is_correct')::boolean), 0)
      INTO v_score, v_points
      FROM public.questions q
     WHERE q.exam_id = p_assessment_id
       AND coalesce(q.question_type, 'multiple_choice') IN ('multiple_choice', 'multi_select')
       AND public.question_in_set(q.set_label, v_set);
    SELECT coalesce(sum((e.value ->> 'marks')::numeric), 0) INTO v_work
      FROM jsonb_each(v_final) e
     WHERE jsonb_typeof(e.value) = 'object' AND e.value ->> 'type' = 'worked';

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'result_id', r.id, 'name', r.name,
      'from', coalesce(r.points_earned, 0) + coalesce(r.work_marks, 0),
      'to', v_points + v_work,
      'out_of', coalesce(v_new.points_total, r.points_total, 0) + coalesce(r.work_total, 0),
      'items', v_items));

    IF p_apply THEN
      UPDATE public.results
         SET answers_json   = v_final,
             score          = v_score,
             total_items    = v_new.total_items,
             points_earned  = v_points,
             points_total   = v_new.points_total,
             work_marks     = CASE WHEN v_has_worked THEN v_work ELSE work_marks END,
             work_marked_at = CASE WHEN v_worked_changed THEN now() ELSE work_marked_at END
       WHERE id = r.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'mode', p_mode, 'applied', p_apply, 'sittings', v_total,
    'next_offset', CASE WHEN greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 10), 1), 50) < v_total
                        THEN greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 10), 1), 50) END,
    'rows', v_rows);
END $$;

REVOKE ALL ON FUNCTION public.rescore_paper(uuid, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rescore_paper(uuid, text, boolean, integer, integer) TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'rescore_paper')                                    AS function_there,
  has_function_privilege('authenticated', 'public.rescore_paper(uuid, text, boolean, integer, integer)', 'EXECUTE') AS instructors_can_call_it,
  NOT has_function_privilege('anon', 'public.rescore_paper(uuid, text, boolean, integer, integer)', 'EXECUTE')      AS students_cannot_call_it,
  position('accepted_answers' in pg_get_functiondef('public.score_answers(uuid, jsonb, text)'::regprocedure)) > 0  AS sql_130_is_live;
