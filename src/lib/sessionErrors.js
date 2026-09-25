// Telling "your session is stale" apart from "the network is down".
//
// Every login mints a fresh session_token, writes it to this browser's
// localStorage and overwrites the one column on the student's row. There is
// only ONE column, so a second login anywhere — a phone, another browser, a
// shared lab machine — silently invalidates the first device. That device then
// looks perfectly fine until it tries to pass a gate, at which point
// student_from_token() finds no match and the function raises 28000.
//
// The client used to funnel that into "Check your connection and try again",
// which is the worst possible advice: the connection is fine, the student
// retypes a password they already had right, and nothing changes. The only
// thing that fixes it is logging in again.
//
// 28000 is SQLSTATE invalid_authorization_specification, raised deliberately by
// unlock_assessment() and get_exam_questions() (sql/020). The message is
// matched as well as the code because PostgREST does not always surface a
// RAISE's SQLSTATE in `code` — it sometimes arrives only in the body.

const EXPIRED_CODE = '28000';
const EXPIRED_TEXT = /session has expired|log in again/i;

/** Is this the server saying the student's session no longer matches? */
export function isSessionExpiredError(err) {
  if (!err) return false;
  if (err.code === EXPIRED_CODE) return true;
  return EXPIRED_TEXT.test(String(err.message || err.hint || err.details || ''));
}

/**
 * Was this a genuine failure to reach the server? Deliberately narrow: only
 * the handful of wordings a fetch failure actually produces, so a Postgres
 * error is never dressed up as a network one.
 */
export function isNetworkError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return /failed to fetch|networkerror|network request failed|load failed|timeout|err_internet/.test(msg);
}

/** What to show a student when something went wrong at a gate. */
export function gateErrorMessage(err) {
  if (isSessionExpiredError(err)) {
    return 'You have been signed out — this usually means you logged in on another device or browser. Please log in again.';
  }
  if (isNetworkError(err)) {
    return 'Cannot reach the server. Check your internet and try again.';
  }
  return 'Something went wrong. Please try again, or log in again if it keeps happening.';
}
