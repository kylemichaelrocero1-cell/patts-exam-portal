// Splitting a student's sections into the slice one instructor may see and
// edit, and the slice that belongs to everybody else.
//
// A row in public.users carries EVERY section the student is in, as one
// comma-separated string: a student can sit in "Esci 316 -2" here and in
// "AENG 223L" with a colleague. Two things follow, and the dashboard used to
// get both wrong:
//
//   * an instructor must only be SHOWN their own slice. Expanding the whole
//     string into the roster, the filters or the section pickers leaks
//     colleagues' section names into an account that has no business with them.
//   * an instructor must only OVERWRITE their own slice. The editor shows that
//     slice, so writing the edited value straight back would drop every section
//     the student holds elsewhere — silently un-enrolling them from another
//     instructor's class.
//
// mergeSections is the second half of that contract: whatever the instructor
// did to their slice, the rest is carried over untouched.

/** "a, b ,, c" -> ["a","b","c"] */
export function splitSections(str) {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean);
}

/** The sections in `str` that `held` contains, in their original order. */
export function mySectionsOf(str, held) {
  const has = asSet(held);
  return splitSections(str).filter(s => has.has(s));
}

/** The sections in `str` that `held` does NOT contain — a colleague's classes. */
export function otherSectionsOf(str, held) {
  const has = asSet(held);
  return splitSections(str).filter(s => !has.has(s));
}

/**
 * The value to write back to users.section.
 *
 * @param editedMine  what the instructor left in the editor (their slice only)
 * @param original    the student's full section string as it is in the database
 * @param held        the sections this instructor holds
 *
 * The guarantee is one-directional, and deliberately so: sections the
 * instructor does not hold are never DROPPED, but whatever they put in the
 * editor is always kept. It is tempting to also discard anything they typed
 * that is not already in `held` — that would be wrong, because SectionPicker
 * offers "Create new section", and a brand-new name is by definition not held
 * yet (claimSections only records it after this write). Filtering it out here
 * would make creating a section from the roster look like it saved and do
 * nothing at all.
 */
export function mergeSections(editedMine, original, held) {
  const keep = otherSectionsOf(original, asSet(held));
  return dedupe([...splitSections(editedMine), ...keep]).join(', ');
}

function asSet(held) {
  return held instanceof Set ? held : new Set(held || []);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(s => (seen.has(s) ? false : (seen.add(s), true)));
}
