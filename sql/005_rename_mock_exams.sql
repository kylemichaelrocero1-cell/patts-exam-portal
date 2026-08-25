-- =====================================================================
-- Rename the mock exams to "<Subject> Mock Exam <n>"
-- Run in the Supabase SQL editor. Idempotent.
--
-- 004 was run before the naming was changed, so the 14 copies exist as
-- "Mock Exam Powerplant 1". This flips them to "Powerplant Mock Exam 1".
--
-- Renaming rather than re-running 004: that script matches existing copies
-- on their title, so under the new naming it would find none and create a
-- second set of 14.
--
-- Titles only. Nothing else about the copies changes, and no source paper
-- is touched.
-- =====================================================================

BEGIN;

UPDATE public.assessments
SET title = regexp_replace(title, '^Mock Exam (.+) ([0-9]+)$', '\1 Mock Exam \2')
WHERE title ~ '^Mock Exam .+ [0-9]+$';

COMMIT;

-- =====================================================================
-- VERIFY — expect 14 rows reading "<Subject> Mock Exam <n>", each still
-- closed, with retakes and answers on, aimed at Pre-Boards PATTS.
-- =====================================================================
SELECT title, is_open, allow_retakes, show_answers, score_policy, target_section,
       (SELECT count(*) FROM public.questions q WHERE q.exam_id = a.id) AS questions
FROM public.assessments a
WHERE a.title LIKE '%Mock Exam %'
ORDER BY a.title;

-- Nothing should remain in the old shape.
SELECT 'old-style names left' AS check, count(*) AS n
FROM public.assessments WHERE title ~ '^Mock Exam .+ [0-9]+$';
