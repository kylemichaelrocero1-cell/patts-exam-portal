// A problem answered as quantities: each part a number and its unit, typed
// as a student would write it ("EOQ = 24.49 bottles per order"), marked a
// point for the value and a point for the unit — the JS twin of
// quantity_number(), quantity_unit_key(), quantity_value_ok() and
// mark_quantities() (sql/105). The dashboard re-marks with this, and saving
// there overwrites the database's mark, so the two must agree;
// sql/test/quantity_answers.test.mjs runs both over the same strings.
//
// The item is a worked_solution row with
//   work_given:  one line per part, "a) Economic order quantity (2 decimal places)"
//   work_rubric: { mode: 'quantity', parts: [{ key: 'a', value: '24.49', decimals: 2,
//                  units: ['bottles/order', ...], value_marks: 1, unit_marks: 1 }] }
// work_given is all the exam screen is sent; the rubric never leaves the
// database. An answer is stored as one line per part, each starting with its
// part's letter — "a) 24.49 bottles/order" — so a part left blank does not
// shift the rest.

/** Is this rubric (or a work_mode string) a quantity problem? */
export function isQuantity(rubricOrMode) {
  return (typeof rubricOrMode === 'string' ? rubricOrMode : rubricOrMode?.mode) === 'quantity';
}

const PART_LINE = /^\s*([a-z])\)\s?(.*)$/;

/** The parts named in work_given, in order: [{ key: 'a', label: '…' }]. */
export function quantityParts(given) {
  return String(given ?? '').split('\n')
    .map(l => l.match(PART_LINE)).filter(Boolean)
    .map(m => ({ key: m[1], label: m[2].trim() }));
}

/** A part's answer as it is stored: its letter, then what was typed. */
export function partLine(key, text) {
  return `${key}) ${String(text ?? '')}`;
}

/** { key, text } of a stored line, or null for a line with no part letter. */
export function splitPartLine(line) {
  const m = String(line ?? '').match(PART_LINE);
  return m ? { key: m[1], text: m[2] } : null;
}

// The first number in the answer: digits with thousands commas, a decimal
// point, a leading minus. The same pattern as the SQL.
const NUMBER = /-?(?:\d[\d,]*(?:\.\d*)?|\.\d+)/;

/** What is after the last "=", so "EOQ = 24.49 …" reads as "24.49 …". */
function afterEquals(text) {
  const s = String(text ?? '').replace(/−/g, '-');
  const at = s.lastIndexOf('=');
  return at < 0 ? s : s.slice(at + 1);
}

/** The number written, as plain digits ("1,200." → "1200"), or null. */
export function quantityNumber(text) {
  const m = afterEquals(text).match(NUMBER);
  if (!m) return null;
  let n = m[0].replace(/,/g, '');
  if (n.endsWith('.')) n = n.slice(0, -1);
  if (n.startsWith('.')) n = '0' + n;
  else if (n.startsWith('-.')) n = '-0' + n.slice(1);
  return n === '' || n === '-' ? null : n;
}

/** Everything written apart from the number: the unit, as typed. */
export function quantityUnitText(text) {
  return afterEquals(text).replace(NUMBER, ' ').trim();
}

/**
 * What a unit is compared as. Lower case; ₱ is php; "per" is "/"; nothing
 * but letters, digits, / % $; one "/" at a time; a plural s dropped, so
 * "Bottles per order", "bottle/order" and "bottles / orders" are one unit.
 */
export function quantityUnitKey(unit) {
  return String(unit ?? '').toLowerCase()
    .replace(/₱/g, 'php')
    // A superscript is its digit: "kg/m³" is "kg/m3", not "kg/m" (sql/116).
    .replace(/¹/g, '1').replace(/²/g, '2').replace(/³/g, '3')
    .replace(/\bper\b/g, '/')
    .replace(/[^a-z0-9/%$]/g, '')
    .replace(/\/+/g, '/')
    .replace(/([a-z]*[a-rt-z])s(?![a-z])/g, '$1');
}

// Round half away from zero at `decimals` places, on the digits as written,
// so 1.005 rounds the way Postgres' round(numeric) does and not the way a
// float would. Returns [sign, scaled integer] to compare.
function roundedDigits(numberText, decimals) {
  const m = String(numberText).match(/^(-?)(\d*)(?:\.(\d*))?$/);
  if (!m) return null;
  const frac = (m[3] || '').padEnd(decimals + 1, '0').slice(0, decimals + 1);
  const all = BigInt((m[2] || '0') + frac);
  let q = all / 10n;
  if (all % 10n >= 5n) q += 1n;
  return [q === 0n ? '' : m[1], q];
}

