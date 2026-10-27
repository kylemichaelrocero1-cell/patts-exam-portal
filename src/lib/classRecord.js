// A class record, built from what the dashboard already holds, for
// src/lib/xlsx.js to write: one sheet per section, a student a row, a paper a
// column in points, grouped as a class record is (quizzes, seatworks,
// assignments, exams), each group subtotalled, then the total and the
// percentage — as formulas, so the instructor can weight or edit freely.
//
// Every score goes through combinedScore() (src/lib/workedShape.js): a
// paper's points are its picked items and its worked marks together. A
// blank cell is "not submitted", never a zero; a yellow one still has marks
// to give. A paper with retakes on uses the best or the latest attempt.
import { combinedScore } from './workedShape.js';
import { colName } from './xlsx.js';

export const GROUPS = ['Quizzes', 'Seatworks', 'Assignments', 'Exams', 'Practice & review', 'Other'];

/** Which column group a paper belongs in, from its kind and title. */
export function groupOf(paper) {
  const t = String(paper?.title || '');
  if (paper?.kind === 'seatwork' || /\bseat\s?work\b/i.test(t)) return 'Seatworks';
  if (/\bassignment\b/i.test(t)) return 'Assignments';
  if (/\bquiz(zes)?\b/i.test(t)) return 'Quizzes';
  if (/\b(prelim|midterm|semi-?final|final)s?\b/i.test(t) || /\bexamination\b/i.test(t)) return 'Exams';
  if (/\b(review|practice|mock|retake)\b/i.test(t)) return 'Practice & review';
  return 'Other';
}

