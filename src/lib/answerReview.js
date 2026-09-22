import { supabase } from '../supabase';
import { isMissingFunctionError } from './assessmentsCore';

// The single client-side route to a marked paper, shared by the Summary tab
// and the score screen so the staged migration is handled once rather than
// twice — and so neither can drift into calling the unguarded form.
//
// get_answer_review() used to take p_student_id on trust: pass a classmate's
// id and you got their answers, plus the correct answer to every item on a
// paper you may never have sat. sql/022 adds a form that proves the caller
// with users.session_token; sql/023 removes the one that does not.
//
// Between those two migrations both forms exist, which is the point — a
// browser still running the previous build keeps working. The fallback fires
// ONLY when the four-argument form is absent, never when it refuses.
// REMOVE THE FALLBACK once 022 and 023 have both run.
export async function fetchAnswerReview(studentId, assessmentId, attemptNo = null) {
  const guarded = await supabase.rpc('get_answer_review', {
    p_student_id: studentId,
    p_assessment_id: assessmentId,
    p_attempt_no: attemptNo,
    p_session_token: localStorage.getItem('local_session_token'),
  });
  if (!guarded.error || !isMissingFunctionError(guarded.error)) return guarded;

  return supabase.rpc('get_answer_review', {
    p_student_id: studentId,
    p_assessment_id: assessmentId,
    p_attempt_no: attemptNo,
  });
}
