// The question CSV, explained by the kind of paper an instructor is setting.
//
// One entry per kind: what it is for, an example file, and the few things to
// know about writing it. The dashboard's guide (components/CsvGuide.jsx), its
// per-kind Download buttons and the printable PDF guide all read this list, so
// the three cannot drift apart — and csvGuide.test.mjs puts every example
// through the real parser, so an example that stops importing fails the build
// rather than an instructor's upload.
//
import { setsOf, questionsForSet } from './paperSets.js';

// Examples are look-alike items written for the guide, never a real paper's.
// Tips are plain strings; text between backticks is shown as code.

export const CSV_GUIDES = [
  {
    key: 'mc',
    label: 'Multiple choice',
    use: 'One right answer per question: a choice quiz, True/False, an identification with choices.',
    file: 'template_multiple_choice.csv',
    lines: [
      'question_text,choice_a,choice_b,choice_c,choice_d,choice_e,correct_answer',
      '"What is the primary function of the wing?","Produce lift","Produce thrust","Store fuel","Steer the aircraft",,A',
      '"Which instrument shows altitude?","Airspeed indicator","Altimeter","Tachometer","Compass",,B',
      '"Which of these is a primary flight control?","Flap","Slat","Spoiler","Trim tab","Aileron",E',
      '"An aerofoil produces lift by speeding up the air over its upper surface.","True","False",,,,A',
    ],
    tips: [
      'One row per question. The question goes first and the answer goes in the last column.',
      'Give each question as many choices as it needs: 2 for True/False, 4, 5 or more. Leave unused choice cells empty.',
      'Write the answer as the letter of the right choice: `A`, `B`, `C`…',
      'Each student gets the questions and the choices in a different order, so avoid "All of the above", "Both A and B", or a question that refers to the one before it.',
    ],
  },
  {
    key: 'multi',
    label: 'Several right answers',
    use: 'A question where the student ticks every correct choice.',
    file: 'template_several_answers.csv',
    lines: [
      'question_text,choice_a,choice_b,choice_c,choice_d,choice_e,correct_answer',
      '"Which of these are control surfaces?","Aileron","Elevator","Rudder","Flap","Fuel tank",A;B;C',
      '"Which forces act on an aircraft in straight and level flight?","Lift","Weight","Thrust","Drag","Torque",A;B;C;D',
      '"What is the primary function of the wing?","Produce lift","Produce thrust","Store fuel","Steer the aircraft",,A',
    ],
    tips: [
      'Write every right letter in the answer cell, separated by semicolons: `A;B;C`.',
      'The semicolon is what turns the question into tick boxes. A single letter stays an ordinary one-answer question, so both kinds can share one file.',
      'The student earns the item only by ticking every right choice and no wrong one.',
    ],
  },
  {
    key: 'essay',
    label: 'Essay',
    use: 'A written answer the student types in a box.',
    file: 'template_essay.csv',
    lines: [
      'question_text,choice_a,choice_b,correct_answer',
      '"Explain in your own words how a wing produces lift.",,,',
      '"Describe two checks you would make on a control cable during an inspection.",,,',
    ],
    tips: [
      'Write the question and leave every choice cell and the answer empty.',
      'Essays are not marked automatically. You read each student\'s answer in their results.',
      'To make an essay worth more than one point, add a `points` column (see Points per item).',
    ],
  },
  {
    key: 'points',
    label: 'Points per item',
    use: 'A paper where some items are worth more than others, or that mixes kinds of question.',
    file: 'template_points_per_item.csv',
    lines: [
      'question_text,type,points,answer,choice_a,choice_b,choice_c,choice_d',
      '"What is the primary function of the wing?",mc,1,A,"Produce lift","Produce thrust","Store fuel","Steer the aircraft"',
      '"Which of these are control surfaces?",multi,3,A;B,"Aileron","Elevator","Flap","Fuel tank"',
      '"Explain in your own words how a wing produces lift.",essay,10,,,,,',
    ],
    tips: [
      'Adding a `points` or `type` column to the header row switches the file to named columns. The columns can then come in any order, and the answer goes in the `answer` column instead of the last one.',
      '`points` is a whole number from 1 to 100. A blank cell counts as 1.',
      '`type` is one of `mc`, `multi`, `essay`, `math` or `quantity`. You can leave it blank and it is worked out from the row.',
      'Any column the guide doesn\'t name counts as a choice, so you can keep calling them `choice_a`, `choice_b`…',
    ],
  },
  {
    key: 'math',
    label: 'Maths answer',
    use: 'The student types the final answer with the maths keyboard: limits, derivatives, integrals, simplifying.',
    file: 'template_maths.csv',
    lines: [
      'question_text,type,points,given,answer,accept',
      '"Evaluate the limit.",math,2,"\\lim_{x\\to 3}(2x+1)",7,',
      '"Differentiate with respect to x.",math,3,"y=x^3","y\'=3x^2",',
      '"Differentiate with respect to x.",math,3,"y=\\ln(x)","y\'=\\frac{1}{x}","y\'=x^{-1}"',
      '"Evaluate the integral.",math,4,"y=\\int 4x\\,dx","y=2x^2+C","y=2x^2+K"',
    ],
    tips: [
      '`given` is the problem the student starts from, written in LaTeX. `answer` is the simplified result.',
      'The answer is marked automatically the moment the student submits.',
      'Spacing, `\\cdot`, braces, a `y\'=` in front, and `2` against `2.0` or `0.5` against `\\frac{1}{2}` all match automatically.',
      'Use `accept` only for a form that needs algebra to see as equal, such as `x^{-1}` for `\\frac{1}{x}`. Separate several with semicolons.',
      'A maths item from a CSV is all or nothing. To give marks for each step, build the question in the editor instead.',
      'In Excel, a cell that starts with `=`, `+` or `-` is read as a formula. Type an apostrophe first (`\'-x^2+C`). The apostrophe is not saved.',
    ],
  },
  {
    key: 'quantity',
    label: 'Number with unit',
    use: 'A computed answer typed as a value and its unit, e.g. 2.67 m/s.',
    file: 'template_number_with_unit.csv',
    lines: [
      'question_text,type,points,given,answer,accept',
      '"Air flows through a duct at 0.8 kg/s with a density of 1.2 kg/m^3 and an area of 0.25 m^2. Find the velocity.",quantity,4,Velocity V,2.67 m/s,m/sec;meters per second',
      '"A runway is 2.4 km long. Find its length in metres.",quantity,2,Runway length (nearest whole number),"2,400 m",meters;metres',
      '"An aircraft flies at 250 m/s where the speed of sound is 340 m/s. Find its Mach number.",quantity,2,Mach number,0.7353,',
    ],
    tips: [
      'One row per part. `given` names the part, and the student sees it with its rounding: "a) Velocity V (2 decimal places)".',
      'Write `answer` as the number, then the unit. The decimals in your answer set how far students round: `2.67` takes `2.67` or `2.6667`.',
      'Half the points are for the number and half for the unit, with an odd point going to the number. An answer with no unit puts every point on the number.',
      'Capitals, spaces, "per" for "/", and plurals already match. In `accept`, list only genuinely different spellings of the unit, separated by semicolons.',
      'Excel drops trailing zeros: a unitless `0.7350` becomes `0.735` and changes the rounding. Format that column as Text before typing.',
    ],
  },
  {
    key: 'sets',
    label: 'Sets A–H',
    use: 'One paper in several versions, each set with its own numbers, plus items every set shares.',
    file: 'template_sets.csv',
    lines: [
      'question_text,set,type,points,given,answer,choice_a,choice_b,choice_c',
      '"Which instrument shows altitude?",,mc,2,,B,"Airspeed indicator","Altimeter","Compass"',
      '"Air flows through a duct at 0.8 kg/s with a density of 1.2 kg/m^3 and an area of 0.25 m^2. Find the velocity.",A,quantity,4,Velocity V,2.67 m/s,,,',
      '"Air flows through a duct at 0.9 kg/s with a density of 1.2 kg/m^3 and an area of 0.25 m^2. Find the velocity.",B,quantity,4,Velocity V,3.00 m/s,,,',
      '"Air flows through a duct at 1.2 kg/s with a density of 1.2 kg/m^3 and an area of 0.25 m^2. Find the velocity.",C,quantity,4,Velocity V,4.00 m/s,,,',
    ],
    tips: [
      'Put a letter in the `set` column (`A` to `H`, or any letter) to put the row in that set only. Leave it blank for an item every set gets.',
      'Students see one Start button per set. Tell each student which set to press.',
      'Each student is marked only on their own set plus the shared items, so give every set the same number of items and points.',
      'The `set` column works with every kind of question: choices, maths, number with unit and essay.',
    ],
  },
];

