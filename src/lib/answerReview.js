import { supabase } from '../supabase';

// The single client-side route to a marked paper, shared by the Summary tab
// and the score screen, so neither can drift into calling it differently.
//
// get_answer_review() used to take p_student_id on trust: pass a classmate's
// id and you got their answers, plus the correct answer to every item on a
// paper you may never have sat. sql/022 added the form that proves the caller
// with users.session_token, and sql/023 removed the one that did not — so this
// form is the only one there is.
export async function fetchAnswerReview(studentId, assessmentId, attemptNo = null) {
  return supabase.rpc('get_answer_review', {
    p_student_id: studentId,
    p_assessment_id: assessmentId,
    p_attempt_no: attemptNo,
    p_session_token: localStorage.getItem('local_session_token'),
  });
}
