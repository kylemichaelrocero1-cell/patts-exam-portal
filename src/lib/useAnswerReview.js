import { useState } from 'react';
import { fetchAnswerReview } from './answerReview';

// Opening a marked paper from a student's home tabs — the Summary's results
// table and the exam lists' "Ready to review" — so both say the same thing
// when the server refuses.
//
// The only route to a correct answer, and it is the server's decision:
// get_answer_review() refuses unless the paper has show_answers on AND this
// student has already submitted it. So a stale page that still shows the
// button after the instructor closes review again fails here, not silently.
export function useAnswerReview(studentId) {
  // The marked paper, once the student asks for it: { title, rows }.
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(null);   // exam_id being fetched

  const open = async (examId, title) => {
    setBusy(examId);
    const { data: rows, error } = await fetchAnswerReview(studentId, examId);
    setBusy(null);
    if (error) {
      alert(/not available/i.test(error.message)
        ? 'Your instructor has not opened the answers for this one.'
        : /session has expired/i.test(error.message)
          ? 'Your session has expired. Please log in again.'
          : 'Could not load the answers. Please try again.');
      return;
    }
    setReview({ title, rows: rows || [] });
  };

  return { review, busy, open, close: () => setReview(null) };
}
