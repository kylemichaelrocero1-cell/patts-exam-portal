// A page opened before a deploy, asking for a file of the build it came
// from. Vercel serves only the current build, so the previous build's
// files are gone (404): the first time such a page needs a piece it has not
// loaded yet — a maths item, the maths keyboard, the Summary tab — the
// import fails. With nothing to catch it React drops the whole tree and the
// screen goes blank; a refresh "fixes" it because it fetches the new build.
//
// So the page reloads itself, once, onto the new build. Everything a
// student has typed is already on the device (ExamBoard writes it to
// localStorage on every change), so a reload loses nothing; and ExamBoard
// does not count this reload as the student refreshing (isUpdateReload).

const RELOAD_AT = 'patts-update-reload-at';
// A second failure this soon after reloading for one is not a stale page:
// the new build is broken or the network is down. Don't loop.
export const LOOP_MS = 30000;
// How long after reloadForUpdate() the unload it causes counts as ours.
export const OWN_RELOAD_MS = 5000;

/** Did this error come from fetching a file of a build that is gone? */
export function isStaleBuildError(err) {
  if (!err) return false;
  if (err.name === 'ChunkLoadError') return true;
  const m = String(err.message ?? err);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Expected the result of a dynamic import|Failed to load module script/i.test(m);
}

/**
 * Reload onto the new build, unless this tab already did so in the last
 * LOOP_MS. Returns true when the reload is under way.
 */
export function reloadForUpdate({ storage = globalThis.sessionStorage, reload = () => globalThis.location.reload(), now = Date.now() } = {}) {
  let last = 0;
  try { last = Number(storage.getItem(RELOAD_AT)) || 0; } catch { /* storage blocked */ }
  if (last && now - last < LOOP_MS) return false;
  try { storage.setItem(RELOAD_AT, String(now)); } catch { /* storage blocked */ }
  reload();
  return true;
}

/** Is the page unloading because reloadForUpdate() just reloaded it? */
export function isUpdateReload({ storage = globalThis.sessionStorage, now = Date.now() } = {}) {
  try {
    const last = Number(storage.getItem(RELOAD_AT)) || 0;
    return last > 0 && now - last < OWN_RELOAD_MS;
  } catch { return false; }
}
