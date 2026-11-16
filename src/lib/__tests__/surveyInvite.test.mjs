// The board exam survey link (src/lib/surveyInvite.js): who sees the Survey
// tab, and where opening the link lands them.
//   npm run test:survey-link
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const store = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() };
};
let href = 'https://portal.example/?survey';
globalThis.sessionStorage = store();
globalThis.localStorage = store();
globalThis.window = {
  get location() { return { href }; },
  history: { state: null, replaceState: (_s, _t, url) => { href = new URL(url, href).href; } },
};

const inv = await import('../surveyInvite.js');
const { SURVEY_ID } = await import('../boardSurveyId.js');
const ANA = '11111111-1111-1111-1111-111111111111', BEN = '22222222-2222-2222-2222-222222222222';

console.log('=== OPENED WITHOUT THE LINK ===');
href = 'https://portal.example/';
inv.noteSurveyInvite();
check('no Survey tab', !inv.showSurveyTab(ANA));
check('no banner at sign-in', !inv.cameFromSurveyLink());
check('no landing on it', !inv.surveyLandingPending() && !inv.takeSurveyLanding());

console.log('\n=== OPENED FROM THE LINK ===');
href = 'https://portal.example/?survey';
inv.noteSurveyInvite();
check('the address loses ?survey', href === 'https://portal.example/', href);
check('the sign-in page says it is for the survey', inv.cameFromSurveyLink());
check('the section picker can see the landing is still to come', inv.surveyLandingPending() && inv.surveyLandingPending());
check('the first screen to ask lands on the survey', inv.takeSurveyLanding());
check('only once', !inv.takeSurveyLanding() && !inv.surveyLandingPending());
check('the Survey tab shows for whoever signs in on this browser tab', inv.showSurveyTab(ANA) && inv.showSurveyTab(BEN));
check('even outside the sections the survey is kept to, so they are told who it is for',
  inv.showSurveyTab(BEN, { restricted: true, may_answer: false }));

console.log('\n=== LATER, WITHOUT THE LINK ===');
sessionStorage.clear();
inv.markSurveySeen(ANA);
check('a student who opened the survey here still has the tab', inv.showSurveyTab(ANA));
check('another student on the same device does not', !inv.showSurveyTab(BEN));
check('it is remembered per survey', localStorage.getItem(`patts_board_survey_${SURVEY_ID}_seen_${ANA}`) === '1');

console.log('\n=== KEPT TO CHOSEN SECTIONS (sql/150) ===');
const IN = { restricted: true, may_answer: true }, OUT = { restricted: true, may_answer: false };
const OPEN = { restricted: false, may_answer: true };
check('a student in a chosen section gets the tab without the link', inv.showSurveyTab(BEN, IN));
check('a student outside them does not, even if they opened it here before', !inv.showSurveyTab(ANA, OUT));
check('open to all: the tab follows the link and this device, as before',
  inv.showSurveyTab(ANA, OPEN) && !inv.showSurveyTab(BEN, OPEN));
check('until the database answers, or without 150, the same', inv.showSurveyTab(ANA, null) && !inv.showSurveyTab(BEN, null));

console.log('\n=== OTHER PARAMETERS STAY ===');
href = 'https://portal.example/?survey&x=1#top';
inv.noteSurveyInvite();
check('only ?survey is taken off', href === 'https://portal.example/?x=1#top', href);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
