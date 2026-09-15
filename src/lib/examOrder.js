// Deciding what order a student sees a paper in.
//
// Two switches, both defaulting on (sql/012 and sql/017):
//   shuffle_questions — the order the questions come in
//   shuffle_choices   — the order the options come in, per question
// They are independent: a paper can shuffle one and not the other.
//
// The order is SEEDED on the student's id, not random, so reloading mid-exam
// gives the same paper back rather than reshuffling under them. Both shuffles
// draw from the one seeded sequence, in this order — questions first, then
// each question's choices — so the result is reproducible from the seed alone.
//
// What never moves is the INDEX. correct_answer is an index into the stored
// choices, so shuffling changes only what position a choice is drawn at;
// marking compares the stored index either way and cannot be affected.

import { choicesOf } from './choices.js';

/** Seed from a student id, so each student gets their own stable order. */
export function seedFor(studentId) {
  if (!studentId) return 123;          // preview / no student: a fixed paper
  let seed = 0;
  for (let i = 0; i < studentId.length; i++) {
    seed = (seed * 31 + studentId.charCodeAt(i)) >>> 0;
  }
  return seed;
}

function rng(seed) {
  let s = seed;
  return () => {
    const x = Math.sin(s++) * 10000;
    return x - Math.floor(x);
  };
}

function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Prepare a fetched paper for display.
 *
 * @param questions rows as fetched, already in question_number order
 * @param exam      the assessment, for its two switches
 * @param studentId seeds the order
 * @returns the questions in display order, each with:
 *            choice_list  — its choices, in stored order
 *            choice_order — the stored indices, in the order to draw them
 */
export function prepareQuestions(questions, exam, studentId) {
  const rand = rng(seedFor(studentId));
  const list = [...(questions || [])];

  // `!== false` rather than truthiness: a paper loaded before these columns
  // existed has undefined here and must keep shuffling.
  if (exam?.shuffle_questions !== false) shuffleInPlace(list, rand);

  const keepChoiceOrder = exam?.shuffle_choices === false;
  return list.map(q => {
    const opts = choicesOf(q);
    const order = opts.map((_, i) => i);
    if (!keepChoiceOrder) shuffleInPlace(order, rand);
    return { ...q, choice_list: opts, choice_order: order };
  });
}
