// The exam screen's second-login check. A wrong "replaced" throws a student
// out of an exam mid-sitting, so the cases that must NOT do that get as much
// attention as the one that must.
//
//   npm run test:session-check

import { sessionReplaced } from '../sessionCheck.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// A fake client: rpc() answers with `rpc`, and a direct read of users
// answers with `row`. Every request is counted.
function fake({ rpc, row, readThrows = false }) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => { calls.push(`rpc:${name}`); if (rpc instanceof Error) throw rpc; return { ...rpc, args }; },
    from: (table) => {
      const b = {
        select: () => b, eq: () => b,
        maybeSingle: async () => { calls.push(`read:${table}`); if (readThrows) throw new Error('offline'); return row; },
      };
      return b;
    },
  };
}
const MISSING = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.session_is_current' } };

console.log('=== the database answers ===');
{
  const c = fake({ rpc: { data: true, error: null } });
  check('current: not replaced', (await sessionReplaced(c, 's1', 'tok-a')) === false);
  check('in ONE request, and never a read of the table', c.calls.join() === 'rpc:session_is_current', c.calls.join());
}
check('false from the database: replaced',
  (await sessionReplaced(fake({ rpc: { data: false, error: null } }), 's1', 'tok-a')) === true);

console.log('\n=== cannot tell: do nothing ===');
{
  const c = fake({ rpc: { data: null, error: { message: 'TypeError: Failed to fetch' } } });
  check('a dropped connection is null, not replaced', (await sessionReplaced(c, 's1', 'tok-a')) === null);
  check('and does NOT fall back to reading tokens', !c.calls.includes('read:users'), c.calls.join());
}
check('a refusal is null too',
  (await sessionReplaced(fake({ rpc: { data: null, error: { code: '42501', message: 'permission denied' } } }), 's1', 'tok-a')) === null);
check('a thrown error is null',
  (await sessionReplaced(fake({ rpc: new Error('boom') }), 's1', 'tok-a')) === null);
check('an answer that is not a boolean is not "replaced"',
  (await sessionReplaced(fake({ rpc: { data: null, error: null } }), 's1', 'tok-a')) === false);
{
  const c = fake({ rpc: { data: false, error: null } });
  check('no token in this browser: nothing to compare, and nothing asked',
    (await sessionReplaced(c, 's1', null)) === false && c.calls.length === 0);
}
check('no student: nothing asked', (await sessionReplaced(fake({ rpc: { data: false, error: null } }), null, 'tok-a')) === false);

console.log('\n=== before sql/034 has run: the old read ===');
{
  const c = fake({ rpc: MISSING, row: { data: { session_token: 'tok-a' }, error: null } });
  check('same token on file: not replaced', (await sessionReplaced(c, 's1', 'tok-a')) === false);
  check('asked first, then read', c.calls.join() === 'rpc:session_is_current,read:users', c.calls.join());
}
check('another token on file: replaced',
  (await sessionReplaced(fake({ rpc: MISSING, row: { data: { session_token: 'tok-B' }, error: null } }), 's1', 'tok-a')) === true);
check('no token on file: not replaced',
  (await sessionReplaced(fake({ rpc: MISSING, row: { data: { session_token: null }, error: null } }), 's1', 'tok-a')) === false);
check('no row: cannot tell',
  (await sessionReplaced(fake({ rpc: MISSING, row: { data: null, error: null } }), 's1', 'tok-a')) === null);
check('the read failing: cannot tell',
  (await sessionReplaced(fake({ rpc: MISSING, row: { data: null, error: { message: 'x' } } }), 's1', 'tok-a')) === null
  && (await sessionReplaced(fake({ rpc: MISSING, readThrows: true }), 's1', 'tok-a')) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
