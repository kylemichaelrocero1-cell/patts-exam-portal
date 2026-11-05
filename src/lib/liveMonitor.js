// The live monitor's section, filter and sort rules.
//
// A student's users.section holds every section they are in, across
// instructors (see sectionScope.js). The section that matters on the
// monitor is the one they are sitting THIS paper under: their sections that
// the paper is for. That is also the only slice this instructor may be shown,
// since the paper's sections are the paper's instructors' own.

import { splitSections } from './sectionScope.js';

/** The student's section(s) for this paper, e.g. "Aeng 427 -3B". '' when none match. */
export function sittingSection(studentSections, paperSections) {
  const paper = new Set(splitSections(paperSections));
  return splitSections(studentSections).filter(s => paper.has(s)).join(', ');
}

/** The distinct sections among these rows, sorted, for the filter. */
export function sectionOptions(rows) {
  return [...new Set(rows.map(r => r.section).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Rows that pass the filters. Each row carries { section, paperId, status,
 * name }; status is 'active' | 'locked' | 'timed_out' | 'waiting'.
 * An empty filter value lets everything through.
 */
export function filterLive(rows, { section = '', paper = '', status = '', query = '' } = {}) {
  const needle = query.trim().toLowerCase();
  return rows.filter(r =>
    (!section || splitSections(r.section).includes(section))
    && (!paper || r.paperId === paper)
    && (!status || r.status === status)
    && (!needle || (r.name || '').toLowerCase().includes(needle)));
}

/**
 * Compare two rows: by section then name, by name alone, or 'entered', first
 * into the paper first. A retake's restart moves the row's start time, so
 * enteredAt is when this sitting began. A row with no time goes last.
 */
export function compareLive(by) {
  const name = (a, b) => (a.name || '').localeCompare(b.name || '');
  if (by === 'entered') {
    const at = r => { const t = Date.parse(r.enteredAt); return Number.isNaN(t) ? Infinity : t; };
    return (a, b) => {
      const ta = at(a), tb = at(b);
      return (ta === tb ? 0 : ta < tb ? -1 : 1) || name(a, b);
    };
  }
  if (by !== 'section') return name;
  return (a, b) => {
    // Rows with no section go last rather than first.
    if (!a.section !== !b.section) return a.section ? -1 : 1;
    return (a.section || '').localeCompare(b.section || '', undefined, { numeric: true }) || name(a, b);
  };
}

/**
 * The check-in list's order (sql/115): 'name' A–Z, 'section' then A–Z, or
 * 'arrival', first to ask first. Ties fall back to who asked first, so two
 * students of the same name keep a stable order. Rows carry requestedAt.
 */
export function compareWaiting(by) {
  const arrival = (a, b) => (Date.parse(a.requestedAt) || 0) - (Date.parse(b.requestedAt) || 0);
  if (by === 'arrival') return (a, b) => arrival(a, b) || compareLive('name')(a, b);
  return (a, b) => compareLive(by)(a, b) || arrival(a, b);
}
