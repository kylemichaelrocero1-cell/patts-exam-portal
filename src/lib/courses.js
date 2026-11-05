// The courses a student can be on, as the class records write them. Mirrors
// the list in sql/143 (npm run test:student-course checks they agree).

export const COURSES = [
  { code: 'BSAE', name: 'BS Aeronautical Engineering' },
  { code: "PRE-ENG'G", name: 'Pre-Engineering' },
  { code: 'BSAMT', name: 'BS Aircraft Maintenance Technology' },
  { code: 'BSAvTech', name: 'BS Avionics Technology' },
  { code: 'BSAirTrans', name: 'BS Air Transportation' },
  { code: 'BSIE', name: 'BS Industrial Engineering' },
  { code: 'BSTM', name: 'BS Tourism Management' },
  { code: 'BSABA', name: 'BS Airline Business Administration' },
  { code: 'ATC', name: 'Aircraft Technician Course' },
];

// These read a paper's grade_base_ae (sql/145). Everyone else reads its grade_base.
const ENGINEERING = new Set(['BSAE', "PRE-ENG'G"]);

export function isEngineeringCourse(course) {
  return ENGINEERING.has(course);
}

const squash = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const SPELLINGS = new Map(COURSES.flatMap(c => [[squash(c.code), c.code], [squash(c.name), c.code]]));
SPELLINGS.set('preeng', "PRE-ENG'G");
SPELLINGS.set('aeroeng', 'BSAE');
SPELLINGS.set('bsaeroe', 'BSAE');
SPELLINGS.set('bsat', 'BSAirTrans');

/** The course's code from however a file spells it, or null if it is not a course on the list. */
export function courseCode(text) {
  return SPELLINGS.get(squash(text)) ?? null;
}
