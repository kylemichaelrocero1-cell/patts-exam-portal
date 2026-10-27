// The class record export: the right sitting in the right column, blanks
// for nothing submitted, subtotals and totals as formulas with their values,
// and an .xlsx a spreadsheet program opens (checked with openpyxl when it is
// installed). Look-alike names and papers only.
//
//   npm run test:class-record

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classRecordSheets, groupOf, shortTitle, countedSittings } from '../classRecord.js';
import { workbookBytes, colName, sheetName } from '../xlsx.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('=== pieces ===');
check('column names', colName(0) === 'A' && colName(25) === 'Z' && colName(26) === 'AA' && colName(701) === 'ZZ' && colName(702) === 'AAA');
{
  const t = new Set();
  const a = sheetName('MATH 117 -2A', t), b = sheetName('math 117 -2a', t), c = sheetName('A/B:C*D?[E]', t), d = sheetName('x'.repeat(40), t);
  check('sheet names: unique, legal, 31 characters at most', a === 'MATH 117 -2A' && b === 'math 117 -2a 2' && c === 'A-B-C-D--E-' && d.length === 31, JSON.stringify([a, b, c, d]));
}
for (const [t, g] of [['TEST 101 Quiz 2 — Limits', 'Quizzes'], ['TEST 101 Assignment 3 — Rates', 'Assignments'], ['TEST 101 Midterm Examination', 'Exams'],
  ['Prelim TEST 202', 'Exams'], ['TEST 101 Midterm Quiz 1 — Queues', 'Quizzes'], ['TEST 101 Seatwork 2', 'Seatworks'], ['TEST 101 Review', 'Practice & review'],
  ['TEST 101 RETAKE', 'Practice & review'], ['Practice Exam', 'Practice & review'], ['Orientation', 'Other']])
  check(`group of ${JSON.stringify(t)} is ${g}`, groupOf({ title: t }) === g, groupOf({ title: t }));
check('a seatwork by kind', groupOf({ title: 'Activity 1', kind: 'seatwork' }) === 'Seatworks');
for (const [t, s] of [['TEST 101 Quiz 2 — Limits and Continuity', 'Quiz 2'], ['Prelim TEST 202', 'Prelim'], ['TEST 101 Midterm Examination', 'Midterm Examination'], ['Practice Exam', 'Practice Exam'], ['TEST 101', 'TEST 101']])
  check(`short title of ${JSON.stringify(t)}`, shortTitle(t) === s, shortTitle(t));

// ── a look-alike class ───────────────────────────────────────────────────
const papers = [
  { id: 'q1', title: 'TEST 101 Quiz 1 — Limits', kind: 'exam', target_section: 'T-1A, T-1B', created_at: '2026-09-01' },
  { id: 'q2', title: 'TEST 101 Quiz 2 — Rates', kind: 'exam', target_section: 'T-1A', created_at: '2026-09-20' },
  { id: 'as', title: 'TEST 101 Assignment 1', kind: 'exam', target_section: 'T-1A', created_at: '2026-09-10', allow_retakes: true },
  { id: 'mid', title: 'TEST 101 Midterm Examination', kind: 'exam', target_section: 'T-1A', created_at: '2026-10-01' },
  { id: 'old', title: 'TEST 101 Prelim Examination', kind: 'exam', target_section: 'T-1A', created_at: '2026-08-01', archived_at: '2026-09-01' },
  { id: 'none', title: 'TEST 101 Quiz 3', kind: 'exam', target_section: 'T-1A', created_at: '2026-10-20' },
];
const students = [
  { id: 's2', full_name: 'Zamora, Ana', section: 'T-1A' },
  { id: 's1', full_name: 'Abad, Ben', section: 'OTHER-9, T-1A' },
  { id: 's3', full_name: 'Cruz, Carla', section: 'T-1B' },
];
const results = [
  { student_id: 's1', exam_id: 'q1', score: 8, total_items: 10 },
  { student_id: 's2', exam_id: 'q1', score: 6, total_items: 10 },
  { student_id: 's1', exam_id: 'q2', score: 4, total_items: 5, points_earned: 12, points_total: 15 },
  // Worked items not yet marked: pending.
  { student_id: 's2', exam_id: 'mid', score: 10, total_items: 10, points_earned: 10, points_total: 10, work_marks: null, work_total: 20 },
  { student_id: 's1', exam_id: 'mid', score: 9, total_items: 10, points_earned: 9, points_total: 10, work_marks: 15, work_total: 20 },
  { student_id: 's1', exam_id: 'old', score: 30, total_items: 50 },
  { student_id: 's3', exam_id: 'q1', score: 9, total_items: 10 },
];
const practiceAttempts = [
  { student_id: 's1', assessment_id: 'as', attempt_no: 1, score: 0, total_items: 0, work_marks: 18, work_total: 20 },
  { student_id: 's1', assessment_id: 'as', attempt_no: 2, score: 0, total_items: 0, work_marks: 12, work_total: 20 },
];

