// Reading a paper out of a CSV.
//
// TWO MODES, and which one you get depends only on the header row.
//
// POSITIONAL — what every file written before sql/025 uses, and what you get
// when there is no header or the header names nothing special. The rule is:
//
//     question_text, choice_a, choice_b, …, correct_answer
//
// the answer is the LAST non-blank column and everything between it and the
// question is a choice. That is what lets a four-choice file, a five-choice
// file and a seven-choice file all import with no flag anywhere (sql/016) —
// and it is also why nothing can simply be appended to the format: a new
// trailing column would be read as the answer.
//
// NAMED — chosen when the header row names any of `points`, `marks`, `type` or
// `given`. Columns then bind by name and order stops mattering, which is the
// only way to carry a value that is neither a choice nor the answer:
//
//     question_text, type, points, given, answer, choice_a, choice_b, …
//
// Anything the header does not name is treated as a choice, in header order,
// so a file can mix the two ideas: name the odd columns, leave the choices
// unnamed.
//
// WHY NOT ALWAYS NAMED: every CSV an instructor already has on disk would have
// to be edited. Positional stays the default forever.
//
// WORKED ITEMS FROM CSV ARE ALL OR NOTHING. A multi-step rubric with marks per
// step is worth building by hand in the editor; from a spreadsheet you give the
// question, the problem and the simplified answer, and the item is worth its
// full points if the student reaches that answer with sound working and zero
// otherwise. That is spelt with penaltyPerBrokenStep set to the whole value of
// the item, so a single step that does not follow wipes it — see markWork() in
// workedSolution.js, which is the thing that reads this.

import { indexForLetter, letterFor, keyIsValid } from './choices.js';
import { indexSet } from './answers.js';

/** Split one CSV line, honouring double quotes around a cell. */
export function splitRow(row) {
  const cells = [];
  let cell = '', inQ = false;
  for (const ch of row) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cells.push(cell.trim()); cell = ''; }
    else { cell += ch; }
  }
  cells.push(cell.trim());
  return cells;
}

const norm = s => String(s ?? '').toLowerCase().trim().replace(/\s+/g, '_');

// Header names that mean something other than "this is a choice". Several
// spellings each, because an instructor writing the file by hand should not
// have to guess which one we chose.
const FIELD_ALIASES = {
  question_text: 'question_text', question: 'question_text', item: 'question_text',
  type: 'type', question_type: 'type',
  points: 'points', marks: 'points', mark: 'points', point: 'points', score: 'points',
  given: 'given', problem: 'given', expression: 'given',
  answer: 'answer', correct_answer: 'answer', correct: 'answer', key: 'answer',
  variable: 'variable', with_respect_to: 'variable', wrt: 'variable',
  accept: 'accept', also_accept: 'accept', alternatives: 'accept',
  accepted: 'accept', variations: 'accept',
};

// The presence of any of these is what switches a file into named mode. Not
// `question_text` or `answer` on their own: files today already head their
// first column "question_text" and must keep parsing positionally.
const NAMED_MODE_TRIGGERS = new Set(['type', 'points', 'given', 'variable', 'accept']);

const TYPE_ALIASES = {
  mc: 'multiple_choice', multiple_choice: 'multiple_choice', choice: 'multiple_choice',
  single: 'multiple_choice', mcq: 'multiple_choice',
  multi: 'multi_select', multi_select: 'multi_select', multiple_answers: 'multi_select',
  many: 'multi_select', checkbox: 'multi_select',
  essay: 'essay', open: 'essay', written: 'essay',
  math: 'worked_solution', maths: 'worked_solution', worked: 'worked_solution',
  worked_solution: 'worked_solution', solution: 'worked_solution', working: 'worked_solution',
};

/** Read a header row as a column map, or null when the file is positional. */
export function readHeader(cells) {
  const fields = {};
  const choiceCols = [];
  let triggered = false;
  cells.forEach((raw, i) => {
    const field = FIELD_ALIASES[norm(raw)];
    if (field) {
      if (NAMED_MODE_TRIGGERS.has(field)) triggered = true;
      // First spelling wins, so a duplicated header cannot silently shadow.
      if (fields[field] === undefined) fields[field] = i;
    } else if (norm(raw)) {
      choiceCols.push(i);
    }
  });
  if (!triggered) return null;
  return { fields, choiceCols };
}