// True of every file, whatever the kind of paper.
export const CSV_GENERAL_TIPS = [
  'Keep the header row as the first line. It tells the portal what each column is.',
  'In Excel use File → Save As → CSV UTF-8. In Google Sheets use File → Download → Comma-separated values.',
  'A cell with a comma in it needs quotes around it. Excel and Google Sheets add them for you.',
  'After you choose the file, the portal says how many questions it read and lists any problem by row number. Nothing is saved until you confirm.',
];

/** The example file for one kind of paper, as it is downloaded. */
export function guideCsv(guide) {
  return guide.lines.join('\n');
}

/** A tip split into plain text and `code` runs: [{ code: false, text }, …]. */
export function tipParts(tip) {
  return String(tip).split('`').map((text, i) => ({ code: i % 2 === 1, text })).filter(p => p.text);
}

const KINDS = [
  ['MC', q => q.question_type === 'multiple_choice'],
  ['Multi', q => q.question_type === 'multi_select'],
  ['Maths', q => q.question_type === 'worked_solution' && q.work_rubric?.mode !== 'quantity'],
  ['Number + unit', q => q.work_rubric?.mode === 'quantity'],
  ['Essay', q => q.question_type === 'essay'],
];
const pointsOf = qs => qs.reduce((t, q) => t + (Number(q.marks) || 1), 0);

/**
 * One line saying what an uploaded file holds, shown before it is imported.
 * On a paper in sets the points are what ONE student sits — their set and
 * the shared items — since adding every set together counts a paper nobody
 * takes; sets that differ are named so the mismatch is seen before import.
 */
export function csvImportSummary(questions) {
  const list = questions || [];
  const kinds = KINDS.map(([name, is]) => [name, list.filter(is).length])
    .filter(([, n]) => n > 0).map(([name, n]) => `${n} ${name}`);
  const sets = setsOf(list);
  if (sets.length === 0) return [...kinds, `${pointsOf(list)} points`].join(' · ');
  const per = sets.map(set => [set, pointsOf(questionsForSet(list, set))]);
  const same = new Set(per.map(([, p]) => p)).size === 1;
  return [...kinds, `Sets ${sets.join(', ')}`,
    same ? `${per[0][1]} points per student`
         : `points differ: ${per.map(([set, p]) => `Set ${set} ${p}`).join(', ')}`].join(' · ');
}
