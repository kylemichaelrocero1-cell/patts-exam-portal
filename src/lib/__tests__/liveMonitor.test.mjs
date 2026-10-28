// The live monitor's section slice, filters and sort, and the waiting-screen
// states for letting students in (sql/115).
//   npm run test:live-monitor
import { sittingSection, sectionOptions, filterLive, compareLive, compareWaiting } from '../liveMonitor.js';
import { newEntryId, isWaitingNow, admissionView, waitedFor, WAITING_STALE_MS } from '../admission.js';

let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const J = JSON.stringify;

console.log('=== THE SECTION A STUDENT SITS A PAPER UNDER ===');
ck('the one the paper is for', sittingSection('Esci 316 -2, Aeng 427 -3B', 'Aeng 427 -3B, Aeng 427 -5B') === 'Aeng 427 -3B');
ck('a colleague\'s section is never shown', !sittingSection('AENG 223L, Aeng 427 -5B', 'Aeng 427 -3B, Aeng 427 -5B').includes('223L'));
ck('none in common: empty', sittingSection('AENG 223L', 'Aeng 427 -3B') === '');
ck('spaces and empty parts are tidied', sittingSection(' Aeng 427 -3B ,, ', 'Aeng 427 -3B') === 'Aeng 427 -3B');
ck('no sections at all: empty', sittingSection(null, 'Aeng 427 -3B') === '' && sittingSection('Aeng 427 -3B', null) === '');

const rows = [
  { name: 'Cruz, Ana', section: 'Aeng 427 -5B', paperId: 'p1', status: 'active' },
  { name: 'Bautista, Leo', section: 'Aeng 427 -3B', paperId: 'p1', status: 'locked' },
  { name: 'Abad, Mia', section: 'Aeng 427 -5B', paperId: 'p2', status: 'waiting' },
  { name: 'Dizon, Rey', section: '', paperId: 'p1', status: 'timed_out' },
  { name: 'Aquino, Jo', section: 'Aeng 427 -3B', paperId: 'p2', status: 'active' },
];

console.log('\n=== FILTERS ===');
ck('section options: distinct, sorted, no blanks', J(sectionOptions(rows)) === J(['Aeng 427 -3B', 'Aeng 427 -5B']));
ck('no filter: everyone', filterLive(rows).length === 5);
ck('by section', J(filterLive(rows, { section: 'Aeng 427 -3B' }).map(r => r.name)) === J(['Bautista, Leo', 'Aquino, Jo']));
ck('by paper', filterLive(rows, { paper: 'p2' }).length === 2);
ck('by status', J(filterLive(rows, { status: 'locked' }).map(r => r.name)) === J(['Bautista, Leo']));
ck('by name, any case, part of it', J(filterLive(rows, { query: '  CRU ' }).map(r => r.name)) === J(['Cruz, Ana']));
ck('filters combine', J(filterLive(rows, { section: 'Aeng 427 -5B', paper: 'p1' }).map(r => r.name)) === J(['Cruz, Ana']));
ck('a section filter matches a student in two of the paper\'s sections',
  filterLive([{ name: 'X', section: 'Aeng 427 -3B, Aeng 427 -5B' }], { section: 'Aeng 427 -5B' }).length === 1);
ck('nothing matches: empty, not an error', filterLive(rows, { query: 'zzz' }).length === 0);

console.log('\n=== SORT ===');
ck('by name', J([...rows].sort(compareLive('name')).map(r => r.name))
  === J(['Abad, Mia', 'Aquino, Jo', 'Bautista, Leo', 'Cruz, Ana', 'Dizon, Rey']));
ck('by section, then name; no section last', J([...rows].sort(compareLive('section')).map(r => r.name))
  === J(['Aquino, Jo', 'Bautista, Leo', 'Abad, Mia', 'Cruz, Ana', 'Dizon, Rey']));
ck('sections sort as numbers, not letters', J([{ section: 'S -10', name: 'a' }, { section: 'S -2', name: 'b' }].sort(compareLive('section')).map(r => r.section))
  === J(['S -2', 'S -10']));

console.log('\n=== ENTRIES AND THE WAITING SCREEN ===');
{
  const ids = new Set(Array.from({ length: 200 }, () => newEntryId()));
  ck('an entry id is a uuid, fresh every time', ids.size === 200 && [...ids].every(i => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(i)));
  const saved = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  const fb = newEntryId();
  Object.defineProperty(globalThis, 'crypto', { value: saved, configurable: true });
  ck('…and without crypto.randomUUID too (old phones)', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(fb), fb);
}
const now = Date.parse('2026-10-28T08:00:00Z');
ck('a request heard from just now is waiting', isWaitingNow({ status: 'waiting', seen_at: new Date(now - 10000).toISOString() }, now));
ck('one not heard from for a while is a closed tab', !isWaitingNow({ status: 'waiting', seen_at: new Date(now - WAITING_STALE_MS - 1000).toISOString() }, now));
ck('a decided request is not waiting', !isWaitingNow({ status: 'admitted', seen_at: new Date(now).toISOString() }, now));
ck('admitted and not_required enter the paper', admissionView('admitted').enter && admissionView('not_required').enter);
ck('denied, withdrawn and expired can ask again', ['denied', 'withdrawn', 'expired'].every(s => admissionView(s).again && !admissionView(s).enter));
ck('waiting tells the student to keep the screen open', /keep this screen open/i.test(admissionView('waiting').text));
ck('an unknown answer is shown as waiting, never as entering', !admissionView('surprise').enter);
ck('waited: seconds, then minutes', waitedFor(now - 42000, now) === '42 s' && waitedFor(now - 125000, now) === '2 min 05 s' && waitedFor(now + 5000, now) === '0 s');

{
  const waiting = [
    { name: 'Santos, Maria', section: 'Aeng 427 -5B', requestedAt: '2026-10-29T08:02:00Z' },
    { name: 'Abad, Leo', section: 'Aeng 427 -5B', requestedAt: '2026-10-29T08:05:00Z' },
    { name: 'Cruz, Ana', section: 'Aeng 427 -3B', requestedAt: '2026-10-29T08:01:00Z' },
    { name: 'Abad, Leo', section: 'Aeng 427 -3B', requestedAt: '2026-10-29T08:00:00Z' },
  ];
  const order = by => J([...waiting].sort(compareWaiting(by)).map(r => `${r.name} ${r.section.slice(-2)}`));
  ck('check-in A–Z, same name by who asked first', order('name') === J(['Abad, Leo 3B', 'Abad, Leo 5B', 'Cruz, Ana 3B', 'Santos, Maria 5B']), order('name'));
  ck('check-in by section, then A–Z', order('section') === J(['Abad, Leo 3B', 'Cruz, Ana 3B', 'Abad, Leo 5B', 'Santos, Maria 5B']), order('section'));
  ck('check-in first come, first shown', order('arrival') === J(['Abad, Leo 3B', 'Cruz, Ana 3B', 'Santos, Maria 5B', 'Abad, Leo 5B']), order('arrival'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
