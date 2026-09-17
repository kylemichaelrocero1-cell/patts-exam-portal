// Turning retakes on after a class has already sat the paper has to actually
// let them back in — that is the whole point of the switch.
//
//   npm run test:retakes

import { isPaperFinished, sittingDecision, restartPatch } from '../retakes.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const GRADED = { id: 'p1', allow_retakes: false };
const OPEN   = { id: 'p1', allow_retakes: true };

console.log('=== isPaperFinished ===');
{
  check('a graded paper already submitted is finished',
    isPaperFinished(GRADED, true) === true);
  check('a graded paper not yet submitted is not',
    isPaperFinished(GRADED, false) === false);
  check('THE BUG: retakes switched on re-opens a paper already submitted',
    isPaperFinished(OPEN, true) === false);
  check('retakes on, never submitted, still open',
    isPaperFinished(OPEN, false) === false);
  check('a paper loaded before the column existed is treated as graded',
    isPaperFinished({}, true) === true);
  check('and a missing assessment does not throw',
    isPaperFinished(undefined, true) === true);
}

console.log('\n=== sittingDecision ===');
{
  check('an active session is just continued',
    sittingDecision({ sessionStatus: 'active', hasGradedResult: true }) === 'continue');
  check('a locked session is continued too — the lock screen decides',
    sittingDecision({ sessionStatus: 'locked' }) === 'continue');

  check('finished + graded + no retakes = blocked',
    sittingDecision({ sessionStatus: 'finished', hasGradedResult: true }) === 'blocked');

  check('THE BUG: finished + graded + retakes on = a fresh sitting',
    sittingDecision({ sessionStatus: 'finished', hasGradedResult: true, allowRetakes: true })
      === 'restart');

  check('a practice paper sat before restarts on the next go',
    sittingDecision({ sessionStatus: 'finished', allowRetakes: true, hasPriorAttempt: true })
      === 'restart');

  check('finished with nothing on file is an instructor dismiss — reopen in place',
    sittingDecision({ sessionStatus: 'finished' }) === 'reopen');
  check('and reopening does not depend on the retake switch',
    sittingDecision({ sessionStatus: 'finished', allowRetakes: true }) === 'reopen');

  check('no arguments at all does not throw', sittingDecision() === 'continue');
}

console.log('\n=== restartPatch ===');
{
  const now = new Date('2026-09-18T04:30:00.000Z');
  const p = restartPatch(now);
  check('the clock starts again', p.created_at === now.toISOString());
  check('the sitting is active', p.status === 'active');
  check('last sitting\'s answers do not carry over',
    Object.keys(p.answers_json).length === 0 && Object.keys(p.essay_answers_json).length === 0);
  check('nor does its answered count', p.answers_count === 0);
  check('nor its violations', p.violation_count === 0 && p.violation_log.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