/**
 * How many points a row is worth. Blank means one, which is what every item
 * was worth before sql/025 and keeps an unweighted file importing unchanged.
 */
function readPoints(raw, rowNo, errors) {
  const txt = String(raw ?? '').trim();
  if (!txt) return 1;
  const n = Number(txt);
  if (!Number.isFinite(n) || n < 1 || n > 100) {
    errors.push(`Row ${rowNo}: "${txt}" is not a number of points — use a whole number from 1 to 100, or leave it blank for 1`);
    return null;
  }
  // Half marks are meaningful on a rubric step but not on a whole item, and
  // questions.marks is an integer column, so this is where that is enforced.
  if (!Number.isInteger(n)) {
    errors.push(`Row ${rowNo}: an item cannot be worth ${txt} points — use a whole number`);
    return null;
  }
  return n;
}

/** The answer of a picked item, as a set of choice indices. Null on error. */
function readPickedKey(raw, choices, rowNo, errors) {
  const text = String(raw ?? '').trim().toUpperCase();
  // Several answers are written with a separator: "A;C", "A C", "A|C", "A+C".
  // The separator is REQUIRED and is what makes the row a multiple-answer
  // question — a bare "AA" already means the 27th choice (sql/016).
  const parts = text.split(/[;|+/\s,]+/).filter(Boolean);
  const keys = parts.map(part => (/^\d+$/.test(part) ? Number(part) : indexForLetter(part)));
  if (keys.length === 0 || keys.some(k => k === null || k === undefined || Number.isNaN(k))) {
    errors.push(`Row ${rowNo}: invalid answer "${text}" — use a letter (A, B, … ${letterFor(choices.length - 1)}) or a number (0–${choices.length - 1}), and separate several answers with a semicolon`);
    return null;
  }
  const outOfRange = keys.filter(k => !keyIsValid(k, choices.length));
  if (outOfRange.length > 0) {
    errors.push(`Row ${rowNo}: the answer is ${outOfRange.map(letterFor).join(', ')} but the row only has ${choices.length} choices (A–${letterFor(choices.length - 1)})`);
    return null;
  }
  const set = indexSet(keys);
  if (set.length !== keys.length) {
    errors.push(`Row ${rowNo}: the answer "${text}" names the same choice twice`);
    return null;
  }
  return set;
}

/**
 * Other answers this item will take.
 *
 * Split on a semicolon that is NOT preceded by a backslash, because `\;` is a
 * LaTeX spacing command and splitting on it would cut an answer in half. A
 * vertical bar would have been the obvious separator and is worse: |x| is an
 * absolute value and appears in half the answers in a calculus paper.
 */
export function splitAccept(cell) {
  return String(cell ?? '')
    .split(/(?<!\\);/)
    .map(v => v.trim())
    .filter(Boolean);
}

/** A worked item, all or nothing on its final answer. Null on error. */
function buildWorked({ qText, points, given, answer, variable, accept }, rowNo, errors) {
  const final = String(answer ?? '').trim();
  if (!final) {
    errors.push(`Row ${rowNo}: a maths question needs an answer — the simplified result, e.g. 5 or x^2+C`);
    return null;
  }
  const also = splitAccept(accept).filter(v => v !== final);
  return {
    question_text: qText,
    question_type: 'worked_solution',
    choices: [],
    correct_answer: null,
    marks: points,
    work_given: String(given ?? '').trim() || null,
    work_variable: String(variable ?? '').trim() || 'x',
    work_rubric: {
      steps: [{ latex: final, marks: points, label: 'Final answer' }],
      // Other spellings this item will take (sql/027). The database already
      // matches the cosmetic ones — spacing, \cdot, braces, a y'= on the
      // front, and numbers compared as numbers — so this is only ever needed
      // for the ones that take real algebra to see as equal, like x^{-1}
      // against \frac{1}{x}.
      accept: also,
      penaltyPerBrokenStep: points,
    },
  };
}

