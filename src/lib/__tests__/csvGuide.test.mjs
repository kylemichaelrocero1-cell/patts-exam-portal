// The CSV guide's examples are downloadable files, so each one has to import —
// through the REAL parser, with no errors — and has to show what its tab says
// it shows. An example that drifts from the parser would teach an instructor
// a file that fails on upload.
//
//   npm run test:csv-guide

import { parseQuestionCSV, readHeader, splitRow } from '../questionCsv.js';
import { CSV_GUIDES, CSV_GENERAL_TIPS, guideCsv, tipParts, csvImportSummary } from '../csvGuide.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const byKey = Object.fromEntries(CSV_GUIDES.map(g => [g.key, g]));
const parsed = Object.fromEntries(CSV_GUIDES.map(g => [g.key, parseQuestionCSV(guideCsv(g))]));
const types = key => parsed[key].questions.map(q => q.question_type);

console.log('=== every example ===');
for (const g of CSV_GUIDES) {
  const r = parsed[g.key];
  check(`${g.key}: imports with no errors`, r.errors.length === 0, r.errors.join(' | '));
  check(`${g.key}: every data row becomes a question`, r.questions.length === g.lines.length - 1,
    `${r.questions.length} of ${g.lines.length - 1}`);
  check(`${g.key}: has a label, a use, a .csv name and tips`,
    g.label && g.use && /^[a-z_]+\.csv$/.test(g.file) && g.tips.length >= 2);
  check(`${g.key}: no row explains the format — it would import as a question`,
    r.questions.every(q => !/^\s*(delete|remove|note|example|instruction)/i.test(q.question_text)));
  check(`${g.key}: every backtick in a tip is paired`, g.tips.every(t => (t.match(/`/g) || []).length % 2 === 0));
}
check('file names are unique', new Set(CSV_GUIDES.map(g => g.file)).size === CSV_GUIDES.length);
check('keys are unique', new Set(CSV_GUIDES.map(g => g.key)).size === CSV_GUIDES.length);
check('general tips exist', CSV_GENERAL_TIPS.length >= 3);

console.log('\n=== each tab shows what it says ===');
check('mc: positional, single answers only, 2 to 5 choices',
  readHeader(splitRow(byKey.mc.lines[0])) === null
  && types('mc').every(t => t === 'multiple_choice')
  && parsed.mc.questions.some(q => q.choices.length === 2)
  && parsed.mc.questions.some(q => q.choices.length === 5));
check('mc: a letter as far as E is read', parsed.mc.questions.some(q => q.correct_answer === 4));
check('mc: "A or C" is a one-answer item that either choice earns', parsed.mc.questions.some(q =>
  q.question_type === 'multiple_choice' && q.correct_answer === 0 && JSON.stringify(q.accepted_answers) === '[2]'));
check('multi: tick-box items, alongside a single-answer one',
  types('multi').filter(t => t === 'multi_select').length === 2 && types('multi').includes('multiple_choice'));
check('multi: A;B;C is three answers', parsed.multi.questions[0].correct_answers?.length === 3);
check('essay: essays only, one point each',
  types('essay').every(t => t === 'essay') && parsed.essay.questions.every(q => q.marks === 1));
check('points: named mode, three kinds, weights 1, 3, 10',
  readHeader(splitRow(byKey.points.lines[0])) !== null
  && JSON.stringify(types('points')) === JSON.stringify(['multiple_choice', 'multi_select', 'essay'])
  && JSON.stringify(parsed.points.questions.map(q => q.marks)) === JSON.stringify([1, 3, 10]));

const maths = parsed.math.questions;
check('math: all typed maths, all or nothing',
  maths.every(q => q.question_type === 'worked_solution' && q.work_rubric.penaltyPerBrokenStep === q.marks));
check('math: the LaTeX survives — \\lim and \\int keep their backslash',
  maths[0].work_given.includes('\\lim') && maths[3].work_given.includes('\\int'));
check('math: accept is demonstrated', maths.some(q => q.work_rubric.accept.length > 0));

const qty = parsed.quantity.questions.map(q => q.work_rubric?.parts?.[0]);
check('quantity: all quantity rubrics', parsed.quantity.questions.every(q => q.work_rubric?.mode === 'quantity'));
check('quantity: 2.67 m/s, two places, half on the unit, other spellings kept',
  qty[0].value === '2.67' && qty[0].decimals === 2 && qty[0].unit_marks === 2 && qty[0].value_marks === 2
  && qty[0].units.includes('m/s') && qty[0].units.includes('meters per second'));
check('quantity: the example arithmetic is right (0.8 / (1.2 × 0.25))',
  (0.8 / (1.2 * 0.25)).toFixed(2) === qty[0].value);
check('quantity: "2,400 m" is a whole number, rounding already named',
  qty[1].value === '2400' && qty[1].decimals === 0
  && parsed.quantity.questions[1].work_given === 'a) Runway length (nearest whole number)');
check('quantity: no unit puts every point on the number',
  qty[2].units.length === 0 && qty[2].unit_marks === 0 && qty[2].value_marks === 2
  && (250 / 340).toFixed(4) === qty[2].value);

const sets = parsed.sets.questions;
check('sets: one shared item with no set', !('set_label' in sets[0]));
check('sets: then Sets A, B and C', sets.slice(1).map(q => q.set_label).join('') === 'ABC');
check('sets: each set\'s answer is right for its numbers',
  sets.slice(1).every(q => {
    const flow = Number(q.question_text.match(/at ([\d.]+) kg\/s/)[1]);
    return (flow / (1.2 * 0.25)).toFixed(2) === q.work_rubric.parts[0].value;
  }));
check('sets: every set is worth the same', new Set(sets.slice(1).map(q => q.marks)).size === 1);

console.log('\n=== the upload summary ===');
check('a plain paper: kinds and its total', csvImportSummary(parsed.points.questions) === '1 MC · 1 Multi · 1 Essay · 14 points',
  csvImportSummary(parsed.points.questions));
check('number + unit is its own kind, not maths', csvImportSummary(parsed.quantity.questions) === '3 Number + unit · 8 points',
  csvImportSummary(parsed.quantity.questions));
check('sets: points are what one student sits, not every set added up',
  csvImportSummary(parsed.sets.questions) === '1 MC · 3 Number + unit · Sets A, B, C · 6 points per student',
  csvImportSummary(parsed.sets.questions));
{
  const uneven = parsed.sets.questions.map((q, i) => (i === 3 ? { ...q, marks: 6 } : q));
  check('sets worth different points are named', csvImportSummary(uneven).endsWith('points differ: Set A 6, Set B 6, Set C 8'),
    csvImportSummary(uneven));
}
check('nothing uploaded', csvImportSummary([]) === '0 points');

console.log('\n=== tipParts ===');
check('splits code runs', JSON.stringify(tipParts('use `A;B` here')) ===
  JSON.stringify([{ code: false, text: 'use ' }, { code: true, text: 'A;B' }, { code: false, text: ' here' }]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