/** A column heading: the title without its course code or subtitle. */
export function shortTitle(title) {
  const t = String(title || 'Untitled').split(/\s+[—–]\s+|\s+-\s+/)[0]
    .replace(/(?:^|\s)[A-Z]{2,5}\s?-?\d{3}[A-Z]?(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  return t || String(title || 'Untitled');
}

const inSection = (list, section) => String(list || '').split(',').map(s => s.trim()).includes(section);
const fraction = m => (m && m.total > 0 && m.pending === 0 ? m.score / m.total : null);

/** The sitting that counts for each student and paper: student → paper → row. */
export function countedSittings({ results = [], practiceAttempts = [], retakes = 'best' }) {
  const out = new Map();
  const put = (sid, pid, row) => {
    if (!out.has(sid)) out.set(sid, new Map());
    out.get(sid).set(pid, row);
  };
  const grouped = new Map();
  practiceAttempts.forEach(a => {
    const k = `${a.student_id}|${a.assessment_id}`;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(a);
  });
  grouped.forEach(list => {
    const pick = list.reduce((best, a) => {
      if (!best) return a;
      if (retakes === 'latest') return a.attempt_no > best.attempt_no ? a : best;
      const fa = fraction(combinedScore(a)), fb = fraction(combinedScore(best));
      if ((fa ?? -1) !== (fb ?? -1)) return (fa ?? -1) > (fb ?? -1) ? a : best;
      return a.attempt_no > best.attempt_no ? a : best;
    }, null);
    put(pick.student_id, pick.assessment_id, { ...pick, attempts: list.length });
  });
  // A graded result wins if a paper somehow has both.
  results.forEach(r => put(r.student_id, r.exam_id, { ...r, attempts: 1 }));
  return out;
}

/**
 * The sheets for these sections: [classSheet per section…, papersSheet].
 * Students are { id or student_id, full_name, section }; papers are the
 * instructor's assessments ({ id, title, kind, target_section, created_at,
 * archived_at }).
 */
export function classRecordSheets({ sections, students = [], papers = [], results = [], practiceAttempts = [],
  retakes = 'best', includeArchived = false, exportedAt = new Date() }) {
  const sittings = countedSittings({ results, practiceAttempts, retakes });
  const when = exportedAt.toISOString().slice(0, 16).replace('T', ' ');
  const listed = [];
  const sheets = sections.map(section => {
    const roster = students.filter(s => inSection(s.section, section))
      .map(s => ({ id: s.student_id ?? s.id, name: s.full_name || s.name || 'Unknown' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // The section's papers with at least one sitting from its students.
    const cols = papers
      .filter(p => inSection(p.target_section, section) && (includeArchived || !p.archived_at))
      .map(p => {
        // A paper's points: the most any sitting of it is out of.
        const sat = roster.filter(st => sittings.get(st.id)?.has(p.id));
        return { ...p, group: groupOf(p), sat: sat.length,
          points: Math.max(0, ...sat.map(st => combinedScore(sittings.get(st.id).get(p.id)).total)) };
      })
      .filter(p => p.sat > 0)
      .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.title.localeCompare(b.title));
    cols.forEach(p => { if (!listed.some(x => x.id === p.id)) listed.push(p); });

    const FIRST = 5;                          // the first student's row (1-based)
    const groups = GROUPS.filter(g => cols.some(p => p.group === g));
    const paperCol = i => 2 + i;              // 0-based column of paper i
    const afterPapers = 2 + cols.length;
    const subCol = gi => afterPapers + gi;
    const totalCol = afterPapers + groups.length;
    const outOf = cols.reduce((n, p) => n + p.points, 0);

    const title = [{ v: `Class record — ${section}`, style: 'title' }];
    const note = [{ v: `Exported ${when}. Each paper in points; blank = not submitted; yellow = marks still to give. Papers with retakes: ${retakes === 'latest' ? 'latest' : 'best'} attempt.`, style: 'note' }];
    const groupRow = [null, null];
    cols.forEach((p, i) => { if (i === 0 || cols[i - 1].group !== p.group) groupRow[paperCol(i)] = { v: p.group, style: 'bold' }; });
    groups.forEach((g, gi) => { groupRow[subCol(gi)] = { v: 'Subtotals', style: 'bold' }; });
    const head = [{ v: 'No.', style: 'header' }, { v: 'Student', style: 'header' },
      ...cols.map(p => ({ v: `${shortTitle(p.title)} (${p.points})`, style: 'header' })),
      ...groups.map(g => ({ v: `${g} (${cols.filter(p => p.group === g).reduce((n, p) => n + p.points, 0)})`, style: 'header' })),
      { v: 'Total', style: 'header' }, { v: 'Out of', style: 'header' }, { v: '%', style: 'header' }, { v: `Submitted (of ${cols.length})`, style: 'header' }];

    const body = roster.map((st, k) => {
      const r = FIRST + k;
      const mine = sittings.get(st.id) || new Map();
      const row = [k + 1, st.name];
      let total = 0, submitted = 0;
      const sums = groups.map(() => 0);
      cols.forEach((p, i) => {
        const s = mine.get(p.id);
        if (!s) { row[paperCol(i)] = null; return; }
        const m = combinedScore(s);
        submitted++;
        total += m.score;
        sums[groups.indexOf(p.group)] += m.score;
        row[paperCol(i)] = { v: m.score, style: m.pending > 0 ? 'pending' : 'number' };
      });
      groups.forEach((g, gi) => {
        const idx = cols.map((p, i) => (p.group === g ? paperCol(i) : -1)).filter(i => i >= 0);
        row[subCol(gi)] = { v: sums[gi], f: `SUM(${colName(idx[0])}${r}:${colName(idx[idx.length - 1])}${r})`, style: 'number' };
      });
      row[totalCol] = cols.length
        ? { v: total, f: `SUM(${colName(paperCol(0))}${r}:${colName(paperCol(cols.length - 1))}${r})`, style: 'bold' }
        : { v: 0, style: 'bold' };
      row[totalCol + 1] = outOf;
      row[totalCol + 2] = { v: outOf > 0 ? total / outOf : null, f: `IF(${colName(totalCol + 1)}${r}>0,${colName(totalCol)}${r}/${colName(totalCol + 1)}${r},"")`, style: 'percent' };
      row[totalCol + 3] = submitted;
      return row;
    });
    return {
      name: section,
      rows: [title, note, groupRow, head, ...body],
      widths: [5, 30, ...cols.map(() => 12), ...groups.map(() => 13), 9, 8, 8, 12],
      freeze: { row: 4, col: 2 },
    };
  });

  const papersSheet = {
    name: 'Papers',
    rows: [
      [{ v: 'The papers in this class record', style: 'title' }],
      [{ v: 'Column headings are shortened; the full titles are here.', style: 'note' }],
      [],
      ['Column', 'Group', 'Full title', 'Points', 'Created', 'Archived'].map(v => ({ v, style: 'header' })),
      ...listed.map(p => [`${shortTitle(p.title)} (${p.points})`, p.group, p.title, p.points,
        String(p.created_at || '').slice(0, 10), p.archived_at ? 'yes' : '']),
    ],
    widths: [24, 16, 70, 8, 12, 9],
    freeze: { row: 4, col: 0 },
  };
  return [...sheets, papersSheet];
}