/**
 * Parse a question CSV. Returns { questions, errors } — never throws, so a
 * malformed row is reported next to the good ones rather than losing the file.
 */
export function parseQuestionCSV(text) {
  const rows = String(text ?? '').trim().split(/\r?\n/).map(splitRow);
  const questions = [], errors = [];
  if (rows.length === 0) return { questions, errors };

  const first = norm(rows[0]?.[0]);
  const header = readHeader(rows[0]);
  const hasPlainHeader = first === 'question_text' || first === 'question';
  const dataRows = (header || hasPlainHeader) ? rows.slice(1) : rows;

  dataRows.forEach((cols, idx) => {
    const rowNo = idx + (header || hasPlainHeader ? 2 : 1);
    const at = i => (i === undefined ? '' : (cols[i] ?? '').trim());

    // ---- named mode -------------------------------------------------
    if (header) {
      const f = header.fields;
      const qText = at(f.question_text !== undefined ? f.question_text : 0);
      if (!qText) return;

      const points = readPoints(at(f.points), rowNo, errors);
      if (points === null) return;

      const choices = header.choiceCols.map(at).filter(Boolean);
      const answer = at(f.answer);
      const given = at(f.given);

      // A stated type wins. Without one: a `given` or an answer that is not a
      // choice letter means maths, no choices at all means an essay.
      let type = TYPE_ALIASES[norm(at(f.type))];
      if (!type) {
        if (given) type = 'worked_solution';
        else if (choices.length === 0) type = answer ? 'worked_solution' : 'essay';
        else type = null;   // decided by the answer below
      }

      if (type === 'essay') {
        questions.push({ question_text: qText, question_type: 'essay',
                         choices: [], correct_answer: null, marks: points });
        return;
      }
      if (type === 'worked_solution') {
        const item = buildWorked({
          qText, points, given, answer,
          variable: at(f.variable), accept: at(f.accept),
        }, rowNo, errors);
        if (item) questions.push(item);
        return;
      }

      if (choices.length < 2) {
        errors.push(`Row ${rowNo}: needs at least two choices, or a type of essay or math`);
        return;
      }
      if (at(f.accept)) {
        errors.push(`Row ${rowNo}: "accept" only applies to a maths question — a multiple-choice answer is a letter, so there is nothing to spell another way`);
        return;
      }
      const set = readPickedKey(answer, choices, rowNo, errors);
      if (!set) return;
      const wantsMulti = type === 'multi_select';
      if (wantsMulti && set.length < 2) {
        errors.push(`Row ${rowNo}: the type says several answers but only "${answer}" is given — separate them with a semicolon`);
        return;
      }
      questions.push(set.length > 1
        ? { question_text: qText, question_type: 'multi_select', choices,
            correct_answer: null, correct_answers: set, marks: points }
        : { question_text: qText, question_type: 'multiple_choice', choices,
            correct_answer: set[0], marks: points });
      return;
    }

    // ---- positional mode, exactly as it has always worked ------------
    const qText = (cols[0] ?? '').trim();
    if (!qText) return;

    // A blank first choice is how an essay row is written.
    if (!(cols[1] ?? '').trim()) {
      questions.push({ question_text: qText, question_type: 'essay',
                       choices: [], correct_answer: null, marks: 1 });
      return;
    }

    const trimmed = [...cols];
    while (trimmed.length && !(trimmed[trimmed.length - 1] ?? '').trim()) trimmed.pop();
    const raw = (trimmed[trimmed.length - 1] ?? '').trim();
    const choices = trimmed.slice(1, trimmed.length - 1).map(v => (v ?? '').trim()).filter(Boolean);
    if (choices.length < 2) { errors.push(`Row ${rowNo}: needs at least two choices`); return; }

    const set = readPickedKey(raw, choices, rowNo, errors);
    if (!set) return;
    questions.push(set.length > 1
      ? { question_text: qText, question_type: 'multi_select', choices,
          correct_answer: null, correct_answers: set, marks: 1 }
      : { question_text: qText, question_type: 'multiple_choice', choices,
          correct_answer: set[0], marks: 1 });
  });

  return { questions, errors };
}
