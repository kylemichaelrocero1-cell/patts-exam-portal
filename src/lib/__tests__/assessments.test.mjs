// Verifies the transitional exams/assessments fallback and the availability
// rules. The availability half is cross-checked against the REAL SQL function
// (public.assessment_is_available) executing in PGlite, because client and
// server must agree — the server decides what a student may fetch, the client
// decides what they are shown, and drift means a student sees a locked exam or
// misses an open one.
//
//   npm run test:assessments

import { PGlite } from '@electric-sql/pglite';
import {
  makeAssessmentReader, isAvailableNow, availabilityState,
  normaliseExamRow, isMissingTableError, formatWindow,
} from '../assessmentsCore.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── fake supabase query builder ─────────────────────────────────────────
const missing = (t) => ({
  message: `Could not find the table 'public.${t}' in the schema cache`,
});
function makeFrom(existing, log) {
  return (table) => {
    const b = {
      select() { return b; },
      eq() { return b; },
      order() { return b; },
      then(res) {
        log.push(table);
        return Promise.resolve(
          existing.has(table)
            ? { data: [{ id: `${table}-1`, title: 'T', is_open: true }], error: null }
            : { data: null, error: missing(table) }
        ).then(res);
      },
    };
    return b;
  };
}

console.log('\n=== FALLBACK ===');
{
  const log = [];
  const r = makeAssessmentReader(makeFrom(new Set(['assessments', 'exams']), log));
  const rows = await r.select();
  check('reads assessments when present', log[0] === 'assessments' && rows.length === 1);
  check('reports table available', r.available() === true);
  check('does not touch exams', !log.includes('exams'), log.join(','));
}
{
  const log = [];
  const r = makeAssessmentReader(makeFrom(new Set(['exams']), log));
  const rows = await r.select();
  check('falls back to exams when assessments missing',
    log[0] === 'assessments' && log[1] === 'exams' && rows.length === 1);
  check('reports table unavailable', r.available() === false);
  check('fallback rows normalised to kind=exam',
    rows[0].kind === 'exam' && rows[0].opens_at === null && rows[0].closes_at === null);

  log.length = 0;
  await r.select();
  check('probe is remembered — no repeat attempt on assessments',
    !log.includes('assessments'), log.join(','));
}
{
  // a real failure (permissions, network) must surface, not be swallowed as
  // "table missing" and silently downgrade every student to the old table
  const from = () => ({
    select() { return this; },
    then(res) { return Promise.resolve({ data: null, error: { message: 'permission denied for table assessments' } }).then(res); },
  });
  const r = makeAssessmentReader(from);
  let threw = false;
  try { await r.select(); } catch { threw = true; }
  check('non-missing-table errors propagate', threw);
}
check('isMissingTableError matches PostgREST wording',
  isMissingTableError(missing('assessments')) === true);
check('isMissingTableError ignores unrelated errors',
  isMissingTableError({ message: 'permission denied' }) === false);
check('normaliseExamRow preserves original fields',
  normaliseExamRow({ id: 'x', title: 'Y' }).title === 'Y');

console.log('\n=== AVAILABILITY vs THE REAL SQL FUNCTION ===');
const db = new PGlite();
await db.exec(`
  CREATE OR REPLACE FUNCTION public.assessment_is_available(
    p_is_open boolean, p_opens_at timestamptz, p_closes_at timestamptz
  ) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT p_is_open
       AND (p_opens_at  IS NULL OR now() >= p_opens_at)
       AND (p_closes_at IS NULL OR now() <  p_closes_at);
  $$;`);

const H = 3600 * 1000;
const now = new Date();
const iso = (offsetMs) => new Date(now.getTime() + offsetMs).toISOString();

const cases = [
  ['open, no window',            true,  null,      null],
  ['closed, no window',          false, null,      null],
  ['open, window active',        true,  iso(-H),   iso(+H)],
  ['open, not yet started',      true,  iso(+H),   iso(+2 * H)],
  ['open, already ended',        true,  iso(-2 * H), iso(-H)],
  ['closed inside active window',false, iso(-H),   iso(+H)],
  ['open, only opens_at, passed',true,  iso(-H),   null],
  ['open, only opens_at, future',true,  iso(+H),   null],
  ['open, only closes_at, future',true, null,      iso(+H)],
  ['open, only closes_at, passed',true, null,      iso(-H)],
];

for (const [name, is_open, opens_at, closes_at] of cases) {
  const sql = (await db.query(
    'SELECT public.assessment_is_available($1,$2,$3) AS ok',
    [is_open, opens_at, closes_at]
  )).rows[0].ok;
  const js = isAvailableNow({ is_open, opens_at, closes_at }, now);
  check(`${name}: js=${js} sql=${sql}`, js === sql);
}

console.log('\n=== STATE LABELS ===');
check('closed -> closed',
  availabilityState({ is_open: false }, now) === 'closed');
check('future window -> scheduled',
  availabilityState({ is_open: true, opens_at: iso(+H) }, now) === 'scheduled');
check('past window -> expired',
  availabilityState({ is_open: true, closes_at: iso(-H) }, now) === 'expired');
check('active -> open',
  availabilityState({ is_open: true, opens_at: iso(-H), closes_at: iso(+H) }, now) === 'open');
check('closed beats scheduled (master switch wins)',
  availabilityState({ is_open: false, opens_at: iso(+H) }, now) === 'closed');

console.log('\n=== WINDOW FORMATTING ===');
check('no window -> empty string', formatWindow({}) === '');
check('both bounds joined', formatWindow({ opens_at: iso(0), closes_at: iso(H) }).includes('—'));
check('opens only', formatWindow({ opens_at: iso(0) }).startsWith('Opens'));
check('closes only', formatWindow({ closes_at: iso(0) }).startsWith('Closes'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
