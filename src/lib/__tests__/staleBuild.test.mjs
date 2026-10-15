// A page from before a deploy reloads itself onto the new build, once, and
// that reload is not counted as the student refreshing.
//
//   npm run test:stale-build

import { isStaleBuildError, reloadForUpdate, isUpdateReload, LOOP_MS, OWN_RELOAD_MS } from '../staleBuild.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)) }; };

for (const [msg, why] of [
  ['Failed to fetch dynamically imported module: https://x/assets/WorkedSolution-abc.js', 'Chrome'],
  ['Importing a module script failed.', 'Safari'],
  ['error loading dynamically imported module: https://x/assets/a.js', 'Firefox'],
  ['Unable to preload CSS for /assets/a.css', 'a stylesheet'],
]) check(`a stale file: ${why}`, isStaleBuildError(new Error(msg)));
check('a ChunkLoadError by name', isStaleBuildError(Object.assign(new Error('x'), { name: 'ChunkLoadError' })));
for (const e of [new TypeError("Cannot read properties of undefined (reading 'map')"), null, undefined, new Error('permission denied')])
  check(`not a stale file: ${e?.message ?? e}`, !isStaleBuildError(e));

{
  const s = store(); let reloads = 0; const reload = () => reloads++;
  check('the first failure reloads', reloadForUpdate({ storage: s, reload, now: 1000 }) === true && reloads === 1);
  check('a second one straight after does not (no loop)', reloadForUpdate({ storage: s, reload, now: 1000 + LOOP_MS - 1 }) === false && reloads === 1);
  check('…but one later does', reloadForUpdate({ storage: s, reload, now: 1000 + LOOP_MS + 1 }) === true && reloads === 2);
}
{
  const s = store();
  check('no reload: an unload is the student\'s', isUpdateReload({ storage: s, now: 5000 }) === false);
  reloadForUpdate({ storage: s, reload: () => {}, now: 10000 });
  check('the unload right after reloadForUpdate is ours', isUpdateReload({ storage: s, now: 10000 + 50 }) === true);
  check('a refresh a little later is the student\'s again', isUpdateReload({ storage: s, now: 10000 + OWN_RELOAD_MS + 1 }) === false);
}
{
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  let reloads = 0;
  check('storage blocked: still reloads', reloadForUpdate({ storage: blocked, reload: () => reloads++, now: 1 }) === true && reloads === 1);
  check('storage blocked: an unload is the student\'s', isUpdateReload({ storage: blocked }) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
