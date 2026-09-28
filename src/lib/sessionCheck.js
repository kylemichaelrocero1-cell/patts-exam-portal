// Has this student's account been logged into somewhere else since this tab
// logged in? One session_token per student: a second login replaces it, and
// the exam screen that notices is expected to step aside.
//
// Asked of the database (sql/034) rather than read from it. The old check
// read users.session_token straight out of the table, which needed anon to be
// allowed to read every student's token — the hole that makes
// student_from_token() worthless as a proof of identity.
//
// No supabase import, so it can be tested in Node: the caller passes the
// client in.
import { isMissingFunctionError } from './assessmentsCore.js';

/**
 * true  — replaced: a different token is on file now.
 * false — still current, or nothing to compare (no token in this browser).
 * null  — could not tell (a network failure, a refusal). The caller must do
 *         NOTHING on null: "cannot tell" never throws a student out of an exam.
 */
export async function sessionReplaced(client, studentId, localToken) {
  if (!studentId || !localToken) return false;
  try {
    const { data, error } = await client.rpc('session_is_current', {
      p_student_id: studentId,
      p_session_token: localToken,
    });
    if (!error) return data === false;
    // Only a function that is not there at all earns the old read — never a
    // refusal or a dropped connection. REMOVE once sql/034 has run everywhere.
    if (!isMissingFunctionError(error)) return null;
    const r = await client.from('users').select('session_token').eq('id', studentId).maybeSingle();
    if (r.error || !r.data) return null;
    return !!r.data.session_token && r.data.session_token !== localToken;
  } catch {
    return null;
  }
}
