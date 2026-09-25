// The CSV importer. Two things matter most here and they pull against each
// other: every file an instructor already has must keep importing EXACTLY as
// it did, and there has to be room for values that are neither a choice nor
// the answer — how many points an item is worth, and the problem a maths
// question starts from.
//
// The old format cannot be extended by appending a column, because the answer
// is defined as the last one. So a named header switches modes instead, and
// the first block below is the regression guard on the mode that already
// existed.
//
//   npm run test:question-csv

import { parseQuestionCSV, splitRow, readHeader } from '../questionCsv.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const P = t => parseQuestionCSV(t);

console.log('=== splitting a row ===');
check('plain cells', eq(splitRow('a,b,c'), ['a', 'b', 'c']));
check('a quoted comma stays inside its cell',
  eq(splitRow('"one, two",b'), ['one, two', 'b']));
check('cells are trimmed', eq(splitRow(' a , b '), ['a', 'b']));

console.log('\n=== POSITIONAL — the format every existing file uses ===');
{
  const r = P('What is V1?,alpha,beta,gamma,delta,B');
  check('four choices and a letter answer', r.errors.length === 0
    && r.questions.length === 1
    && r.questions[0].question_type === 'multiple_choice'
    && r.questions[0].correct_answer === 1
    && eq(r.questions[0].choices, ['alpha', 'beta', 'gamma', 'delta']),
    JSON.stringify(r));
  check('and it is worth one point, as it always was', r.questions[0].marks === 1);
}
check('a header row of question_text is skipped, not imported',
  P('question_text,choice_a,choice_b,correct_answer\nQ,a,b,A').questions.length === 1);
check('no header at all is fine', P('Q,a,b,A').questions.length === 1);
check('seven choices work — there is no ceiling',
  P('Q,a,b,c,d,e,f,g,G').questions[0].correct_answer === 6);
check('a numeric answer counts from zero', P('Q,a,b,c,d,0').questions[0].correct_answer === 0);
check('several answers make it a multi-answer item',
  (() => { const q = P('Q,a,b,c,d,A;C').questions[0];
           return q.question_type === 'multi_select' && eq(q.correct_answers, [0, 2]); })());
check('a bare AA is the 27th choice, not A and A',
  P('Q,' + Array.from({ length: 27 }, (_, i) => `c${i}`).join(',') + ',AA').questions[0].correct_answer === 26);
check('a blank first choice is an essay', (() => {
  const q = P('Write about lift,,,,').questions[0];
  return q && q.question_type === 'essay' && eq(q.choices, []);
})());
check('trailing blank columns are ignored', P('Q,a,b,c,d,B,,,').questions[0].correct_answer === 1);
check('one choice is an error, not a silent import',
  P('Q,only,A').errors.length === 1 && P('Q,only,A').questions.length === 0);
check('an answer past the last choice is an error',
  /only has 2 choices/.test(P('Q,a,b,D').errors[0] || ''), JSON.stringify(P('Q,a,b,D').errors));
check('the same choice named twice is an error',
  /same choice twice/.test(P('Q,a,b,c,d,A;A').errors[0] || ''));
check('a blank row is skipped rather than reported', P('Q,a,b,A\n\n').questions.length === 1);
check('errors count rows the way a spreadsheet does',
  /^Row 3:/.test(P('question_text,a,b,ans\nQ,a,b,A\nBad,only,A').errors[0] || ''),
  JSON.stringify(P('question_text,a,b,ans\nQ,a,b,A\nBad,only,A').errors));

console.log('\n=== what switches a file into NAMED mode ===');
check('question_text alone does NOT — old files must stay positional',
  readHeader(['question_text', 'choice_a', 'correct_answer']) === null);
check('points does', readHeader(['question_text', 'points', 'answer']) !== null);
check('so do type, given and variable',
  readHeader(['question', 'type']) !== null
  && readHeader(['question', 'given']) !== null
  && readHeader(['question', 'wrt']) !== null);
check('an unnamed column becomes a choice',
  eq(readHeader(['question_text', 'points', 'a', 'b', 'answer']).choiceCols, [2, 3]));

console.log('\n=== NAMED — points on any item ===');
{
  const r = P('question_text,points,choice_a,choice_b,choice_c,choice_d,answer\n'
            + 'Worth five,5,alpha,beta,gamma,delta,C');
  check('a multiple-choice item can be worth 5 points',
    r.errors.length === 0 && r.questions[0].marks === 5
    && r.questions[0].question_type === 'multiple_choice'
    && r.questions[0].correct_answer === 2, JSON.stringify(r));
}
check('blank points means one', P('question_text,points,a,b,answer\nQ,,x,y,A').questions[0].marks === 1);
check('a multi-answer item can be weighted too',
  (() => { const q = P('question_text,points,a,b,c,answer\nQ,3,x,y,z,A;B').questions[0];
           return q.marks === 3 && q.question_type === 'multi_select'; })());
