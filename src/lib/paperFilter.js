// The Results tab's paper picker. It used to list every paper the
// instructor has ever made — assignments and practice papers that never
// write a row here, last term's prelims, everything — in one flat list of
// thirty. Now: a course first, then only the papers with results in this
// tab, newest first, and archived papers only when asked for. Archiving a
// paper in Manage Exams is how an old one leaves the list.

// The course code in a title: "MATH 117 Quiz 2 — …", "Prelim AENG 427",
// "ESCI316 Midterm". A title without one is "Other".
export function courseOf(title) {
  const m = /(?:^|[^A-Za-z])([A-Z]{2,5})\s?-?(\d{3}[A-Z]?)(?![0-9])/.exec(String(title || ''));
  return m ? `${m[1]} ${m[2]}` : 'Other';
}

const byCourse = (a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b);

/**
 * What the picker offers.
 *   titles  — paper id → title (examsDict)
 *   meta    — paper id → { created_at, archived_at }, where known
 *   counts  — paper id → how many result rows it has in this tab
 *   course  — 'All' or a course code
 *   showArchived — include archived papers
 *   keep    — a paper id to keep listed whatever it is (the one selected),
 *             so the picker never shows a selection it has no option for
 * Returns { courses, groups: [{ course, papers: [{ id, title, count, archived }] }],
 *           hiddenArchived } — hiddenArchived counts archived papers with
 * results that are left out, for the "Include archived (n)" box.
 */
export function paperOptions({ titles = {}, meta = {}, counts = {}, course = 'All', showArchived = false, keep = null } = {}) {
  const all = Object.entries(titles)
    .filter(([id]) => (counts[id] || 0) > 0 || id === keep)
    .map(([id, title]) => ({
      id, title: title || 'Untitled', count: counts[id] || 0,
      archived: Boolean(meta[id]?.archived_at), created: meta[id]?.created_at || '',
      course: courseOf(title),
    }));
  const hiddenArchived = all.filter(p => p.archived && !showArchived && p.id !== keep).length;
  const shown = all.filter(p => showArchived || !p.archived || p.id === keep);
  const courses = [...new Set(shown.map(p => p.course))].sort(byCourse);
  const groups = new Map();
  shown.filter(p => course === 'All' || p.course === course || p.id === keep)
    // Newest first; a paper with no date (a shared one) after the dated.
    .sort((a, b) => (b.created > a.created) - (b.created < a.created) || a.title.localeCompare(b.title))
    .forEach(p => {
      if (!groups.has(p.course)) groups.set(p.course, []);
      groups.get(p.course).push({ id: p.id, title: p.title, count: p.count, archived: p.archived });
    });
  return {
    courses,
    groups: [...groups.keys()].sort(byCourse).map(c => ({ course: c, papers: groups.get(c) })),
    hiddenArchived,
  };
}

/** Does a result row pass the course and archived filters? */
export function resultInView(examId, { titles = {}, meta = {}, course = 'All', showArchived = false } = {}) {
  if (!showArchived && meta[examId]?.archived_at) return false;
  return course === 'All' || courseOf(titles[examId]) === course;
}
