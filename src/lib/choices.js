// Reading an item's choices, whatever shape the row is in.
//
// The ceiling moved twice — four columns originally, choice_e in sql/012 — so
// sql/016 replaced the columns with `questions.choices`, a jsonb array of any
// length. choice_a..choice_e survive as a mirror of the first five, written by
// a trigger, purely so a browser still running the previous build keeps
// rendering questions that have been edited since.
//
// Everything here prefers the array and falls back to the columns, which
// covers three cases: a row written before 016 ran, the legacy `exams` table
// (which never had the array), and a client that loaded mid-migration.

/** The choices of an item, in stored order. Always a plain array of strings. */
export function choicesOf(q) {
  if (Array.isArray(q?.choices)) {
    return q.choices.filter(c => c != null && String(c).trim() !== '').map(String);
  }
  // Some drivers hand back jsonb as a string.
  if (typeof q?.choices === 'string' && q.choices.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(q.choices);
      if (Array.isArray(parsed)) {
        return parsed.filter(c => c != null && String(c).trim() !== '').map(String);
      }
    } catch { /* fall through to the columns */ }
  }
  return ['a', 'b', 'c', 'd', 'e']
    .map(L => q?.[`choice_${L}`])
    .filter(c => c != null && String(c).trim() !== '')
    .map(String);
}

/**
 * The label for a position: 0 -> A ... 25 -> Z, then AA, AB, and onwards.
 * Generated rather than looked up in a fixed list, so nothing runs out.
 */
export function letterFor(i) {
  if (!Number.isInteger(i) || i < 0) return '';
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) {
    s = String.fromCharCode(65 + (n % 26)) + s;
  }
  return s;
}

/** 'A' -> 0, 'b' -> 1, 'AA' -> 26. Null when it is not a letter label. */
export function indexForLetter(label) {
  const s = String(label ?? '').trim().toUpperCase();
  if (!s || !/^[A-Z]+$/.test(s)) return null;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * What to write for an item's choices. `choices` is the truth; the trigger in
 * sql/016 fills choice_a..choice_e from it, so they are deliberately not sent.
 * Blank entries are dropped, so a half-filled editor row never becomes an
 * empty button in front of a student.
 */
export function choicesPatch(list) {
  return { choices: (list || []).map(c => String(c ?? '').trim()).filter(Boolean) };
}

/** Is this key usable against this many choices? */
export function keyIsValid(correctAnswer, count) {
  return Number.isInteger(correctAnswer) && correctAnswer >= 0 && correctAnswer < count;
}
