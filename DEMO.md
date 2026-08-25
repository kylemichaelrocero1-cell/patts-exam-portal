# Student Demo Build

A public-safe copy of the portal for students to practise navigating before a
review or exam. It runs entirely in the browser on invented data.

## What makes it safe to share

- **No credentials.** The demo bundle contains no Supabase URL, no API key, and
  no JWT. `createClient` is tree-shaken out entirely, so the real client is
  never even constructed. Verified by scanning every chunk at build time.
- **No network calls.** `src/demo/mockClient.js` serves everything from memory.
- **No real people.** Every student, score, lesson and question in
  `src/demo/demoData.js` is invented. No answer key from a real paper appears.
- **Nothing persists.** Writes live in memory and reset on reload, so one
  student's clicking never affects another's.
- **It says so.** A gold ribbon across the top reads "PRACTICE DEMO — sample
  data only. Nothing you do here is saved or graded."

## Running it

```bash
npm run dev:demo      # local dev against the mock data
npm run build:demo    # production demo build (mode=demo, see .env.demo)
npm run test:demo     # 24 assertions over the mock data layer
```

The switch is `VITE_DEMO_MODE=true` in `.env.demo`, read by `src/supabase.js`.
A normal `npm run build` is unaffected and still talks to the real project.

## What students can do

Log in — credentials are prefilled, they just press **Log in**:

| Role | Credentials |
|---|---|
| Student | prefilled (`juan.delacruz@demo.local` / `2026-1-0001`) |
| Instructor | any email and password |

Then they can walk the whole interface: the Summary tab, three lessons with
markdown, formulas and a table, a 5-question seatwork, a 6-question practice
exam, and a scheduled seatwork that is not open yet so they can see what that
looks like. The instructor login shows the dashboard side.

## Deploying

This branch is `demo`. Point a separate Vercel project at it with build command
`npm run build:demo`, or push the branch and use the preview deployment.

**Do not merge `demo` into `main`** — main must keep talking to the real
project. The only shared file is `src/supabase.js`, which is written so both
modes work from the same code.
