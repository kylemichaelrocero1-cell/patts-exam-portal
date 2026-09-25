// The Download Template buttons hand instructors a file that is also the
// documentation — each row demonstrates one shape. So the templates have to
// actually import, and keep importing as the parser changes.
//
// This reads both templates straight out of AdminDashboard.jsx and puts them
// through the REAL parser. It used to reproduce the parser's rule here instead,
// which was the drift it was written to prevent; now there is one
// implementation and this only supplies the input.
//
// It has already earned its keep twice: the first version shipped a "delete
// these rows" line that was itself an invalid question, and the second lost
// two helper functions when the parser was extracted.
//
//   npm run test:csv-template

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuestionCSV, readHeader, splitRow } from '../questionCsv.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const src = fs.readFileSync(path.join(REPO, 'src/AdminDashboard.jsx'), 'utf8');

/** The CSV a download button writes, recovered from its source. */
function templateFrom(fnName) {
  const start = src.indexOf(`const ${fnName} = `);
  if (start === -1) return null;
  const block = src.slice(start, src.indexOf("].join('\\n');", start));
  return [...block.matchAll(/^ {6}'(.*)',$/gm)]
    .map(m => m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'))
    .join('\n');
}

console.log('=== the plain template (positional) ===');
const plain = templateFrom('downloadCSVTemplate');
check('it is still where this test looks for it', plain !== null);
{
  const r = parseQuestionCSV(plain);
  check('it imports with no errors at all', r.errors.length === 0, JSON.stringify(r.errors));
  check('and yields six questions', r.questions.length === 6, `${r.questions.length}`);

  const header = splitRow(plain.split('\n')[0]);
  check('the first column is question_text',
    header[0].toLowerCase() === 'question_text', header[0]);
  check('the last column is correct_answer',
    header[header.length - 1].toLowerCase() === 'correct_answer', header[header.length - 1]);
  check('it offers at least seven choice columns, so "add more" is visibly true',
    header.length - 2 >= 7, `${header.length - 2} choice columns`);
  check('it stays POSITIONAL — naming question_text must not switch modes',
    readHeader(header) === null);

  const types = r.questions.map(q => q.question_type);
  check('it demonstrates a single-answer item', types.includes('multiple_choice'));
  check('a multiple-answer item', types.includes('multi_select'));
  check('and an essay', types.includes('essay'));
  check('every item in it is worth one point, as a positional file always is',
    r.questions.every(q => q.marks === 1), JSON.stringify(r.questions.map(q => q.marks)));

  const widths = new Set(r.questions.filter(q => q.choices.length).map(q => q.choices.length));
  check('it shows several different choice counts', widths.size >= 3, [...widths].join(', '));
  check('the multiple-answer row really names three answers',
    r.questions.some(q => q.correct_answers?.length === 3),
    JSON.stringify(r.questions.map(q => q.correct_answers)));
  check('no row explains the format — a row of prose would import as a question',
    r.questions.every(q => !/^\s*(delete|remove|note|example|instruction)/i.test(q.question_text)),
    JSON.stringify(r.questions.map(q => q.question_text.slice(0, 30))));
}

console.log('\n=== the weighted template (named) ===');
const weighted = templateFrom('downloadWeightedCSVTemplate');
check('it exists', weighted !== null);
{
  const r = parseQuestionCSV(weighted);
  check('it imports with no errors at all', r.errors.length === 0, JSON.stringify(r.errors));
  check('and yields five questions', r.questions.length === 5, `${r.questions.length}`);
  check('it is parsed in NAMED mode', readHeader(splitRow(weighted.split('\n')[0])) !== null);

  const types = r.questions.map(q => q.question_type);
  check('it demonstrates all four types',
    ['multiple_choice', 'multi_select', 'worked_solution', 'essay'].every(t => types.includes(t)),
    types.join(', '));
  check('not every item is worth one point — that is the whole reason it exists',
    r.questions.some(q => q.marks > 1), JSON.stringify(r.questions.map(q => q.marks)));
  check('no item is worth less than one', r.questions.every(q => q.marks >= 1));

  const maths = r.questions.filter(q => q.question_type === 'worked_solution');
  check('it shows two maths questions — a derivative and an integral', maths.length === 2);
  check('each carries the problem it starts from',
    maths.every(q => q.work_given && q.work_given.length > 0),
    JSON.stringify(maths.map(q => q.work_given)));
  check('each carries a one-step rubric holding the simplified answer',
    maths.every(q => q.work_rubric?.steps?.length === 1 && q.work_rubric.steps[0].latex),
    JSON.stringify(maths.map(q => q.work_rubric)));
  check('and each is all-or-nothing, as a CSV maths item is',
    maths.every(q => q.work_rubric.penaltyPerBrokenStep === q.marks));
  check('the integral example survived the escaping — it still has a backslash',
    maths.some(q => q.work_given.includes('\\int')),
    JSON.stringify(maths.map(q => q.work_given)));
  check('no row explains the format here either',
    r.questions.every(q => !/^\s*(delete|remove|note|example|instruction)/i.test(q.question_text)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
