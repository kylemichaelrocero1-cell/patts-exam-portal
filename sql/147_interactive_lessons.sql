-- =====================================================================
-- 147 — a lesson can be an interactive page
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent. Needs 006.
-- Run it BEFORE posting the first interactive lesson. The frontend is safe
-- either side of it: no lesson is interactive until an instructor saves one,
-- and until this has run that save is refused with a note naming this file.
--
-- WHY
--   Typed and PDF lessons can be read. These can be explored: moving graphs,
--   guided walk-throughs and targets the student finds on the graph. The
--   instructor uploads one self-contained .html file, as a PDF is uploaded.
--
-- WHAT IT CHANGES
--   lessons.material_type   also accepts 'interactive'
--   lesson-files bucket     also accepts text/html
--
-- Nothing else moves. The file_url, file_name and file_size columns, the
-- bucket's size limit and its policies are the ones PDFs already use.
--
-- The page never runs as part of the portal: StudentLessons reads the file as
-- text and shows it in an iframe sandboxed to scripts only, so it has no
-- access to the portal or the student's session (src/lib/lessonMaterial.js).
-- =====================================================================

BEGIN;

ALTER TABLE public.lessons DROP CONSTRAINT IF EXISTS lessons_material_type_check;
ALTER TABLE public.lessons ADD CONSTRAINT lessons_material_type_check
  CHECK (material_type IN ('typed', 'pdf', 'interactive'));

COMMIT;

-- Wrapped as in 006, because older storage schemas lack this column.
DO $$
BEGIN
  UPDATE storage.buckets
     SET allowed_mime_types = ARRAY['application/pdf', 'text/html']
   WHERE id = 'lesson-files';
EXCEPTION WHEN undefined_column THEN
  RAISE NOTICE 'storage.buckets has no allowed_mime_types — skipped';
END $$;

-- =====================================================================
-- VERIFY — expected: both true.
-- =====================================================================
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%interactive%'
     FROM pg_constraint
    WHERE conname = 'lessons_material_type_check')  AS lessons_accept_interactive,
  (SELECT 'text/html' = ANY (allowed_mime_types)
     FROM storage.buckets
    WHERE id = 'lesson-files')                      AS bucket_accepts_html;