/** Does the value written round, at the part's places, to the key? */
export function quantityValueOk(numberText, key, decimals) {
  if (numberText == null) return false;
  const d = /^\d+$/.test(String(decimals ?? '')) ? Math.min(10, Number(decimals)) : 0;
  const a = roundedDigits(numberText, d), b = roundedDigits(String(key), d);
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

/**
 * Is the value within the part's tolerance (sql/123)? Measured from the
 * unrounded key when the part has one: |typed − exact| ≤ ½·10^−decimals +
 * tolerance·|exact|. No tolerance, no change: false. Capped at 5%. Worked
 * in scaled integers so a value on the edge falls the way Postgres'
 * numeric does, not the way a float would.
 */
export function quantityValueNear(numberText, key, decimals, exact, tolerance) {
  const NUM = /^-?\d*\.?\d+$/;
  if (numberText == null || !/^-?\d*(\.\d*)?$/.test(String(numberText)) || !/\d/.test(String(numberText))) return false;
  const tolText = String(tolerance ?? '');
  if (!/^\d*\.?\d+$/.test(tolText) || Number(tolText) <= 0) return false;
  const ref = NUM.test(String(exact ?? '')) ? String(exact) : NUM.test(String(key ?? '')) ? String(key) : null;
  if (ref === null) return false;
  const d = /^\d+$/.test(String(decimals ?? '')) ? Math.min(10, Number(decimals)) : 0;
  const tol = tolText.length > 0 && Number(tolText) > 0.05 ? '0.05' : tolText;
  // Every quantity as an integer count of 10^-S, S large enough for all of them.
  const places = t => (String(t).split('.')[1] || '').length;
  const S = Math.max(places(numberText), places(ref), d + 1) + places(tol);
  const big = t => {
    const m = String(t).match(/^(-?)(\d*)(?:\.(\d*))?$/);
    const v = BigInt((m[2] || '0') + (m[3] || '').padEnd(S, '0').slice(0, S));
    return m[1] ? -v : v;
  };
  const abs = v => (v < 0n ? -v : v);
  const tolScaled = BigInt((tol.split('.')[0] || '0') + (tol.split('.')[1] || '').padEnd(places(tol), '0'));
  const tolPlaces = places(tol);
  // |n − ref|·10^tolPlaces ≤ ½·10^(S−d)·10^tolPlaces + tol·|ref|, all scaled by 10^S.
  const lhs = abs(big(numberText) - big(ref)) * 10n ** BigInt(tolPlaces);
  const half = 5n * 10n ** BigInt(S - d - 1) * 10n ** BigInt(tolPlaces);
  return lhs <= half + tolScaled * abs(big(ref));
}

/** Is the unit written one the part accepts? */
export function quantityUnitOk(unitText, accepted) {
  const mine = quantityUnitKey(unitText);
  return mine !== '' && (accepted || []).some(u => quantityUnitKey(u) !== '' && quantityUnitKey(u) === mine);
}

const marksOf = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);

/**
 * Mark the parts. A value earns its marks when it rounds to the key at the
 * part's places; a unit earns its marks when it is an accepted unit and a
 * number was written beside it. Never quotes the key.
 */
export function markQuantities(lines, rubric) {
  const typed = {};
  for (const line of lines || []) {
    const p = splitPartLine(line);
    if (p) typed[p.key] = p.text;
  }
  const parts = (Array.isArray(rubric?.parts) ? rubric.parts : []).map(part => {
    const text = typed[part.key] ?? '';
    const blank = !/\S/.test(text);
    const number = blank ? null : quantityNumber(text);
    const valueOk = quantityValueOk(number, part.value, part.decimals)
      || quantityValueNear(number, part.value, part.decimals, part.exact, part.tolerance);
    const unitOk = number !== null && quantityUnitOk(quantityUnitText(text), part.units);
    const marks = (valueOk ? marksOf(part.value_marks, 1) : 0) + (unitOk ? marksOf(part.unit_marks, 1) : 0);
    return { key: part.key, blank, value_ok: valueOk, unit_ok: unitOk, marks,
             of: marksOf(part.value_marks, 1) + marksOf(part.unit_marks, 1) };
  });
  const marks = parts.reduce((t, p) => t + p.marks, 0);
  const total = parts.reduce((t, p) => t + p.of, 0);
  return { marks, total, parts, reason: quantityReason(parts) };
}

/** One sentence per kind of slip, naming the parts. */
export function quantityReason(parts) {
  const list = pred => parts.filter(pred).map(p => p.key).join(', ');
  const blank = list(p => p.blank);
  const value = list(p => !p.blank && !p.value_ok);
  const unit = list(p => !p.blank && !p.unit_ok);
  const out = [];
  if (value) out.push(`Value wrong: ${value}.`);
  if (unit) out.push(`Unit wrong or missing: ${unit}.`);
  if (blank) out.push(`Left blank: ${blank}.`);
  return out.length ? out.join(' ') : 'Every value and unit right.';
}

/** Mark a quantity item as markAnswer() reports. */
export function markQuantityAnswer(lines, rubric) {
  const m = markQuantities(lines, rubric);
  const written = (lines || []).filter(l => /\S/.test(splitPartLine(l)?.text ?? ''));
  return {
    marks: m.marks, total: m.total, correct: m.total > 0 && m.marks >= m.total,
    blank: written.length === 0, answer: written.join('\n'), reason: m.reason, parts: m.parts,
  };
}
