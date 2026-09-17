// Reading the violation trail: what the recent-violations bar shows, and which
// rows the instructor is allowed to dismiss.
//
//   npm run test:proctoring

import {
  clockToMs, parseViolation, violationFeed, hasSavedWork, canDismissSession,
} from '../proctoring.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// 18 Sep 2026, 15:40:00 local — the anchor every clock string is read against.
const NOW = new Date(2026, 8, 18, 15, 40, 0).getTime();
const hhmm = (ms) => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

console.log('=== clockToMs ===');
{
  check('12-hour with seconds', hhmm(clockToMs('3:35:12 PM', NOW)) === '15:35');
  check('12-hour morning', hhmm(clockToMs('9:05:00 AM', NOW)) === '9:05');
  check('midnight reads as 00:xx, not noon', hhmm(clockToMs('12:15:00 AM', NOW)) === '0:15');
  check('noon stays noon', hhmm(clockToMs('12:15:00 PM', NOW)) === '12:15');
  check('24-hour locales work too', hhmm(clockToMs('15:35:12', NOW)) === '15:35');
  check('no seconds is fine', hhmm(clockToMs('3:35 PM', NOW)) === '15:35');
  // Chrome's newer ICU puts U+202F before the meridiem, not a plain space.
  check('a narrow no-break space before PM still parses',
    hhmm(clockToMs('3:35:12 PM', NOW)) === '15:35');
  check('junk returns null', clockToMs('sometime', NOW) === null);
  check('empty returns null', clockToMs('', NOW) === null);
  check('an impossible time returns null', clockToMs('25:00:00', NOW) === null);
}
{
  // A sitting that ran across midnight: 11:50 PM read at 00:10 the next day.
  const justAfterMidnight = new Date(2026, 8, 19, 0, 10, 0).getTime();
  const at = clockToMs('11:50:00 PM', justAfterMidnight);
  check('a stamp from before midnight lands yesterday, not tomorrow',
    at < justAfterMidnight && justAfterMidnight - at < 60 * 60 * 1000,
    new Date(at).toString());
}

console.log('\n=== parseViolation ===');
{
  const v = parseViolation('[3:35:12 PM] Tab hidden or switched to another app', NOW);
  check('the stamp comes off the front', v.stamp === '3:35:12 PM');
  check('the sentence is kept whole', v.reason === 'Tab hidden or switched to another app');
  check('and it is typed as a tab switch', v.label === 'Tab switch' && v.tone === 'bad');

  check('a refresh is its own type',
    parseViolation('[3:35:12 PM] Page refreshed', NOW).label === 'Page refresh');
  check('lost focus is its own type',
    parseViolation('[3:35:12 PM] Screen lost focus (Split-screen or notifications opened)', NOW)
      .label === 'Lost focus');
  check('a screenshot attempt is its own type',
    parseViolation('[3:35:12 PM] Screenshot or Print shortcut attempted', NOW)
      .label === 'Screenshot / print');

  const unknown = parseViolation('[3:35:12 PM] Something new we have not seen', NOW);
  check('an unrecognised sentence still shows, labelled generically',
    unknown.label === 'Flagged activity' && unknown.reason === 'Something new we have not seen');

  const bare = parseViolation('no stamp here', NOW);
  check('a line with no stamp keeps its text and has no moment',
    bare.reason === 'no stamp here' && bare.stamp === '' && bare.at === null);
  check('null does not throw', parseViolation(null, NOW).reason === '');
}

console.log('\n=== violationFeed ===');
{
  const sessions = [
    { id: 's1', student_id: 'u1', student_name: 'Ana', exam_id: 'e1',
      updated_at: new Date(NOW).toISOString(),
      violation_log: ['[3:10:00 PM] Tab hidden or switched to another app',
                      '[3:38:00 PM] Page refreshed'] },
    { id: 's2', student_id: 'u2', student_name: 'Ben', exam_id: 'e1',
      updated_at: new Date(NOW).toISOString(),
      violation_log: ['[3:20:00 PM] Screenshot or Print shortcut attempted'] },
    { id: 's3', student_id: 'u3', student_name: 'Cleo', exam_id: 'e1',
      updated_at: new Date(NOW).toISOString(), violation_log: [] },
  ];
  const feed = violationFeed(sessions, { now: NOW, limit: 10 });
  check('one row per incident, clean sessions left out', feed.length === 3);
  check('newest first, across students',
    feed.map(r => r.studentName).join(',') === 'Ana,Ben,Ana', feed.map(r => r.stamp).join(','));
  check('each row names its student', feed[0].studentName === 'Ana');
  check('each row carries its type', feed[0].label === 'Page refresh');
  check('keys are unique', new Set(feed.map(r => r.key)).size === 3);

  check('the limit caps the bar', violationFeed(sessions, { now: NOW, limit: 2 }).length === 2);
  check('limit 0 means everything', violationFeed(sessions, { now: NOW, limit: 0 }).length === 3);
  check('no sessions is an empty feed', violationFeed([], { now: NOW }).length === 0);
  check('undefined does not throw', violationFeed(undefined, { now: NOW }).length === 0);
}
{
  // Unstamped lines fall back to when the row was last written, so a session
  // touched a moment ago still floats above one touched an hour ago.
  const older = new Date(NOW - 60 * 60 * 1000).toISOString();
  const sessions = [
    { id: 's1', student_name: 'Stale', updated_at: older, violation_log: ['no stamp'] },
    { id: 's2', student_name: 'Fresh', updated_at: new Date(NOW).toISOString(),
      violation_log: ['also no stamp'] },
  ];
  const feed = violationFeed(sessions, { now: NOW, limit: 10 });
  check('unparseable stamps order by when the row was last written',
    feed[0].studentName === 'Fresh');
  check('a nameless row still reads as something',
    violationFeed([{ id: 'x', violation_log: ['[3:00:00 PM] Page refreshed'] }],
      { now: NOW })[0].studentName === 'Unknown student');
  check('a non-array log is ignored, not crashed on',
    violationFeed([{ id: 'x', violation_log: 'oops' }], { now: NOW }).length === 0);
}

console.log('\n=== hasSavedWork / canDismissSession ===');
{
  const empty   = { id: 's1', answers_json: {}, essay_answers_json: {} };
  const working = { id: 's2', answers_json: { q1: 2 }, essay_answers_json: {} };
  const essayOnly = { id: 's3', answers_json: {}, essay_answers_json: { q9: 'a paragraph' } };

  check('nothing answered is no work', hasSavedWork(empty) === false);
  check('a multiple-choice answer is work', hasSavedWork(working) === true);
  check('an essay on its own is work too', hasSavedWork(essayOnly) === true);
  check('a row with no columns at all does not throw', hasSavedWork({}) === false);

  check('an abandoned sitting can be dismissed', canDismissSession(empty) === true);
  check('THE BUG: a student mid-exam cannot be dismissed away',
    canDismissSession(working) === false);
  check('nor one who has only written an essay',
    canDismissSession(essayOnly) === false);
  check('a ghost row whose paper is already on file can always be cleared',
    canDismissSession(working, { hasResult: true }) === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
