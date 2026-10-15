// Propositional logic typed as maths: one statement on a line, read into a
// tree, and the marking of a proof by logical equivalence — the JS twin of
// sql/073. The dashboard re-marks with this, and saving there overwrites the
// database's mark, so the two must agree; sql/test/logic_proofs.test.mjs runs
// both over the same cases.
//
// Three rubric modes use it, all on a worked_solution row:
//
//   'logic'    one statement, right when it IS one of the accepted
//              statements — the same tree, however the connectives were
//              spelt (\land or \wedge, ~ or ¬, [ ] or ( )).
//   'simplify' one statement and the law used: a point for the result and a
//              point for a law that gives it (rubric: given, steps[-1] the
//              result, accept, result_marks, law_marks).
//   'proof'    a statement and its law on every line, from the given side to
//              the target (rubric: given, given_accept, steps[-1] the
//              target, key_steps). ANY correct route counts:
//                * each line must be equivalent to the one before it (a
//                  truth table) — the first that is not, or cannot be read,
//                  ends the work that counts;
//                * each line's law must give it from the line before it —
//                  applied once, or at several places, or two laws named
//                  together; each missing or wrong law costs 1 (a
//                  line that takes two laws and names neither costs 2);
//                * a line no one or two laws can give from the one before
//                  skips working, and ends the work that counts too.
//              Reaching the target: full marks less 1 for each missing or
//              wrong law. Not reaching it: 1 for each step with its law,
//              never more than the key's steps less one.
//
// A line holds the law after the statement, as `<statement>\qquad\text{(Law)}`
// — two laws as `\text{(Commutative, Identity)}` — so the shape stored for a
// worked answer ({ lines: [...] }) and everything that files, shows and
// exports it are unchanged, and KaTeX prints the law beside the line.

/** The laws a student may name, in the order the list offers them. */
export const LOGIC_LAWS = [
  { key: 'given', name: 'Given' },
  { key: 'commutative', name: 'Commutative' },
  { key: 'associative', name: 'Associative' },
  { key: 'distributive', name: 'Distributive' },
  { key: 'identity', name: 'Identity' },
  { key: 'complement', name: 'Complement', also: 'Negation' },
  { key: 'double_negation', name: 'Double Negation' },
  { key: 'idempotent', name: 'Idempotent' },
  { key: 'domination', name: 'Domination', also: 'Universal Bound' },
  { key: 'de_morgan', name: "De Morgan's" },
  { key: 'absorption', name: 'Absorption' },
  { key: 'implication', name: 'Implication', also: 'Conditional' },
  { key: 'biconditional', name: 'Biconditional' },
  { key: 'contrapositive', name: 'Contrapositive' },
];

const STEP_LAWS = LOGIC_LAWS.map(l => l.key).filter(k => k !== 'given');

// Other names a law goes by, reduced as lawKey() reduces a name.
const LAW_NAMES = {
  given: ['given', 'premise'],
  commutative: ['commutative', 'commutativity', 'commutation'],
  associative: ['associative', 'associativity', 'association'],
  distributive: ['distributive', 'distributivity', 'distribution'],
  identity: ['identity'],
  complement: ['complement', 'complements', 'negation', 'negations', 'inverse'],
  double_negation: ['doublenegation', 'doublenegative', 'involution'],
  idempotent: ['idempotent', 'idempotence', 'idempotency'],
  domination: ['domination', 'dominance', 'universalbound', 'universalbounds', 'null'],
  de_morgan: ['demorgan', 'demorgans'],
  absorption: ['absorption'],
  implication: ['implication', 'conditional', 'materialimplication'],
  biconditional: ['biconditional', 'equivalence'],
  contrapositive: ['contrapositive', 'contraposition', 'transposition'],
};

/**
 * Which law a name means, or null. Capitals, spaces, apostrophes and a
 * trailing "law"/"laws"/"property"/"rule" do not matter, nor a leading "law of".
 */