check('an essay can be weighted', (() => {
  const q = P('question_text,type,points,answer\nDiscuss,essay,10,').questions[0];
  return q.question_type === 'essay' && q.marks === 10;
})());
check('nonsense points is an error naming the row',
  /not a number of points/.test(P('question_text,points,a,b,answer\nQ,lots,x,y,A').errors[0] || ''));
check('half a point on a whole item is refused',
  /whole number/.test(P('question_text,points,a,b,answer\nQ,2.5,x,y,A').errors[0] || ''));
check('zero points is refused', P('question_text,points,a,b,answer\nQ,0,x,y,A').errors.length === 1);
check('marks is accepted as a spelling of points',
  P('question_text,marks,a,b,answer\nQ,4,x,y,A').questions[0].marks === 4);

console.log('\n=== NAMED — a maths question from a spreadsheet ===');
{
  const r = P('question_text,type,points,given,answer\n'
            + 'Differentiate with respect to x.,math,3,y=5x,y\'=5');
  const q = r.questions[0];
  check('it imports as a worked item', r.errors.length === 0
    && q.question_type === 'worked_solution', JSON.stringify(r));
  check('carrying the problem and what it is worth',
    q.work_given === 'y=5x' && q.marks === 3);
  check('with a one-step rubric holding the simplified answer',
    q.work_rubric.steps.length === 1
    && q.work_rubric.steps[0].latex === "y'=5"
    && q.work_rubric.steps[0].marks === 3, JSON.stringify(q.work_rubric));
  check('and all-or-nothing marking — one bad step costs the whole item',
    q.work_rubric.penaltyPerBrokenStep === 3);
  check('no choices and no picked key', eq(q.choices, []) && q.correct_answer === null);
  check('the variable defaults to x', q.work_variable === 'x');
}
check('the variable can be stated',
  P('question_text,type,given,answer,wrt\nQ,math,y=5t,5,t').questions[0].work_variable === 't');
check('a given column alone implies maths, with no type stated',
  P('question_text,given,answer\nQ,y=5x,5').questions[0].question_type === 'worked_solution');
check('a maths row with no answer is an error — there would be nothing to mark',
  /needs an answer/.test(P('question_text,type,given,answer\nQ,math,y=5x,').errors[0] || ''));
check('a LaTeX answer with a comma survives if quoted',
  P('question_text,type,given,answer\nQ,math,y=x^2,"\\frac{1}{2},"').questions.length === 1);

console.log('\n=== NAMED — inferring the type when it is not stated ===');
check('choices and a letter mean multiple choice',
  P('question_text,points,a,b,answer\nQ,2,x,y,B').questions[0].question_type === 'multiple_choice');
check('no choices and no answer means an essay',
  P('question_text,points,answer\nQ,2,').questions[0].question_type === 'essay');
check('a stated type beats the guess',
  P('question_text,type,points,a,b,c,answer\nQ,multi,2,x,y,z,A;C').questions[0].question_type === 'multi_select');
check('a type of multi with only one answer is an error, not a quiet downgrade',
  /separate them/.test(P('question_text,type,a,b,answer\nQ,multi,x,y,A').errors[0] || ''),
  JSON.stringify(P('question_text,type,a,b,answer\nQ,multi,x,y,A').errors));

console.log('\n=== a mixed file, which is the point of all this ===');
{
  const r = P([
    'question_text,type,points,given,answer,choice_a,choice_b,choice_c,choice_d',
    'Which is the power rule?,mc,2,,B,wrong,right,no,nope',
    'Differentiate y = 5x.,math,3,y=5x,y\'=5,,,,',
    'Explain lift.,essay,5,,,,,,',
    'Pick the two even numbers,multi,4,,A;C,2,3,4,5',
  ].join('\n'));
  check('every row imports', r.errors.length === 0 && r.questions.length === 4,
    JSON.stringify(r.errors));
  check('each with its own type',
    eq(r.questions.map(q => q.question_type),
       ['multiple_choice', 'worked_solution', 'essay', 'multi_select']),
    JSON.stringify(r.questions.map(q => q.question_type)));
  check('and its own weight', eq(r.questions.map(q => q.marks), [2, 3, 5, 4]));
  check('the paper is worth 14 points',
    r.questions.reduce((t, q) => t + q.marks, 0) === 14);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
