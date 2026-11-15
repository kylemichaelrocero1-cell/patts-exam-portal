// Which board exam survey is running. Apart from the questions
// (src/lib/boardSurvey.js) so the portal's first load, which notes the survey
// link, doesn't carry every topic list with it.
//
// To run the survey again after the next board exam, change SURVEY_ID and
// SURVEY_LABEL; old answers stay under their own id.
export const SURVEY_ID = 'nov2026';
export const SURVEY_LABEL = 'November 2026';
/** ?survey on the portal's address opens the Survey tab after login. */
export const SURVEY_PARAM = 'survey';
