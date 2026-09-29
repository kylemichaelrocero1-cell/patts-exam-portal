// The copy the student home tabs share. The point of it is fewer requests, so
// requests are what is counted — but a copy that goes stale when it must not
// (a paper just sat, a lesson just finished) would be worse than the traffic,
// so the ways a copy ends get as much attention as the ways it is kept.
//
//   npm run test:student-home

import { makeHomeReads, HOME_MAX_AGE_MS } from '../studentHomeCore.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// A fake PostgREST: every builder records its chain, and — like the real one —
// sends its request each time .then is called on it. `sent` counts requests.
function fakeDb(answer = () => ({ data: [], error: null })) {
  const sent = [];
  const from = (table) => {
    const chain = [];
    const b = {
      then(resolve, reject) {
        sent.push({ table, chain: chain.join(' ') });
        return Promise.resolve(answer(table, chain)).then(resolve, reject);
      },
    };
    for (const m of ['select', 'eq', 'in', 'order']) {
      b[m] = (...args) => { chain.push(`${m}(${JSON.stringify(args)})`); return b; };
    }
    return b;
  };
  return { from, sent };
}

function setup({ answer, open } = {}) {
  const db = fakeDb(answer);
  let clock = 1_000_000;
  let openCalls = 0;
  const reads = makeHomeReads({
    from: db.from,
    selectOpenAssessments: async () => { openCalls++; return open ? open() : [{ id: 'a1' }]; },
    now: () => clock,
  });
  return { reads, db, tick: (ms) => { clock += ms; }, openCalls: () => openCalls };
}

console.log('=== one copy, shared ===');
{
  const { reads, db } = setup();
  const r1 = await reads.results('s1');
  const r2 = await reads.results('s1');
  check('a second tab reading the same rows sends nothing', db.sent.length === 1, `${db.sent.length} requests`);
  check('and gets the same answer', r1 === r2);
}
{
  const { reads, db } = setup();
  const [a, b] = await Promise.all([reads.attempts('s1'), reads.attempts('s1')]);
  check('two reads at once are one request (never the builder handed out twice)', db.sent.length === 1, `${db.sent.length} requests`);
  check('both get the rows', Array.isArray(a.data) && a === b);
}
{
  const { reads, db } = setup();
  await reads.results('s1');
  await reads.results('s2');
  check('another student is another copy', db.sent.length === 2);
}
{
  const { reads, openCalls } = setup();
  await reads.openAssessments();
  const o = await reads.openAssessments();
  check('open papers: read once', openCalls() === 1);
  check('open papers come back as { data, error }', o.data?.[0]?.id === 'a1' && o.error === null);
}

console.log('\n=== when a copy ends ===');
{
  const { reads, db, tick } = setup();
  await reads.liveSittings('s1');
  tick(HOME_MAX_AGE_MS - 1);
  await reads.liveSittings('s1');
  check('still good just inside the age limit', db.sent.length === 1);
  tick(1);
  await reads.liveSittings('s1');
  check('asked again once it is a minute old', db.sent.length === 2, `${db.sent.length} requests`);
}
{
  const { reads, db } = setup();
  await reads.results('s1');
  await reads.results('s1', { fresh: true });
  check('fresh: goes past the copy', db.sent.length === 2);
  await reads.results('s1');
  check('and replaces it for everyone after', db.sent.length === 2);
}
{
  const { reads, db } = setup();
  await reads.results('s1'); await reads.attempts('s1'); await reads.openAssessments();
  reads.forget();
  await reads.results('s1'); await reads.attempts('s1');
  check('forget(): back from a paper, everything is read again', db.sent.length === 4, `${db.sent.length} requests`);
}
{
  const { reads, db } = setup();
  await reads.lessonProgress('s1'); await reads.results('s1');
  reads.forget('lesson-progress:s1');
  await reads.lessonProgress('s1'); await reads.results('s1');
  check('forget(key): only that copy goes', db.sent.length === 3, db.sent.map(s => s.table).join());
}

console.log('\n=== a failure is never kept ===');
{
  let n = 0;
  const { reads, db } = setup({ answer: () => (++n === 1 ? { data: null, error: { message: 'Failed to fetch' } } : { data: [{ exam_id: 'e1' }], error: null }) });
  const bad = await reads.results('s1');
  check('the error reaches the tab', bad.error?.message === 'Failed to fetch');
  const good = await reads.results('s1');
  check('and the next tab asks again', db.sent.length === 2 && good.data?.[0]?.exam_id === 'e1');
}
{
  let n = 0;
  const { reads, openCalls } = setup({ open: () => { if (++n === 1) throw new Error('offline'); return [{ id: 'a2' }]; } });
  const bad = await reads.openAssessments();
  check('a thrown read resolves as { error }, never rejects', bad.data === null && bad.error?.message === 'offline');
  const good = await reads.openAssessments();
  check('and is not kept', openCalls() === 2 && good.data?.[0]?.id === 'a2');
}

console.log('\n=== once per arrival ===');
{
  const { reads } = setup();
  check('first claim', reads.claim('recovery-scan:s1') === true);
  check('second claim refused', reads.claim('recovery-scan:s1') === false);
  check('another student claims their own', reads.claim('recovery-scan:s2') === true);
  reads.forget('results:s1');
  check('forgetting one copy does not reset claims', reads.claim('recovery-scan:s1') === false);
  reads.forget();
  check('forget() does: back from a paper, the scan runs again', reads.claim('recovery-scan:s1') === true);
}

console.log('\n=== what is asked for ===');
{
  const { reads, db } = setup();
  await reads.results('s1'); await reads.attempts('s1'); await reads.liveSittings('s1');
  await reads.lessons(); await reads.lessonProgress('s1');
  const q = Object.fromEntries(db.sent.map(s => [s.table, s.chain]));
  check('results: this student, with the score columns the Summary shows',
    /eq\(\["student_id","s1"\]\)/.test(q.results) && /exam_id/.test(q.results) && /work_total/.test(q.results) && /points_earned/.test(q.results), q.results);
  check('attempts: newest first, for the exam list',
    /order\(\["attempt_no",\{"ascending":false\}\]\)/.test(q.review_attempts) && /eq\(\["student_id","s1"\]\)/.test(q.review_attempts), q.review_attempts);
  check('live sittings: only the ones still under way',
    /in\(\["status",\["active","locked"\]\]\)/.test(q.live_sessions) && /exam_set/.test(q.live_sessions), q.live_sessions);
  check('lessons: published only', /eq\(\["is_published",true\]\)/.test(q.lessons), q.lessons);
  check('lesson progress: this student', /eq\(\["student_id","s1"\]\)/.test(q.lesson_progress), q.lesson_progress);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