export function lawKey(name) {
  let s = String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  s = s.replace(/^(thelawof|lawof|the)/, '').replace(/(laws|law|property|rule)$/, '');
  for (const [key, names] of Object.entries(LAW_NAMES)) if (names.includes(s)) return key;
  return null;
}

const LAW_TAIL = /\\qquad\s*\\text\{\(([^{}]*)\)\}\s*$/;

/** A stored line as { statement, laws } — laws as the names written. */
export function splitLine(line) {
  const s = String(line ?? '');
  const m = s.match(LAW_TAIL);
  if (!m) return { statement: s.trim(), laws: [] };
  return {
    statement: s.slice(0, m.index).trim(),
    laws: m[1].split(',').map(v => v.trim()).filter(Boolean),
  };
}

/** The stored line for a statement and its laws. Nothing at all is ''. */
export function joinLine(statement, laws) {
  const st = String(statement ?? '').trim();
  const named = (laws || []).map(v => String(v ?? '').trim()).filter(Boolean);
  if (!named.length) return st;
  return `${st}\\qquad\\text{(${named.join(', ')})}`;
}

// ---------------------------------------------------------------------
// Reading a statement
// ---------------------------------------------------------------------

// Every spelling the maths keyboard, a phone or a desktop writes, in the
// order they must be replaced: \longleftrightarrow before \leftrightarrow
// before \rightarrow, \top before \to, arrows before \left and \right.
const SPELLINGS = [
  ['\\Longleftrightarrow', '='], ['\\longleftrightarrow', '='], ['\\Leftrightarrow', '='],
  ['\\leftrightarrow', '='], ['\\iff', '='],
  ['\\Longrightarrow', '>'], ['\\longrightarrow', '>'], ['\\Rightarrow', '>'],
  ['\\rightarrow', '>'], ['\\implies', '>'], ['\\supset', '>'],
  ['\\top', '⊤'], ['\\bot', '⊥'], ['\\to', '>'],
  ['\\land', '&'], ['\\wedge', '&'], ['\\&', '&'],
  ['\\lor', '|'], ['\\vee', '|'],
  ['\\lnot', '!'], ['\\neg', '!'], ['\\sim', '!'], ['\\~', '!'],
  ['\\lbrack', '('], ['\\rbrack', ')'], ['\\lparen', '('], ['\\rparen', ')'],
  ['\\lbrace', '('], ['\\rbrace', ')'],
  ['\\{', '('], ['\\}', ')'],
  ['\\bigl', ''], ['\\bigr', ''], ['\\Bigl', ''], ['\\Bigr', ''], ['\\big', ''], ['\\Big', ''],
  ['\\left', ''], ['\\right', ''],
  ['\\qquad', ''], ['\\quad', ''], ['\\,', ''], ['\\;', ''], ['\\:', ''], ['\\!', ''],
  ['\\ ', ''], ['\\space', ''],
  ['∧', '&'], ['∨', '|'], ['¬', '!'], ['~', '!'], ['→', '>'], ['⇒', '>'],
  ['↔', '='], ['⇔', '='], ['[', '('], [']', ')'],
];

/**
 * The statement with every spelling reduced to one character each —
 * & | ! > = ( ) for the connectives and brackets, ⊤ ⊥ for t and c — and
 * nothing else but letters; null if anything else is left. A leading ≡ is
 * the line's own, not the statement's, and is dropped.
 */
export function logicTokens(latex) {
  let s = String(latex ?? '');
  s = s.replace(/\\(?:text|mathrm|mathit|mathbf|mathsf|mathtt|textrm|textit|operatorname)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/^[\s{}]*(?:\\equiv|≡)/, '');
  for (const [from, to] of SPELLINGS) s = s.split(from).join(to);
  s = s.replace(/[\s{}]/g, '');
  if (s === '' || !/^[A-Za-z&|!>=()⊤⊥]+$/.test(s)) return null;
  return s;
}

