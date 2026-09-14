-- =====================================================================
-- 014 — two students may share a Student ID
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- WHY
-- `users.student_code` was declared UNIQUE in the original schema, on the
-- assumption that a PATTS Student ID identifies exactly one person. It does
-- not: the instructor has two students carrying the same ID, and the portal
-- currently refuses to hold both — the second insert fails, so one of two
-- real students cannot be enrolled at all.
--
-- IS THIS SAFE FOR LOGIN?  Yes, and that is the whole reason it can be done.
-- A student does not log in with their Student ID alone. Login.jsx matches
-- the PAIR:
--        .eq('student_email', ...)  AND  .eq('student_code', ...)
-- and `student_email` STAYS UNIQUE — this file does not touch it. So every
-- (email, Student ID) pair still resolves to exactly one row, and two people
-- sharing an ID simply sign in with their own different emails.
--
-- WHAT CHANGES FOR EVERYTHING ELSE
-- The Student ID stops being an identifier and becomes a credential. Anything
-- that looks a student up by ID ALONE is now ambiguous and must not be trusted
-- to return "the" student. The two places in the app that did this are changed
-- in the same commit as this migration:
--   * adding a student by hand no longer rejects a duplicate ID (it still
--     rejects a duplicate email);
--   * the roster CSV import treats email as the identity, and will only fall
--     back to matching on Student ID when exactly one existing student carries
--     that ID. Where an ID is shared, a row with an unknown email becomes a new
--     student rather than being merged into whichever of the two came back
--     first — which is what the old code would have done.
--
-- Worth knowing: the one-off roster scripts at the repo root
-- (roster_*.sql) match with `... OR u.student_code = r.student_code`. That
-- pattern is now capable of matching the wrong person. They have already run
-- and are kept only as history, but do not copy that line into a new one.
--
-- ---------------------------------------------------------------------
-- REHEARSE IT FIRST (recommended)
--   1. Change  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file and read the VERIFY output.
--   3. Change it back and run again for real.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Sanity
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='users'
                   AND column_name='student_code') THEN
    RAISE EXCEPTION 'public.users.student_code not found — wrong database?';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Drop whatever is enforcing uniqueness on student_code
-- ---------------------------------------------------------------------
-- The constraint was created inline as `student_code text UNIQUE`, so its
-- name is whatever Postgres generated — users_student_code_key on a stock
-- install, but not worth assuming. Find it by what it does rather than by
-- its name, and drop every one that matches.
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t   ON t.oid = c.conrelid
    JOIN pg_namespace s ON s.oid = t.relnamespace
    WHERE s.nspname = 'public' AND t.relname = 'users'
      AND c.contype = 'u'
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
           FROM unnest(c.conkey) k
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k)
          = ARRAY['student_code']
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'dropped unique constraint %', r.conname;
    n := n + 1;
  END LOOP;

  -- A bare unique INDEX (no constraint behind it) would enforce the same
  -- thing and survive the loop above, so clear those too.
  FOR r IN
    SELECT i.indexrelid::regclass AS idx
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace s ON s.oid = t.relnamespace
    WHERE s.nspname='public' AND t.relname='users' AND i.indisunique
      AND NOT i.indisprimary
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
           FROM unnest(i.indkey::int[]) k
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k)
          = ARRAY['student_code']
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %s', r.idx);
    RAISE NOTICE 'dropped unique index %', r.idx;
    n := n + 1;
  END LOOP;

  IF n = 0 THEN
    RAISE NOTICE 'nothing to drop — student_code is already non-unique';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Keep it fast to look up
-- ---------------------------------------------------------------------
-- The unique index was also the lookup index; login filters on student_code
-- alongside student_email, so replace it with a plain one rather than leave
-- the column unindexed.
CREATE INDEX IF NOT EXISTS users_student_code_idx ON public.users (student_code);

COMMENT ON COLUMN public.users.student_code IS
  'PATTS Student ID. NOT unique — two students may share one. It is a credential, not an identifier: use student_email (still UNIQUE), or the id, to identify a student.';

COMMENT ON COLUMN public.users.student_email IS
  'Unique. This is the identity of a student row; login matches it together with student_code.';

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. student_code is no longer unique, student_email still is.
SELECT 'student_code unique?'  AS check,
       count(*) AS constraints_or_indexes
FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
JOIN pg_namespace s ON s.oid=t.relnamespace
WHERE s.nspname='public' AND t.relname='users' AND i.indisunique AND NOT i.indisprimary
  AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM unnest(i.indkey::int[]) k
       JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k) = ARRAY['student_code']
UNION ALL
SELECT 'student_email unique?', count(*)
FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
JOIN pg_namespace s ON s.oid=t.relnamespace
WHERE s.nspname='public' AND t.relname='users' AND i.indisunique AND NOT i.indisprimary
  AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM unnest(i.indkey::int[]) k
       JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k) = ARRAY['student_email'];
-- Expect  student_code = 0  and  student_email = 1.

-- 2. Who currently shares an ID. Empty until you add the second student.
SELECT student_code, count(*) AS students,
       string_agg(full_name || ' <' || coalesce(student_email,'—') || '>', ' | ' ORDER BY full_name) AS who
FROM public.users
WHERE student_code IS NOT NULL
GROUP BY student_code HAVING count(*) > 1
ORDER BY student_code;

-- 3. No two students share an EMAIL — that one must stay impossible.
SELECT count(*) AS students_sharing_an_email
FROM (SELECT student_email FROM public.users
      WHERE student_email IS NOT NULL
      GROUP BY student_email HAVING count(*) > 1) d;
-- Must be 0.
