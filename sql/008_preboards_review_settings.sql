-- =====================================================================
-- Put every Pre-Boards PATTS paper into review mode
-- Run in the Supabase SQL editor. Idempotent.
--
-- Pre-Boards material is revision material: students should be able to sit
-- a paper as often as they like and see the correct answers afterwards.
-- 004, 006 and 007 each set that on the papers they created, but they only
-- set it at INSERT time — a paper created any other way (from the dashboard,
-- or by an earlier script) keeps the column defaults, and
-- assessments.score_policy DEFAULTS TO 'first' (002:39).
--
-- That default is the quiet one. With score_policy = 'first' retakes still
-- work, but every instructor view keeps showing the FIRST attempt, so a
-- student who retakes and improves appears not to have moved. This script
-- pins all three settings for the whole section in one place.
--
--   allow_retakes = true    sit it as often as you like
--   show_answers  = true    correct answers revealed after submitting
--   score_policy  = 'latest'  the most recent attempt is the one shown
--
-- Targeted by SECTION, not by title, so any Pre-Boards paper added later is
-- covered by re-running this rather than by editing a list.
--
-- Scope: this touches ONLY papers aimed at Pre-Boards PATTS. Papers for
-- AENG 426, AENG 325, the 212L/314L labs and every other section are left
-- exactly as they are — their answer keys stay hidden, which is the whole
-- reason the mock copies exist separately.
-- =====================================================================

BEGIN;

UPDATE public.assessments a
   SET allow_retakes = true,
       show_answers  = true,
       score_policy  = 'latest'
 WHERE EXISTS (
         SELECT 1
         FROM unnest(string_to_array(coalesce(a.target_section,''), ',')) AS t(x)
         WHERE btrim(t.x) = 'Pre-Boards PATTS'
       )
   AND (a.allow_retakes IS DISTINCT FROM true
        OR a.show_answers IS DISTINCT FROM true
        OR a.score_policy IS DISTINCT FROM 'latest');

COMMIT;

-- =====================================================================
-- VERIFY — every Pre-Boards paper should now read t / t / latest.
-- =====================================================================
SELECT a.title, a.kind, a.is_open,
       a.allow_retakes, a.show_answers, a.score_policy,
       (SELECT count(*) FROM public.questions q WHERE q.exam_id = a.id) AS questions
FROM public.assessments a
WHERE EXISTS (
  SELECT 1 FROM unnest(string_to_array(coalesce(a.target_section,''), ',')) AS t(x)
  WHERE btrim(t.x) = 'Pre-Boards PATTS'
)
ORDER BY a.title;

-- Expect 0 rows.
SELECT a.title AS still_not_in_review_mode,
       a.allow_retakes, a.show_answers, a.score_policy
FROM public.assessments a
WHERE EXISTS (
        SELECT 1 FROM unnest(string_to_array(coalesce(a.target_section,''), ',')) AS t(x)
        WHERE btrim(t.x) = 'Pre-Boards PATTS'
      )
  AND (a.allow_retakes IS DISTINCT FROM true
       OR a.show_answers IS DISTINCT FROM true
       OR a.score_policy IS DISTINCT FROM 'latest');

-- Nothing outside Pre-Boards may have had its answer key opened up. Every
-- row here should be a paper that ALREADY had show_answers on before this
-- script ran; if this list grew, something targeted too widely.
SELECT a.title AS non_preboards_with_answers_shown, a.target_section
FROM public.assessments a
WHERE a.show_answers
  AND NOT EXISTS (
        SELECT 1 FROM unnest(string_to_array(coalesce(a.target_section,''), ',')) AS t(x)
        WHERE btrim(t.x) = 'Pre-Boards PATTS'
      )
ORDER BY a.title;
