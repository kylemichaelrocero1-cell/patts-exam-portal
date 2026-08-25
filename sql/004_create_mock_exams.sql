-- =====================================================================
-- Create the Pre-Boards mock exams
-- Run in the Supabase SQL editor. Idempotent — re-running creates nothing
-- new, because each copy is matched on its title.
--
-- Copies every AENG 426 paper into a practice version:
--
--   Mock Exam Powerplant 1..6     from the Powerplant papers
--   Mock Exam EEMLE 1..6          from the EEMLE papers
--   Mock Exam Mathematics 1       from the maths diagnostic
--   Mock Exam Practice 1          from the practice exam
--
-- Numbered oldest first within each subject, so the ordering matches the
-- order the originals were sat.
--
-- Each copy:
--   * targets Pre-Boards PATTS ONLY
--   * has unlimited retakes and answer review switched on
--   * shows the LATEST attempt in your Results
--   * is created CLOSED, so you open them when you are ready
--   * carries no password, since these are revision material
--
-- The originals are not touched: not opened, not retargeted, and their
-- answer keys stay hidden. That separation is the whole point — students
-- only ever see answers on the copies.
-- =====================================================================

BEGIN;

WITH src AS (
  SELECT a.*,
         CASE
           WHEN a.title ILIKE 'Powerplant%'   THEN 'Powerplant'
           WHEN a.title ILIKE 'EEMLE%'        THEN 'EEMLE'
           WHEN a.title ILIKE 'Mathematics%'  THEN 'Mathematics'
           ELSE 'Practice'
         END AS subject
  FROM public.assessments a
  WHERE EXISTS (
    SELECT 1 FROM unnest(string_to_array(coalesce(a.target_section,''), ',')) AS t(x)
    WHERE btrim(t.x) = 'AENG 426'
  )
),
numbered AS (
  SELECT src.*,
         'Mock Exam ' || subject || ' ' ||
           row_number() OVER (PARTITION BY subject ORDER BY created_at) AS new_title
  FROM src
),
inserted AS (
  INSERT INTO public.assessments
    (kind, title, description, target_section, instructor_id, is_open,
     duration_minutes, exam_password, has_password,
     allow_retakes, show_answers, score_policy)
  SELECT n.kind,
         n.new_title,
         'Practice copy of "' || n.title || '". Unlimited attempts; answers shown after submitting.',
         'Pre-Boards PATTS',
         n.instructor_id,
         false,           -- closed until you open it
         n.duration_minutes,
         NULL, false,     -- no password on revision material
         true,            -- unlimited retakes
         true,            -- answers revealed after submitting
         'latest'         -- most recent attempt is the one you see
  FROM numbered n
  WHERE NOT EXISTS (
    SELECT 1 FROM public.assessments x WHERE x.title = n.new_title
  )
  RETURNING id, title
)
INSERT INTO public.questions
  (exam_id, assessment_id, question_number, question_text, question_type,
   category, choice_a, choice_b, choice_c, choice_d, correct_answer, image_url)
SELECT i.id, i.id, q.question_number, q.question_text, q.question_type,
       q.category, q.choice_a, q.choice_b, q.choice_c, q.choice_d,
       q.correct_answer, q.image_url
FROM inserted i
JOIN numbered n ON n.new_title = i.title
JOIN public.questions q ON q.exam_id = n.id;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 14 copies, every one closed, retakes + answers on, aimed at Pre-Boards.
SELECT a.title,
       a.is_open, a.allow_retakes, a.show_answers, a.score_policy,
       a.target_section,
       (SELECT count(*) FROM public.questions q WHERE q.exam_id = a.id) AS questions
FROM public.assessments a
WHERE a.title LIKE 'Mock Exam %'
ORDER BY a.title;

-- Question counts must match the papers they came from.
SELECT 'question parity' AS check,
       (SELECT count(*) FROM public.questions q
        JOIN public.assessments a ON a.id = q.exam_id
        WHERE a.title LIKE 'Mock Exam %') AS copied,
       960 AS expected;

-- The source papers must be exactly as they were. Scoped to the AENG 426
-- papers themselves rather than "not a mock", so the check cannot be fooled
-- by any other copy that legitimately has these switches on.
SELECT 'source papers untouched' AS check,
       count(*)                              AS aeng426_papers,
       count(*) FILTER (WHERE is_open)       AS still_open,
       count(*) FILTER (WHERE show_answers)  AS revealing,
       count(*) FILTER (WHERE allow_retakes) AS retakeable
FROM public.assessments a
WHERE a.title NOT LIKE 'Mock Exam %'
  AND EXISTS (
    SELECT 1 FROM unnest(string_to_array(coalesce(a.target_section,''), ',')) AS t(x)
    WHERE btrim(t.x) = 'AENG 426'
  );
-- Expect 14 papers, still_open = 1 (the maths diagnostic), revealing = 0,
-- retakeable = 0.