// Longer than any statement a proof in this course needs; a longer one is
// not read, so no line can make marking a whole paper slow.
const MAX_TOKENS = 40;
const MAX_PROOF_LINES = 40;

const PREC = { '!': 4, '&': 3, '|': 2, '>': 1, '=': 0 };
const RIGHT = { '!': true, '>': true, '=': true };
const NODE = { '&': 'and', '|': 'or', '>': 'imp', '=': 'iff' };

/**
 * A statement as a tree, or null when it cannot be read: a letter is a
 * string ('p'), t and c are '1' and '0', and a connective is an array —
 * ['not', a], ['and', a, b], ['or', a, b], ['imp', a, b], ['iff', a, b].
 * ¬ binds tightest, then ∧, ∨, → and ↔; ∧ and ∨ group from the left, → and
 * ↔ from the right. t and T are true, c, C and F are false.
 */
export function parseLogic(latex) {
  const s = logicTokens(latex);
  if (s === null || s.length > MAX_TOKENS) return null;
  const out = [], ops = [];
  let operand = true;
  const apply = op => {
    if (op === '!') {
      if (out.length < 1) return false;
      out.push(['not', out.pop()]);
    } else {
      if (out.length < 2) return false;
      const b = out.pop(), a = out.pop();
      out.push([NODE[op], a, b]);
    }
    return true;
  };
  for (const c of s) {
    if (operand) {
      if (c === '!' || c === '(') ops.push(c);
      else if (/[A-Za-z⊤⊥]/.test(c)) {
        out.push(c === '⊤' || c === 't' || c === 'T' ? '1'
          : c === '⊥' || c === 'c' || c === 'C' || c === 'F' ? '0' : c);
        operand = false;
      } else return null;
    } else if (c === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') if (!apply(ops.pop())) return null;
      if (!ops.length) return null;
      ops.pop();
    } else if (c in NODE) {
      while (ops.length && ops[ops.length - 1] !== '(') {
        const top = ops[ops.length - 1];
        if (PREC[top] > PREC[c] || (PREC[top] === PREC[c] && !RIGHT[c])) {
          if (!apply(ops.pop())) return null;
        } else break;
      }
      ops.push(c);
      operand = true;
    } else return null;
  }
  if (operand) return null;
  while (ops.length) {
    const op = ops.pop();
    if (op === '(' || !apply(op)) return null;
  }
  return out.length === 1 ? out[0] : null;
}

const key = t => JSON.stringify(t);
const same = (a, b) => key(a) === key(b);

/** The letters in a statement, sorted. */
function letters(t, acc = new Set()) {
  if (typeof t === 'string') { if (t !== '1' && t !== '0') acc.add(t); }
  else for (let i = 1; i < t.length; i++) letters(t[i], acc);
  return acc;
}

// A statement's truth table as one number: bit r is its value on row r,
// where letter i is true on row r when bit i of r is set.
function truth(t, vars, rows, mask) {
  if (typeof t === 'string') {
    if (t === '1') return mask;
    if (t === '0') return 0;
    const i = vars.indexOf(t);
    let v = 0;
    for (let r = 0; r < rows; r++) if ((r >> i) & 1) v = (v | (1 << r)) >>> 0;
    return v >>> 0;
  }
  const a = truth(t[1], vars, rows, mask);
  if (t[0] === 'not') return (~a & mask) >>> 0;
  const b = truth(t[2], vars, rows, mask);
  switch (t[0]) {
    case 'and': return (a & b) >>> 0;
    case 'or': return (a | b) >>> 0;
    case 'imp': return ((~a | b) & mask) >>> 0;
    default: return ((~(a ^ b)) & mask) >>> 0;
  }
}

/**
 * Do two statements have the same truth table? null when it cannot be told
 * (more than five letters between them).
 */
