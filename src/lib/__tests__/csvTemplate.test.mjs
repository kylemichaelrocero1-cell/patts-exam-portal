// The Download Template button hands instructors a file that is also the
// documentation — each row demonstrates one shape. So the template has to
// actually import, and keep importing as the parser changes.
//
// This reads the template straight out of AdminDashboard.jsx and puts it
// through the same rule parseQuestionCSV applies, so the two cannot drift.
// It already earned its keep: the first version shipped a "delete these rows"
// line that was itself an invalid question and would have shown up as an
// import error the first time anyone used it.
//
//   npm run test:csv-template

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexForLetter, keyIsValid } from '../choices.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── the template, as the button writes it ───────────────────────────────
const src = fs.readFileSync(path.join(REPO, 'src/AdminDashboard.jsx'), 'utf8');
const start = src.indexOf('const downloadCSVTemplate');
check('the template is still where this test looks for it', start !== -1);
const block = src.slice(start, src.indexOf("].join('\\n');", start));
const lines = [...block.matchAll(/^ {6}'(.*)',$/gm)].map(m => m[1].replace(/\\'/g, "'"));
check('it has a header and at least five worked examples', lines.length >= 6, `${lines.length} rows`);

// ── parseQuestionCSV's splitter and rule, reproduced ────────────────────
const split = (row) => {
  const cells = []; let cell = '', inQ = false;
  for (const ch of row) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { cells.push(cell.trim()); cell = ''; }
    else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
};
const parseRow = (cols) => {
  const qText = cols[0]?.trim();
  if (!qText) return { skip: true };
  if (!(cols[1]?.trim())) return { essay: true, qText };
  const t = [...cols];
  while (t.length && !(t[t.length - 1] ?? '').trim()) t.pop();
  const raw = (t[t.length - 1]?.trim() || '').toUpperCase();
  const list = t.slice(1, t.length - 1).map(v => (v ?? '').trim()).filter(Boolean);
  const key = /^\d+$/.test(raw) ? Number(raw) : indexForLetter(raw);
  return { qText, list, key, raw };
};

const rows = lines.map(split);

console.log('=== the header ===');
check('the first column is question_text',
  rows[0][0].toLowerCase().replace(/\s/g, '_') === 'question_text', rows[0][0]);
check('the last column is correct_answer',
  rows[0][rows[0].length - 1].toLowerCase().replace(/\s/g, '_') === 'correct_answer',
  rows[0][rows[0].length - 1]);
check('it offers at least seven choice columns, so "add more" is visibly true',
  rows[0].length - 2 >= 7, `${rows[0].length - 2} choice columns`);

console.log('\n=== every example row imports as labelled ===');
const parsed = rows.slice(1).map(parseRow).filter(r => !r.skip);
const widths = new Set();
for (const r of parsed) {
  const label = r.qText.split('—')[0].trim();
  if (r.essay) { check(`${label}: parses as an essay`, true); continue; }
  const ok = r.list.length >= 2 && r.key !== null && keyIsValid(r.key, r.list.length);
  widths.add(r.list.length);
  check(`${label}: ${r.list.length} choices, answer ${r.raw} -> "${r.list[r.key]}"`, ok,
    ok ? '' : `list=${r.list.length} key=${r.key}`);
}

console.log('\n=== it demonstrates the point ===');
check('there is an essay example', parsed.some(r => r.essay));
check('there is a four-choice example', widths.has(4));
check('there is an example with MORE than five choices — the whole point of 016',
  [...widths].some(w => w > 5), `widths: ${[...widths].sort().join(', ')}`);
check('there is an example with fewer than four, so the minimum is clear',
  [...widths].some(w => w < 4), `widths: ${[...widths].sort().join(', ')}`);
check('at least one example keys the answer by number rather than a letter',
  parsed.some(r => !r.essay && /^\d+$/.test(r.raw)));
check('at least one example keys an answer past D, which four columns could not hold',
  parsed.some(r => !r.essay && r.key > 3));

console.log('\n=== nothing in the file would show up as an import error ===');
const broken = parsed.filter(r => !r.essay && !(r.list.length >= 2 && keyIsValid(r.key, r.list.length)));
check('no row is an invalid question', broken.length === 0,
  broken.map(r => r.qText.slice(0, 40)).join(' | '));

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