console.log('\n=== which sitting counts ===');
{
  const best = countedSittings({ results, practiceAttempts, retakes: 'best' }).get('s1').get('as');
  const latest = countedSittings({ results, practiceAttempts, retakes: 'latest' }).get('s1').get('as');
  check('best attempt: 18 (attempt 1), of 2', best.work_marks === 18 && best.attempts === 2);
  check('latest attempt: 12 (attempt 2)', latest.work_marks === 12);
}

const exportedAt = new Date('2026-10-27T10:00:00Z');
const sheets = classRecordSheets({ sections: ['T-1A', 'T-1B'], students, papers, results, practiceAttempts, exportedAt });
const [a, b, list] = sheets;
const head = a.rows[3].map(c => c?.v);
console.log('\n=== the T-1A sheet ===');
check('a sheet per section, then the papers', sheets.length === 3 && a.name === 'T-1A' && b.name === 'T-1B' && list.name === 'Papers');
check('columns: quizzes, assignments, exams; archived prelim and unsat Quiz 3 left out',
  JSON.stringify(head.slice(2, 6)) === JSON.stringify(['Quiz 1 (10)', 'Quiz 2 (15)', 'Assignment 1 (20)', 'Midterm Examination (30)']), JSON.stringify(head));
check('subtotals per group, then total, out of, %, submitted',
  JSON.stringify(head.slice(6)) === JSON.stringify(['Quizzes (25)', 'Assignments (20)', 'Exams (30)', 'Total', 'Out of', '%', 'Submitted (of 4)']), JSON.stringify(head.slice(6)));
check('the group labels sit above their first column', a.rows[2][2]?.v === 'Quizzes' && a.rows[2][3] == null && a.rows[2][4]?.v === 'Assignments' && a.rows[2][5]?.v === 'Exams');
const ben = a.rows[4], ana = a.rows[5];
check('students alphabetical, numbered', ben[0] === 1 && ben[1] === 'Abad, Ben' && ana[1] === 'Zamora, Ana');
check('points, not counts: Quiz 2 is 12 of 15', ben[3].v === 12);
check('Ben: assignment best 18, midterm 24', ben[4].v === 18 && ben[5].v === 24);
check('Ana: Quiz 2 and the assignment blank (not submitted), not 0', ana[3] == null && ana[4] == null);
check('Ana\'s midterm is marked pending, worth the 10 so far', ana[5].style === 'pending' && ana[5].v === 10);
check('Ben\'s subtotals, with formulas', ben[6].v === 20 && ben[6].f === 'SUM(C5:D5)' && ben[7].v === 18 && ben[7].f === 'SUM(E5:E5)' && ben[8].v === 24);
check('Ben\'s total 62 of 75, as a formula, and 82.7%', ben[9].v === 62 && ben[9].f === 'SUM(C5:F5)' && ben[10] === 75
  && Math.abs(ben[11].v - 62 / 75) < 1e-12 && ben[11].f === 'IF(K5>0,J5/K5,"")', JSON.stringify(ben.slice(9)));
