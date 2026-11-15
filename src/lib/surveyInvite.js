// Who sees the Survey tab. The board exam survey is for graduates, not for
// everyone in the portal, so the tab shows only:
//   * in a browser tab opened from the survey link (…/?survey), which the
//     faculty post in the graduates' classrooms; or
//   * to a student who has opened the survey on this device before.
// The link's ?survey is noted before anything renders and taken off the
// address, so a reload or a shared screenshot doesn't carry it on.
import { SURVEY_ID, SURVEY_PARAM } from './boardSurveyId.js';

const INVITED = 'patts_board_survey_invited';   // sessionStorage: this browser tab
const OPEN_ONCE = 'patts_board_survey_open';    // sessionStorage: land on the tab, once
const seenKey = studentId => `patts_board_survey_${SURVEY_ID}_seen_${studentId}`;

/** Note the survey link, if this page was opened from it. Call once, before render. */
export function noteSurveyInvite() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SURVEY_PARAM)) return;
    sessionStorage.setItem(INVITED, SURVEY_ID);
    sessionStorage.setItem(OPEN_ONCE, SURVEY_ID);
    url.searchParams.delete(SURVEY_PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  } catch { /* private mode or no history: the tab just won't show */ }
}

/** Should this student see the Survey tab? */
export function showSurveyTab(studentId) {
  try {
    return sessionStorage.getItem(INVITED) === SURVEY_ID || localStorage.getItem(seenKey(studentId)) === '1';
  } catch { return false; }
}

/** True the first time it is asked after the link was opened: start on the Survey tab. */
export function takeSurveyLanding() {
  try {
    const yes = sessionStorage.getItem(OPEN_ONCE) === SURVEY_ID;
    sessionStorage.removeItem(OPEN_ONCE);
    return yes;
  } catch { return false; }
}

/** Remember that this student has the survey, so the tab stays without the link. */
export function markSurveySeen(studentId) {
  try { localStorage.setItem(seenKey(studentId), '1'); } catch { /* private mode */ }
}
