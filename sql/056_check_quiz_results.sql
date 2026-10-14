-- =====================================================================
-- 056 — READ-ONLY: why MATH 117 Quiz results show zero
--
-- Changes nothing. One row per kind of result on every paper whose title
-- starts "MATH 117 Quiz", with how many results look that way. No names,
-- no answers. Copy the whole result table into the chat.
-- =====================================================================

SELECT a.title,
       a.is_open,
       r.total_items,
       (r.points_total IS NOT NULL)                                   AS has_points,
       r.points_earned,
       r.points_total,
       CASE WHEN r.work_marks IS NULL THEN 'not marked'
            WHEN r.work_marks = 0 THEN '0'
            ELSE 'above 0' END                                         AS work_marks,
       r.work_total,
       (SELECT count(*) FROM jsonb_each(coalesce(r.answers_json, '{}'::jsonb)) e
         WHERE jsonb_typeof(e.value) = 'object'
           AND jsonb_typeof(e.value -> 'lines') = 'array'
           AND jsonb_array_length(e.value -> 'lines') > 0)             AS items_with_working_in_result,
       (SELECT count(*) FROM public.live_sessions ls,
               jsonb_each(coalesce(ls.work_answers_json, '{}'::jsonb)) e
         WHERE ls.student_id = r.student_id AND ls.exam_id = r.exam_id
           AND jsonb_typeof(e.value) = 'object'
           AND jsonb_typeof(e.value -> 'lines') = 'array'
           AND jsonb_array_length(e.value -> 'lines') > 0)             AS items_with_working_in_live_session,
       count(*)                                                        AS results
FROM public.results r
JOIN public.assessments a ON a.id = coalesce(r.assessment_id, r.exam_id)
WHERE a.title LIKE 'MATH 117 Quiz%'
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
ORDER BY 1, results DESC;
