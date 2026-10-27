// What the Students tab's Delete buttons say before and after they run.
//
// A student is one account shared by every instructor who teaches them, so
// "delete" here means "take them out of my sections" — and since sql/104 it
// goes through the Trash: the database takes your sections off and files
// them (trash_students), and nothing is deleted until the entry has waited
// 30 days unrestored. Its outcomes:
//   trashed   — your sections came off and are in the Trash to restore
//   not_yours — none of their sections are this instructor's; untouched

export const TRASH_DAYS = 30;

/** The confirm text for removing `count` students (`name` when it is one). */
export function removalPrompt(count, name) {
  const who = count === 1 ? `"${name || 'this student'}"` : `${count} students`;
  return `Move ${who} to the Trash?\n\n` +
    'They come off your sections now. A student who is also in another ' +
    'instructor\'s section keeps their account and that instructor\'s results.\n\n' +
    `You can restore them from the Trash for ${TRASH_DAYS} days. After that, a student ` +
    'in no one else\'s section is deleted with their results on your papers.';
}

/** One line per outcome that happened, for the alert after the removal. */
export function removalSummary(rows) {
  const n = { trashed: 0, not_yours: 0 };
  (rows || []).forEach(r => { if (r && r.outcome in n) n[r.outcome]++; });
  const s = k => (n[k] === 1 ? '' : 's');
  const lines = [];
  if (n.trashed) lines.push(`${n.trashed} student${s('trashed')} moved to the Trash. Restore within ${TRASH_DAYS} days to put them back in your sections.`);
  if (n.not_yours) lines.push(`${n.not_yours} student${s('not_yours')} not in any of your sections — left as they were.`);
  if (lines.length === 0) lines.push('Nothing changed.');
  return lines.join('\n');
}

/** "Deleted for good in 12 days" — what a Trash row says about its clock. */
export function purgeLabel(purgeAfter, now = new Date()) {
  const ms = new Date(purgeAfter).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return '';
  const days = Math.ceil(ms / 86400000);
  if (days <= 0) return 'Deleted for good next time the Trash is emptied';
  if (days === 1) return 'Deleted for good tomorrow';
  return `Deleted for good in ${days} days`;
}
