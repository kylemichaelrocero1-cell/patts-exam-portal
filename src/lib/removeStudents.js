// What the Students tab's Delete buttons say before and after they run.
//
// A student is one account shared by every instructor who teaches them, so
// "delete" here means "take them out of my sections". The database decides
// what that leaves (sql/094 remove_students_from_my_sections):
//   section_removed — they are still in a colleague's section; nothing else changed
//   kept            — no section left, but they have a colleague's results, so
//                     the account stays for those
//   deleted         — nothing of anyone else's was left; the account is gone
//                     with its results on this instructor's papers
//   not_yours       — none of their sections are this instructor's; untouched

/** The confirm text for removing `count` students (`name` when it is one). */
export function removalPrompt(count, name) {
  const who = count === 1 ? `"${name || 'this student'}"` : `${count} students`;
  return `Remove ${who} from your sections?\n\n` +
    'A student who is also in another instructor\'s section keeps their account ' +
    'and that instructor\'s results; only your section comes off.\n\n' +
    'A student in none of anyone else\'s sections is deleted, with their ' +
    'results on your papers. That part cannot be undone.';
}

/** One line per outcome that happened, for the alert after the removal. */
export function removalSummary(rows) {
  const n = { section_removed: 0, kept: 0, deleted: 0, not_yours: 0 };
  (rows || []).forEach(r => { if (r && r.outcome in n) n[r.outcome]++; });
  const s = k => (n[k] === 1 ? '' : 's');
  const lines = [];
  if (n.section_removed) lines.push(`${n.section_removed} student${s('section_removed')} removed from your sections — still in another instructor's section, account and results kept.`);
  if (n.kept) lines.push(`${n.kept} student${s('kept')} removed from your sections — account kept for another instructor's results.`);
  if (n.deleted) lines.push(`${n.deleted} student${s('deleted')} deleted.`);
  if (n.not_yours) lines.push(`${n.not_yours} student${s('not_yours')} not in any of your sections — left as they were.`);
  if (lines.length === 0) lines.push('Nothing changed.');
  return lines.join('\n');
}