check('submitted counts', ben[12] === 4 && ana[12] === 2);
check('frozen at the names and headings', a.freeze.row === 4 && a.freeze.col === 2);
check('only the section\'s students: Carla is on T-1B', a.rows.length === 6 && b.rows.length === 5 && b.rows[4][1] === 'Cruz, Carla');
check('T-1B has only the paper aimed at it', b.rows[3].map(c => c?.v).slice(2, 3)[0] === 'Quiz 1 (10)');
check('the papers sheet has full titles once each', list.rows.slice(4).map(r => r[2]).join('|') === papers.slice(0, 4).sort((x, y) => ['q1', 'q2', 'as', 'mid'].indexOf(x.id) - ['q1', 'q2', 'as', 'mid'].indexOf(y.id)).map(p => p.title).join('|'));
{
  const withOld = classRecordSheets({ sections: ['T-1A'], students, papers, results, practiceAttempts, includeArchived: true, exportedAt });
  check('archived papers come in when asked', withOld[0].rows[3].some(c => c?.v === 'Prelim Examination (50)'));
  const latest = classRecordSheets({ sections: ['T-1A'], students, papers, results, practiceAttempts, retakes: 'latest', exportedAt });
  check('latest attempt when asked', latest[0].rows[4][4].v === 12 && /latest attempt/.test(latest[0].rows[1][0].v));
  const empty = classRecordSheets({ sections: ['T-9'], students, papers, results, practiceAttempts, exportedAt });
  check('a section with nothing makes a sheet, not an error', empty[0].rows.length === 4);
}

console.log('\n=== the file ===');
const bytes = workbookBytes({ sheets });
check('a ZIP', bytes[0] === 0x50 && bytes[1] === 0x4b && bytes.length > 2000);
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'classrecord-')), 'record.xlsx');
fs.writeFileSync(file, bytes);
const PY = `
import sys, json, openpyxl
f = sys.argv[1]
wb = openpyxl.load_workbook(f)
vals = openpyxl.load_workbook(f, data_only=True)
a, av = wb['T-1A'], vals['T-1A']
print(json.dumps({
  'sheets': wb.sheetnames, 'title': a['A1'].value, 'head': [c.value for c in a[4]],
  'ben': [c.value for c in a[5]], 'ben_cached': [c.value for c in av[5]],
  'freeze': a.freeze_panes, 'fill': a['F6'].fill.fgColor.rgb, 'pct_fmt': a['L5'].number_format,
  'papers': [c.value for c in wb['Papers'][5]],
}))`;
let py = null;
try { py = JSON.parse(execFileSync('python3', ['-E', '-c', PY, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
catch (e) { console.log(`  SKIP  openpyxl check (${String(e.stderr || e.message).split('\n').filter(Boolean).pop()})`); }
if (py) {
  check('opens: sheets named', JSON.stringify(py.sheets) === JSON.stringify(['T-1A', 'T-1B', 'Papers']), JSON.stringify(py.sheets));
  check('opens: the title and headings', py.title === 'Class record — T-1A' && py.head[3] === 'Quiz 2 (15)');
  check('opens: Ben\'s formulas', py.ben[9] === '=SUM(C5:F5)' && py.ben[11] === '=IF(K5>0,J5/K5,"")', JSON.stringify(py.ben));
  check('opens: their values cached for viewers that do not calculate', py.ben_cached[9] === 62 && Math.abs(py.ben_cached[11] - 62 / 75) < 1e-9, JSON.stringify(py.ben_cached));
  check('opens: frozen at C5, pending cell filled, % formatted', py.freeze === 'C5' && py.fill === 'FFFFF2CC' && py.pct_fmt === '0.0%',
    JSON.stringify([py.freeze, py.fill, py.pct_fmt]));
  check('opens: the papers sheet', py.papers[2] === 'TEST 101 Quiz 1 — Limits', JSON.stringify(py.papers));
}
{
  const odd = workbookBytes({ sheets: [{ name: 'x', rows: [['a & b < c > "d"', 'bad\u0001char', { v: 1, f: 'A1<2' }]] }] });
  const f2 = path.join(path.dirname(file), 'odd.xlsx');
  fs.writeFileSync(f2, odd);
  if (py) {
    const out = JSON.parse(execFileSync('python3', ['-E', '-c', `import sys,json,openpyxl
ws=openpyxl.load_workbook(sys.argv[1]).active
print(json.dumps([ws['A1'].value, ws['B1'].value, ws['C1'].value]))`, f2], { encoding: 'utf8' }));
    check('names with & < > " and control characters survive', JSON.stringify(out) === JSON.stringify(['a & b < c > "d"', 'badchar', '=A1<2']), JSON.stringify(out));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