export function logicEquivalent(a, b) {
  const vars = [...new Set([...letters(a), ...letters(b)])].sort();
  if (vars.length > 5) return null;
  const rows = 1 << vars.length;
  const mask = rows === 32 ? 0xFFFFFFFF : ((1 << rows) - 1) >>> 0;
  return truth(a, vars, rows, mask) === truth(b, vars, rows, mask);
}

// ---------------------------------------------------------------------
// The laws, as rewrites
// ---------------------------------------------------------------------

/** What a target holds, so a rewrite that BUILDS something is only tried when it could help. */
function features(t, f = { t: false, c: false, dn: false, idem: false }) {
  if (typeof t === 'string') {
    if (t === '1') f.t = true;
    if (t === '0') f.c = true;
    return f;
  }
  if (t[0] === 'not' && Array.isArray(t[1]) && t[1][0] === 'not') f.dn = true;
  if ((t[0] === 'and' || t[0] === 'or') && same(t[1], t[2])) f.idem = true;
  for (let i = 1; i < t.length; i++) features(t[i], f);
  return f;
}

const isOp = (t, op) => Array.isArray(t) && t[0] === op;

/** Every statement one use of `law` at the top of `n` gives. */
function rootRewrites(n, law, f) {
  const r = [];
  const bin = Array.isArray(n) && n.length === 3;
  switch (law) {
    case 'commutative':
      if (bin && (n[0] === 'and' || n[0] === 'or' || n[0] === 'iff')) r.push([n[0], n[2], n[1]]);
      break;
    case 'associative':
      for (const op of ['and', 'or']) {
        if (isOp(n, op) && isOp(n[1], op)) r.push([op, n[1][1], [op, n[1][2], n[2]]]);
        if (isOp(n, op) && isOp(n[2], op)) r.push([op, [op, n[1], n[2][1]], n[2][2]]);
      }
      break;
    case 'distributive':
      if (isOp(n, 'and') && isOp(n[2], 'or')) r.push(['or', ['and', n[1], n[2][1]], ['and', n[1], n[2][2]]]);
      if (isOp(n, 'or') && isOp(n[2], 'and')) r.push(['and', ['or', n[1], n[2][1]], ['or', n[1], n[2][2]]]);
      if (isOp(n, 'or') && isOp(n[1], 'and') && isOp(n[2], 'and') && same(n[1][1], n[2][1]))
        r.push(['and', n[1][1], ['or', n[1][2], n[2][2]]]);
      if (isOp(n, 'and') && isOp(n[1], 'or') && isOp(n[2], 'or') && same(n[1][1], n[2][1]))
        r.push(['or', n[1][1], ['and', n[1][2], n[2][2]]]);
      break;
    case 'identity':
      if (isOp(n, 'and') && n[2] === '1') r.push(n[1]);
      if (isOp(n, 'and') && n[1] === '1') r.push(n[2]);
      if (isOp(n, 'or') && n[2] === '0') r.push(n[1]);
      if (isOp(n, 'or') && n[1] === '0') r.push(n[2]);
      if (f.t) r.push(['and', n, '1'], ['and', '1', n]);
      if (f.c) r.push(['or', n, '0'], ['or', '0', n]);
      break;
    case 'complement':
      if (isOp(n, 'or') && isOp(n[2], 'not') && same(n[1], n[2][1])) r.push('1');
      if (isOp(n, 'or') && isOp(n[1], 'not') && same(n[1][1], n[2])) r.push('1');
      if (isOp(n, 'and') && isOp(n[2], 'not') && same(n[1], n[2][1])) r.push('0');
      if (isOp(n, 'and') && isOp(n[1], 'not') && same(n[1][1], n[2])) r.push('0');
      if (isOp(n, 'not') && n[1] === '1') r.push('0');
      if (isOp(n, 'not') && n[1] === '0') r.push('1');
      break;
    case 'double_negation':
      if (isOp(n, 'not') && isOp(n[1], 'not')) r.push(n[1][1]);
      if (f.dn) r.push(['not', ['not', n]]);
      break;
    case 'idempotent':
      if ((isOp(n, 'and') || isOp(n, 'or')) && same(n[1], n[2])) r.push(n[1]);
      if (f.idem) r.push(['and', n, n], ['or', n, n]);
      break;
    case 'domination':
      if (isOp(n, 'or') && (n[1] === '1' || n[2] === '1')) r.push('1');
      if (isOp(n, 'and') && (n[1] === '0' || n[2] === '0')) r.push('0');
      break;
    case 'de_morgan':
      if (isOp(n, 'not') && isOp(n[1], 'and')) r.push(['or', ['not', n[1][1]], ['not', n[1][2]]]);
      if (isOp(n, 'not') && isOp(n[1], 'or')) r.push(['and', ['not', n[1][1]], ['not', n[1][2]]]);
      if (isOp(n, 'or') && isOp(n[1], 'not') && isOp(n[2], 'not')) r.push(['not', ['and', n[1][1], n[2][1]]]);
      if (isOp(n, 'and') && isOp(n[1], 'not') && isOp(n[2], 'not')) r.push(['not', ['or', n[1][1], n[2][1]]]);
      break;
    case 'absorption':
      if (isOp(n, 'or') && isOp(n[2], 'and') && same(n[1], n[2][1])) r.push(n[1]);
      if (isOp(n, 'and') && isOp(n[2], 'or') && same(n[1], n[2][1])) r.push(n[1]);
      break;
    case 'implication':
      if (isOp(n, 'imp')) r.push(['or', ['not', n[1]], n[2]]);
      if (isOp(n, 'or') && isOp(n[1], 'not')) r.push(['imp', n[1][1], n[2]]);
      break;
    case 'biconditional':
      if (isOp(n, 'iff')) r.push(['and', ['imp', n[1], n[2]], ['imp', n[2], n[1]]]);
      if (isOp(n, 'and') && isOp(n[1], 'imp') && isOp(n[2], 'imp')
          && same(n[1][1], n[2][2]) && same(n[1][2], n[2][1])) r.push(['iff', n[1][1], n[1][2]]);
      break;
    case 'contrapositive':
      if (isOp(n, 'imp')) r.push(['imp', ['not', n[2]], ['not', n[1]]]);
      if (isOp(n, 'imp') && isOp(n[1], 'not') && isOp(n[2], 'not')) r.push(['imp', n[2][1], n[1][1]]);
      break;
    default:
  }
  return r;
}

