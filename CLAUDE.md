# PATTS Exam Portal

Online exams, seatworks and lessons for PATTS College of Aeronautics: a
proctored exam screen for students and a dashboard for instructors. React 19 +
Vite on Supabase (Postgres, Auth, Storage, Realtime).

**There is no backend.** The browser talks to Supabase with the public anon
key, so every rule that matters is enforced in Postgres — RLS, column grants
and SECURITY DEFINER functions in `sql/`. A check done only in React is not a
check.

## This repository is public

- Never commit exam content: question banks, answer keys, or the SQL that
  loads them. They live in a separate folder outside the repo, so content work
  (new papers, keys, re-marking scripts) is done locally, not in a cloud
  session. `sql/` holds schema and migrations only.
- Never commit student data — names, emails, student codes (the codes are
  login credentials). `.gitignore` is deliberately broad; don't loosen it.
- Tests use look-alike problems, never a real paper's items or keys.
- Don't describe unfixed security weaknesses in commits, comments or docs.

## Shipping

Vercel builds production from `main` on every push, so **a push to `main` is a
production deploy that students see within a minute.** In a cloud session,
work on a branch and open a pull request; Kyle merges it, and the merge is the
deploy.

Before anything is merged:
- `npm test` and `npm run build` pass (`npm ci` first in a fresh checkout).
- A QA pass covering bugs, UI/UX, security and mobile — many students sit
  papers on phones. Report it in those four sections.
- No debug output left behind: `console.log`, raw Supabase errors in the UI.

Commit subjects describe the behaviour after the change, as a sentence (see
`git log`), with a body explaining why.

## Database changes are run by hand

Kyle pastes each `sql/NNN_*.sql` into the Supabase SQL editor himself.

- A committed migration is not a live one. Say plainly what he must run.
- End a migration with a read-only VERIFY query: the SQL editor shows only
  the last statement's result, so a check in the middle is never seen.
- New files take the next free number. Gaps in the sequence are deliberate —
  those numbers went to content scripts that live outside the repo.
- Deploy order matters. If the frontend selects a new column or calls a new
  function, the SQL must run first: PostgREST rejects a select that names a
  missing column and the whole screen fails. When code has to ship first,
  fall back ONLY on a missing function (`isMissingFunctionError`), never on a
  refusal — a permission error must stay an error.
- Test migrations with PGlite (real Postgres compiled to WASM,
  `sql/test/*.test.mjs`), not Docker.

## Rules that have bitten before

- **1000-row cap.** PostgREST silently truncates every response at 1000 rows.
  Any query that can grow goes through `fetchAllRows()`
  (`src/AdminDashboard.jsx`).
- **Scores.** `score`/`total_items` are an item COUNT; points sit beside them
  in `points_earned`/`points_total`, and worked-solution items can be pending
  marking. Every score shown, sorted or averaged goes through
  `combinedScore()` (`src/lib/workedShape.js`) and `src/lib/resultsStats.js`.
  Never compute a percentage from `score / total_items` directly.
- **Sections are shared between instructors.** `users.section` is one
  comma-separated string holding every instructor's sections for that
  student. Show only the signed-in instructor's slice, and write back with
  `mergeSections()` (`src/lib/sectionScope.js`) — never overwrite the column.
- **Twins that must agree.** Some rules exist once in SQL and once in JS,
  with a test that cross-checks them. Change both sides together:
  - availability: `assessment_is_available()` ↔ `isAvailableNow()`
  - typed maths answers: `normalize_math()` / `math_answers_match()` ↔
    `src/lib/mathNormalize.js` (`npm run test:leftovers`)
  - the answer's label (`f'(x) =` is part of the answer): `sql/032` ↔
    `src/lib/mathLabel.js` (`npm run test:labels`)
- **Student home cache.** The Summary, Exams and Seatwork tabs share reads
  through `src/lib/studentHome.js`. A new student-side write that changes what
  they show must drop that cache (`forgetStudentHome()`). The exam list reads
  open papers and results fresh on every mount; keep it that way.
- **Closing a paper hides it; it does not submit sittings in progress.** That
  is a decision, not a bug — don't add an auto-submit watcher back.
- **Papers are shuffled per student**, questions and choices both. A question
  can't lean on a heading or on the item before it.

## Checking your work

- Production: https://patts-exam-portal.vercel.app. Confirm a deploy landed
  by fetching the served bundle and finding a string unique to the change.
- Claude cannot sign in as an instructor. For screens behind the dashboard,
  verify the logic with tests and ask Kyle for a visual pass.
- Screens can be rendered in headless Chrome with `src/supabase.js` swapped
  for an in-memory mock. MathLive fires no `input` event for programmatic
  inserts — dispatch one yourself after each.
- A cloud session reaches the live database only if its environment allows
  the Supabase host and sets `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
  If it can't, say what you couldn't check rather than assuming.
