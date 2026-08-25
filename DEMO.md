# Student Demo Build

A practice copy of the portal for students to navigate before a review or exam.
It runs on sample data.

## Running it

```bash
npm run dev:demo      # local dev
npm run build:demo    # demo build (mode=demo, see .env.demo)
npm run test:demo     # tests for the demo data layer
```

The switch is `VITE_DEMO_MODE=true` in `.env.demo`. A normal `npm run build` is
unaffected.

## Signing in

Credentials are prefilled — press **Log in**.

| Role | Credentials |
|---|---|
| Student | prefilled |
| Instructor | any email and password |

## What students can walk through

The Summary tab, three lessons, a short seatwork, a practice exam, and a
scheduled seatwork that has not opened yet. Nothing is saved or graded.

## Deploying

This branch is `demo`. Point a Vercel project at it — `vercel.json` pins the
build command.

**Do not merge `demo` into `main`.**