/** Every statement one use of one of `laws`, anywhere in `n`, gives. Exported for the twin test. */
export function rewrites(n, laws, f) {
  const out = [];
  for (const law of laws) out.push(...rootRewrites(n, law, f));
  if (Array.isArray(n)) {
    for (let i = 1; i < n.length; i++) {
      for (const c of rewrites(n[i], laws, f)) {
        const m = n.slice(); m[i] = c; out.push(m);
      }
    }
  }
  return out;
}

// How many different statements one level of a search may hold before it
// gives up. A level is a SET, so where the search stops never depends on the
// order rewrites are tried in, and the database stops at the same place.
const SEARCH_WIDTH = 300;

/**
 * Can `b` be reached from `a` by at most `depth` uses of `laws`? Level by
 * level: every statement one more use away, the ones already seen dropped.
 * `b` is looked for once a level is complete, and a level wider than
 * SEARCH_WIDTH ends the search — so a pasted line too long to search cannot
 * make a paper slow to mark, and both sides give up at the same point.
 */
function reachable(a, b, laws, depth, f) {
  const goal = key(b);
  const seen = new Set([key(a)]);
  let frontier = [a];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next = [];
    for (const st of frontier) {
      for (const r of rewrites(st, laws, f)) {
        const k = key(r);
        if (!seen.has(k)) { seen.add(k); next.push(r); }
      }
    }
    if (seen.has(goal)) return true;
    if (next.length > SEARCH_WIDTH) return false;
    frontier = next;
  }
  return false;
}

