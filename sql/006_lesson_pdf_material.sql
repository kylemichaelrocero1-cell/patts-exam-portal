-- =====================================================================
-- PHASE 6 — post material as a PDF, not only as a typed lesson
--
-- Run in the Supabase SQL editor. Idempotent — safe to run twice.
--
-- WHY
--   Lessons started markdown-only (sql/001). Plenty of material already
--   exists as a PDF handout — AELP readings, printed modules — and
--   retyping it into markdown is work nobody should have to do.
--
-- WHAT IT ADDS
--   lessons.material_type  'typed' (the markdown body) or 'pdf'
--   lessons.file_url       public URL of the uploaded PDF
--   lessons.file_name      original filename, shown to students
--   lessons.file_size      bytes, so the student sees the download size
--   storage bucket `lesson-files`, public read / instructor write.
--
--   content_md is untouched and still used on a PDF lesson: whatever the
--   instructor types there shows above the file as notes.
--
-- DEPLOY ORDER DOES NOT MATTER. The app asks for these columns and falls
-- back to the old set if they are absent (src/lib/lessonMaterial.js), so
-- lessons keep working either side of this script. Until it is run, the
-- PDF option in the lesson editor is disabled with a note saying so.
-- =====================================================================

BEGIN;

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS material_type text NOT NULL DEFAULT 'typed',
  ADD COLUMN IF NOT EXISTS file_url      text,
  ADD COLUMN IF NOT EXISTS file_name     text,
  ADD COLUMN IF NOT EXISTS file_size     bigint;

-- Recreated rather than added conditionally, so re-running cannot leave two
-- versions of the rule behind.
ALTER TABLE public.lessons DROP CONSTRAINT IF EXISTS lessons_material_type_check;
ALTER TABLE public.lessons ADD CONSTRAINT lessons_material_type_check
  CHECK (material_type IN ('typed', 'pdf'));

COMMIT;

-- anon reads lessons through a table-wide GRANT (sql/001), not a column
-- allow-list like assessments, so the new columns need no further grant.
-- RLS still limits students to published rows.

-- =====================================================================
-- STORAGE — lesson-files bucket
-- Public read: students are anon here, and there is no signed-URL path in
-- this app. Same shape as the question-images bucket in supabase_setup.sql.
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('lesson-files', 'lesson-files', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Server-side limits, so a 300MB scan cannot be uploaded even if the client
-- check is bypassed. Wrapped because older storage schemas lack these columns.
DO $$
BEGIN
  UPDATE storage.buckets
     SET file_size_limit    = 20971520,                    -- 20MB
         allowed_mime_types = ARRAY['application/pdf']
   WHERE id = 'lesson-files';
EXCEPTION WHEN undefined_column THEN
  RAISE NOTICE 'storage.buckets has no file_size_limit/allowed_mime_types — skipped';
END $$;

DROP POLICY IF EXISTS "lesson_files_public_read" ON storage.objects;
DROP POLICY IF EXISTS "lesson_files_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "lesson_files_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "lesson_files_auth_delete" ON storage.objects;

CREATE POLICY "lesson_files_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'lesson-files');

CREATE POLICY "lesson_files_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lesson-files');

CREATE POLICY "lesson_files_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'lesson-files');

CREATE POLICY "lesson_files_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'lesson-files');

-- =====================================================================
-- VERIFY — all four columns present, bucket public, four policies.
-- =====================================================================
SELECT 'lessons material columns' AS check,
       string_agg(column_name, ', ' ORDER BY column_name) AS present
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'lessons'
  AND column_name IN ('material_type', 'file_url', 'file_name', 'file_size');
-- expected: file_name, file_size, file_url, material_type

SELECT 'lesson-files bucket' AS check, id, public
FROM storage.buckets WHERE id = 'lesson-files';
-- expected: one row, public = true

SELECT 'lesson-files policies' AS check, count(*) AS policies
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname LIKE 'lesson_files_%';
-- expected: 4
