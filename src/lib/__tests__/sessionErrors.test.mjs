// A stale session and a dead network need different advice, and the app used to
// give the same wrong answer to both: "check your connection". A student whose
// token no longer matches can retype a correct password all day and never get
// in — the only cure is logging in again, so the message has to say so.
//
//   npm run test:session-errors

import { isSessionExpiredError, isNetworkError, gateErrorMessage } from '../sessionErrors.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('=== a stale session ===');
check('recognised by SQLSTATE', isSessionExpiredError({ code: '28000', message: 'whatever' }));
check('and by wording alone, because PostgREST does not always pass the code through',
  isSessionExpiredError({ message: 'Your session has expired. Please log in again.' }));
check('the wording match is case-insensitive',
  isSessionExpiredError({ message: 'YOUR SESSION HAS EXPIRED' }));
check('it can arrive in hint or details',
  isSessionExpiredError({ hint: 'session has expired' })
  && isSessionExpiredError({ details: 'please log in again' }));
check('this is the real shape the live database returns',
  isSessionExpiredError({ code: '28000', message: 'Your session has expired. Please log in again.' }));

console.log('\n=== and things that are NOT one ===');
check('a wrong password is not a stale session',
  !isSessionExpiredError({ code: '42501', message: 'Enter the exam password first.' }));
check('nor is a section mismatch',
  !isSessionExpiredError({ code: '42501', message: 'This assessment is not for your section.' }));
check('nor a closed paper',
  !isSessionExpiredError({ code: '42501', message: 'This assessment is not open.' }));
check('nor a missing paper',
  !isSessionExpiredError({ code: '42704', message: 'That assessment no longer exists.' }));
check('nothing at all is not an error', !isSessionExpiredError(null) && !isSessionExpiredError(undefined));

console.log('\n=== a real network failure ===');
check('the browser wording for a dead connection', isNetworkError({ message: 'Failed to fetch' }));
check('and Safari\'s different wording', isNetworkError({ message: 'Load failed' }));
check('a Postgres error is NEVER dressed up as a network one',
  !isNetworkError({ code: '28000', message: 'Your session has expired. Please log in again.' })
  && !isNetworkError({ code: '42501', message: 'Enter the exam password first.' }));
check('and the word "connection" inside a database message does not count',
  !isNetworkError({ message: 'too many connections for role' }));

console.log('\n=== what a student is told ===');
check('a stale session is told to log in again, and why',
  /logged in on another device/.test(gateErrorMessage({ code: '28000' }))
  && /log in again/i.test(gateErrorMessage({ code: '28000' })));
check('and is NOT told to check the connection — the old bug, pinned',
  !/connection|internet/i.test(gateErrorMessage({ code: '28000' })),
  gateErrorMessage({ code: '28000' }));
check('a dead network IS told to check the connection',
  /internet/i.test(gateErrorMessage({ message: 'Failed to fetch' })));
check('anything else gets an honest shrug that still offers the way out',
  /log in again/i.test(gateErrorMessage({ code: 'XX000', message: 'boom' })));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