/**
 * Does `b` follow from `a` by the laws named? Where the two differ in
 * several places, each place is judged on its own, so a law used at two
 * places at once (¬¬r ∧ ¬¬u to r ∧ u) counts.
 */
export function stepFollows(a, b, laws, depth = 3) {
  if (same(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a.length === b.length
      && a.slice(1).every((c, i) => stepFollows(c, b[i + 1], laws, depth))) return true;
  return reachable(a, b, laws, depth, features(b));
}

/** Do the laws named give `b` from `a`? */
function lawsGive(a, b, keys) {
  const ks = keys.filter(k => k && k !== 'given');
  return ks.length > 0 && stepFollows(a, b, ks, 3);
}

/** Could any one or two laws give `b` from `a` — a step, not a leap? */
function isAStep(a, b) {
  return stepFollows(a, b, STEP_LAWS, 2);
}

/** How many laws a step is short of (1 or 2), for a step isAStep() allows. */
function lawsShort(a, b, keys) {
  const named = keys.filter(k => k && k !== 'given');
  return STEP_LAWS.some(k => stepFollows(a, b, [...named, k], 2)) ? 1 : 2;
}

// ---------------------------------------------------------------------
// Marking
// ---------------------------------------------------------------------

/** Is this rubric (or a work_mode string) one of the logic modes? */
export function isLogicMode(rubricOrMode) {
  const m = typeof rubricOrMode === 'string' ? rubricOrMode : rubricOrMode?.mode;
  return m === 'logic' || m === 'simplify' || m === 'proof';
}

/** The statements a rubric accepts as its answer: the last step, then the accept list. */
function acceptedTrees(rubric) {
  const steps = Array.isArray(rubric?.steps) ? rubric.steps : [];
  return [steps[steps.length - 1]?.latex, ...(Array.isArray(rubric?.accept) ? rubric.accept : [])]
    .map(v => parseLogic(v)).filter(Boolean);
}

function itemTotal(rubric) {
  const stated = Number(rubric?.marks);
  if (Number.isFinite(stated) && stated > 0) return stated;
  const steps = Array.isArray(rubric?.steps) ? rubric.steps : [];
  return Number(steps[steps.length - 1]?.marks) || 1;
}

const plural = (n, one, many) => (n === 1 ? one : many);
const lineList = ns => (ns.length === 1 ? `line ${ns[0]}`
  : `lines ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`);

/**
 * Mark a logic item. `lines` are as stored; blank ones are dropped as the
 * database drops them. Returns { marks, of, correct, reason, lineSteps },
 * lineSteps[i] being 1 for a line that counted and null otherwise. The
 * reason never quotes the key.
 */
export function markLogic(lines, rubric) {
  const of = itemTotal(rubric);
  const work = (lines || []).map(l => String(l ?? '')).filter(l => l.trim() !== '');
  const mode = rubric?.mode;
  const done = (marks, reason, lineSteps = work.map(() => null)) => ({
    marks: Math.max(0, Math.min(marks, of)), of, correct: marks >= of && of > 0, reason, lineSteps,
  });
  const parts = work.map(splitLine);
  const written = parts.map((p, i) => ({ ...p, i })).filter(p => p.statement !== '');
  if (written.length === 0) return done(0, 'Nothing was written.');

  if (mode === 'logic') {
    const last = written[written.length - 1];
    const t = parseLogic(last.statement);
    if (!t) return done(0, 'The answer could not be read as a statement.');
    const ok = acceptedTrees(rubric).some(a => same(a, t));
    const ls = work.map(() => null); if (ok) ls[last.i] = 1;
    return done(ok ? of : 0, ok ? 'Correct answer.' : 'Not an accepted answer.', ls);
  }

  const given = parseLogic(rubric?.given);
  const targets = acceptedTrees(rubric);
  if (!given || targets.length === 0) return done(0, 'This question has no answer key.');

  if (mode === 'simplify') {
    const last = written[written.length - 1];
    const t = parseLogic(last.statement);
    const resultMarks = Number(rubric?.result_marks ?? 1) || 0;
    const lawMarks = Number(rubric?.law_marks ?? 1) || 0;
    const resultOk = !!t && targets.some(a => same(a, t));
    const lawOk = lawsGive(given, targets[0], last.laws.map(lawKey));
    const ls = work.map(() => null); if (resultOk) ls[last.i] = 1;
    const marks = (resultOk ? resultMarks : 0) + (lawOk ? lawMarks : 0);
    const reason = resultOk && lawOk ? 'Correct result and law.'
      : resultOk ? (last.laws.length ? 'The result is right; the law named does not give it.' : 'The result is right; the law is missing.')
        : lawOk ? (t ? 'The law is right; the result is not simplified correctly.' : 'The law is right; the result could not be read as a statement.')
          : !t ? 'The result could not be read as a statement.' : 'Neither the result nor the law is right.';
    return done(marks, reason, ls);
  }

  // A proof.
  const starts = [given, ...(Array.isArray(rubric?.given_accept) ? rubric.given_accept : [])
    .map(v => parseLogic(v)).filter(Boolean)];
  const keySteps = Math.max(1, Number(rubric?.key_steps) || 1);
  const ls = work.map(() => null);
  let prev = given, right = 0, missing = 0, reached = same(given, targets[0]);
  const wrongAt = [], earlier = [key(given)];
  let stop = null;
  // Forty lines is far longer than any proof here; past that nothing is read.
  for (let w = 0; w < Math.min(written.length, MAX_PROOF_LINES) && !reached; w++) {
    const { statement, laws, i } = written[w];
    const n = i + 1; // the line number the student sees
    const t = parseLogic(statement);
    if (!t) { stop = `Line ${n} could not be read as a statement, so the work stops counting there.`; break; }
    if (w === 0 && starts.some(s => same(s, t))) {
      ls[i] = 1; prev = t; earlier.push(key(t));
      continue;
    }
    if (same(t, prev)) continue;
    const eq = logicEquivalent(prev, t);
    if (eq !== true) {
      stop = `Line ${n} is not equivalent to the line before it, so the work stops counting there.`;
      break;
    }
    const repeat = earlier.includes(key(t));
    const keys = laws.map(lawKey);
    if (lawsGive(prev, t, keys)) {
      if (!repeat) { right++; ls[i] = 1; }
    } else if (isAStep(prev, t)) {
      // A step needing two laws costs 1 for each one not named: 1 when one
      // more law beside those named would give it, 2 when it takes two.
      if (!repeat) { wrongAt.push(n); missing += lawsShort(prev, t, keys); }
    } else {
      stop = `Line ${n} does not follow from the line before it by one or two laws: write each step on its own line.`;
      break;
    }
    prev = t; earlier.push(key(t));
    if (targets.some(a => same(a, t))) reached = true;
  }

  const partial = Math.min(right, keySteps - 1, of - 1);
  const lawNote = wrongAt.length === 1
    ? ` The law on ${lineList(wrongAt)} is missing or does not give that step.`
    : wrongAt.length ? ` The laws on ${lineList(wrongAt)} are missing or do not give those steps.` : '';
  if (reached) {
    const marks = Math.max(of - missing, partial, 0);
    return done(marks, missing
      ? `Proved, but ${missing} ${plural(missing, 'law is', 'laws are')} missing or wrong.${lawNote}`
      : 'Proved, with a law for every step.', ls);
  }
  return done(Math.max(partial, 0),
    `${stop || 'The proof does not reach the statement it has to reach.'}${lawNote}`, ls);
}
