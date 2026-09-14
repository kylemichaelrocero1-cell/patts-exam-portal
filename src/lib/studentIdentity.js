// Deciding which existing student a roster CSV row refers to.
//
// `users.student_email` is UNIQUE. `users.student_code` — the PATTS Student ID
// — is NOT: two students genuinely share one (sql/014). That makes the ID a
// credential, half of a login pair, rather than an identifier.
//
// The import used to keep a Map of code -> student, which with a shared ID
// silently holds whichever row came back last and hides the other; a CSV row
// with an unrecognised email would then be merged into that arbitrary winner,
// quietly adding a section to the wrong person's record. So:
//
//   * email is believed first, always;
//   * a Student ID identifies only when exactly ONE student carries it;
//   * where an ID is shared it is ignored, and an unknown email is a new
//     student rather than a guess between the sharers.

export function makeRosterIndex(existing) {
  const byEmail = new Map();
  const byCode = new Map();
  for (const u of existing || []) {
    if (u.student_email) byEmail.set(u.student_email, u);
    if (u.student_code) {
      if (!byCode.has(u.student_code)) byCode.set(u.student_code, []);
      byCode.get(u.student_code).push(u);
    }
  }
  return {
    byEmail,
    byCode,
    /** Everyone carrying this Student ID. */
    holdersOf: (code) => byCode.get(code) || [],
    /** The student carrying this ID, but only when they are the only one. */
    soleHolderOf: (code) => {
      const held = byCode.get(code) || [];
      return held.length === 1 ? held[0] : null;
    },
  };
}

/**
 * Which existing student, if any, a CSV row refers to.
 *
 * @returns {{ match: object|null, conflict: boolean }}
 *   conflict — the email names one student and the ID unambiguously names
 *   another. That is a typo in the file, not a student in two sections, and
 *   writing either would corrupt a roster row, so the caller must skip it.
 */
export function resolveStudent(row, index) {
  const byE = row.student_email ? index.byEmail.get(row.student_email) || null : null;
  const byC = row.student_code ? index.soleHolderOf(row.student_code) : null;
  if (byE && byC && byE.id !== byC.id) return { match: null, conflict: true };
  return { match: byE || byC, conflict: false };
}
