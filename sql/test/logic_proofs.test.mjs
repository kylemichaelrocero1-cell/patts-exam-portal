// sql/073: propositional logic read into trees, and proofs by logical
// equivalence marked line by line.
//
//   * logic_parse() and its JS twin (src/lib/logicProof.js) read every
//     spelling of every connective into the same tree, and refuse the same
//     nonsense;
//   * truth tables, law steps and whole proofs get the same verdict, the
//     same marks, the same reason and the same ticks on both sides;
//   * the marks follow the scheme: full for a proof reached with every law,
//     less 1 a missing or wrong law, credit for the steps before a line
//     that is not equivalent, unread or a leap;
//   * a whole sitting through submit_assessment() marks the three modes and
//     leaves every other item as it was; the review shows the lines and the
//     ticks; the exam screen learns each item's mode and nothing of its key;
//   * marking a sitting stays far inside the 20 s a request is allowed;
//   * 073 runs twice, and its VERIFY row is all true;
//   * 076: a step that takes two laws is a step however often each is used,
//     so naming one of them costs 1, not the rest of the proof; a line
//     written as an equation (≡ or =) is the statement it ends on; 077
//     re-marks what was submitted before, raise-only.
//
// Look-alike items only — never a real paper's.
//
//   npm run test:logic-proofs
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLogic, logicTokens, logicEquivalent, stepFollows, markLogic, joinLine, splitLine, lawKey,
         rewrites, isLogicMode, LOGIC_LAWS } from '../../src/lib/logicProof.js';
import { markAnswer } from '../../src/lib/workedSolution.js';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const asAnon = async (sql, params) => {
  try { await x(`SET ROLE anon`); return { ok: true, rows: await q(sql, params) }; }
  catch (e) { return { ok: false, message: e.message || String(e) }; }
  finally { await x(`RESET ROLE`); }
};

await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;`);
const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);
await x(setup.match(/ALTER TABLE public\.\w+\s+ENABLE ROW LEVEL SECURITY;/g).join('\n'));
await x(setup.match(/^(DROP POLICY IF EXISTS|CREATE POLICY)[\s\S]*?;/gm).filter(s => !/storage\./.test(s)).join('\n'));
await x(setup.match(/CREATE OR REPLACE FUNCTION public\.verify_exam_password[\s\S]*?END; \$\$;/)[0]);
await x(setup.match(/^(GRANT|REVOKE)[\s\S]*?;/gm).filter(g => /public\./.test(g) && !/storage|FUNCTION/.test(g)).join('\n'));

const INS = 'd24df77e-309a-4ed8-988f-da3ee1c76408';
const STU = '11111111-1111-1111-1111-111111111111';
const TOK = 'f0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1a';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.users (id, full_name, section, session_token)
  VALUES ('${STU}','S One','AERO 101','${TOK}');`);
for (const f of ['001_assessments_and_lessons', '002_review_mode_and_server_scoring',
  '003_lock_answer_key', '012_five_option_items', '002b_grant_new_columns',
  '015_archive_assessments', '016_unlimited_choices', '017_shuffle_questions_switch',
  '018_multi_select_items', '019_exam_password_on_assessments',
  '020_exam_content_behind_the_gate', '021_revoke_direct_question_reads',
  '022_answer_review_needs_identity', '023_drop_unidentified_answer_review',
  '024_worked_solution_items', '025_points_per_item',
  '026_worked_answers_are_saved_and_scored', '027_score_worked_in_the_database',
  '028_worked_items_in_answer_review', '029_guarded_review_shows_worked_items',
  '030_primes_as_the_editor_writes_them', '031_any_function_name_is_a_subject',
  '032_a_label_is_part_of_the_answer', '033_a_minus_may_sit_on_the_numerator',
  '036_four_primes_and_brackets', '037_keyboard_leftovers', '038_any_arrow_is_to',
  '039_submit_files_the_working', '042_working_marked_line_by_line',
  '043_partial_working_earns_more', '045_brackets_that_change_nothing',
  '046_answers_typed_as_words', '050_answers_as_the_keyboard_spells_them',
  '053_marking_fast_again', '058_keyboard_spellings_fast', '061_minus_out_of_a_bracket',
  '066_times_between_numbers_and_zero_terms', '071_the_keyboards_e_is_e']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

console.log('\n=== 073 applies ===');
const M073 = fs.readFileSync(P + '/sql/073_logic_proofs_line_by_line.sql', 'utf8');
await x(M073);
await x(M073);
ck('073 applies, twice', true);
{
  const [v] = await q(M073.slice(M073.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim());
  ck('073\'s VERIFY row is all true', Object.values(v).every(b => b === true), JSON.stringify(v));
}
console.log('\n=== 076 applies ===');
const M076 = fs.readFileSync(P + '/sql/076_two_law_steps_and_equations.sql', 'utf8');
await x(M076);
await x(M076);
ck('076 applies, twice', true);
{
  const [v] = await q(M076.slice(M076.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim());
  const flags = Object.entries(v).filter(([k]) => k !== 'sittings_with_logic_items');
  ck('076\'s VERIFY row is all true', flags.every(([, b]) => b === true), JSON.stringify(v));
}
{
  const r = await asAnon(`SELECT public.logic_mark('[]'::jsonb, '{}'::jsonb)`);
  ck('the proof marker is not callable from a browser', !r.ok, JSON.stringify(r.rows));
}

const sqlParse = async s => (await q(`SELECT public.logic_parse($1) AS t`, [s]))[0].t;
const J = v => JSON.stringify(v);

console.log('\n=== reading a statement: every spelling, both sides ===');
const ALIKE = [
  ['\\neg(r\\land s)', ['\\sim(r\\wedge s)', '\\lnot(r\\land s)', '\\~(r\\land s)', '¬(r ∧ s)', '~(r&s)',
    '\\neg\\left(r\\land s\\right)', '\\neg\\lbrack r\\land s\\rbrack', '\\neg[r\\land s]', '\\neg\\{r\\land s\\}',
    '\\equiv\\neg(r\\land s)', '≡ ¬(r∧s)', '{\\neg}{(r\\land s)}', '\\neg\\,(r\\;\\land\\: s)', '\\neg\\bigl(r\\land s\\bigr)',
    '\\neg\\lparen r\\land s\\rparen', '\\neg\\lbrace r \\land s\\rbrace']],
  ['r\\to s', ['r\\rightarrow s', 'r\\Rightarrow s', 'r\\implies s', 'r\\longrightarrow s', 'r → s', 'r ⇒ s',
    'r\\Longrightarrow s', 'r\\supset s']],
  ['r\\leftrightarrow s', ['r\\iff s', 'r\\Leftrightarrow s', 'r\\longleftrightarrow s', 'r ↔ s', 'r⇔s',
    'r\\Longleftrightarrow s']],
  ['r\\lor t', ['r\\vee T', 'r\\lor\\top', 'r\\lor\\mathrm{T}', 'r\\lor\\text{t}', 'r ∨ t']],
  ['s\\land c', ['s\\wedge C', 's\\land F', 's\\land\\bot', 's\\land\\mathrm{F}', 's\\land\\operatorname{c}']],
  // A line written as an equation is the statement it ends on (076).
  ['r\\land s', ['s\\land r\\equiv r\\land s', 's\\land r=r\\land s', '(r\\land s)\\lor c\\equiv r\\land s', '≡ s ∧ r ≡ r ∧ s',
    '\\equiv r\\land s\\equiv', 'r\\land s=', '\\neg\\neg r\\land s=r\\land s\\equiv r\\land s']],
  ['t', ['(s\\land u)\\lor\\neg(s\\land u)\\equiv t', '\\sim u\\lor u=T', '\\equiv u\\lor\\neg u\\equiv\\top']],
];
for (const [base, forms] of ALIKE) {
  const want = parseLogic(base);
  ck(`${base} reads (JS)`, want !== null, J(want));
  ck(`${base} reads alike in the database`, J(await sqlParse(base)) === J(want));
  let agree = 0, bad = null;
  for (const f of forms) {
    const js = parseLogic(f), sq = await sqlParse(f);
    if (J(js) === J(want) && J(sq) === J(want)) agree++; else if (!bad) bad = { f, js, sq };
  }
  ck(`all ${forms.length} spellings of ${base} read as one tree on both sides`, agree === forms.length, J(bad));
}
{
  const t = parseLogic('\\neg r\\land s\\lor u\\to r\\leftrightarrow s');
  ck('¬ binds tightest, then ∧, ∨, →, ↔', J(t) === J(['iff', ['imp', ['or', ['and', ['not', 'r'], 's'], 'u'], 'r'], 's']), J(t));
  ck('∧ and ∨ group from the left', J(parseLogic('r\\lor s\\lor u')) === J(['or', ['or', 'r', 's'], 'u']));
  ck('→ groups from the right', J(parseLogic('r\\to s\\to u')) === J(['imp', 'r', ['imp', 's', 'u']]));
  ck('¬¬ stacks', J(parseLogic('\\neg\\neg r')) === J(['not', ['not', 'r']]));
}
const NONSENSE = ['', '   ', 'r s', 'rs', 'r\\land', '\\land r', '(r\\lor s', 'r\\lor s)', '()', 'r()', '1', 'r\\lor 0',
  'x^2', '\\frac{r}{s}', 'r=s=', '\\placeholder{}', 'r\\lor\\placeholder{}', 'r \\equiv s', 'r\\neg s', 'r\\leftarrow s',
  '\\neg', '((r))\\land', 'r'.repeat(1) + '\\land r'.repeat(40),
  // An equation whose sides are not equivalent is a false line (076).
  'r\\lor\\neg r\\equiv c', 'r=s', 'r\\land s\\equiv r\\lor s', 'r\\equiv\\equiv r', '\\equiv', '='];
{
  let agree = 0, bad = null;
  for (const n of NONSENSE) {
    const js = parseLogic(n), sq = await sqlParse(n);
    if (js === null && sq === null) agree++; else if (!bad) bad = { n, js, sq };
  }
  ck(`all ${NONSENSE.length} unreadable lines are refused on both sides`, agree === NONSENSE.length, J(bad));
  ck('a statement with brackets that change nothing reads the same', J(parseLogic('((r))\\land(s)')) === J(parseLogic('r\\land s')));
}

// Random statements, spelt at random, for the corpus checks below.
let seed = 20261015;
const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const LETTERS = ['r', 's', 'u'];
const tree = d => {
  if (d === 0 || rnd(3) === 0) { const k = rnd(8); return k === 6 ? '1' : k === 7 ? '0' : LETTERS[k % 3]; }
  const k = rnd(6);
  if (k === 0) return ['not', tree(d - 1)];
  return [['and', 'or', 'and', 'or', 'imp'][k - 1], tree(d - 1), tree(d - 1)];
};
const SP = { and: ['\\land', '\\wedge', '∧'], or: ['\\lor', '\\vee', '∨'], not: ['\\neg', '\\sim', '¬', '\\lnot'],
  imp: ['\\to', '\\rightarrow', '→'], iff: ['\\leftrightarrow', '\\iff'], 1: ['t', 'T', '\\top'], 0: ['c', 'F', 'C'] };
const pick = a => a[rnd(a.length)];
const spell = t => {
  if (typeof t === 'string') return t === '1' || t === '0' ? pick(SP[t]) : t;
  if (t[0] === 'not') return `${pick(SP.not)} ${typeof t[1] === 'string' || t[1][0] === 'not' ? spell(t[1]) : `(${spell(t[1])})`}`;
  const [l, r] = rnd(2) ? ['(', ')'] : ['\\lbrack ', '\\rbrack '];
  const side = c => (typeof c === 'string' || c[0] === 'not' ? spell(c) : `${l}${spell(c)}${r}`);
  return `${side(t[1])} ${pick(SP[t[0]])} ${side(t[2])}`;
};
const TREES = Array.from({ length: 160 }, () => tree(3));

{
  let agree = 0, bad = null;
  for (const t of TREES) {
    // A statement past the length limit is refused on both sides instead.
    const s = spell(t), js = parseLogic(s), sq = await sqlParse(s);
    const want = logicTokens(s).length <= 40 ? t : null;
    if (J(js) === J(want) && J(sq) === J(want)) agree++; else if (!bad) bad = { s, t, js, sq };
  }
  ck(`160 random statements, spelt at random, read back as written on both sides`, agree === TREES.length, J(bad));
}

console.log('\n=== truth tables ===');
{
  let agree = 0, n = 0, bad = null, same = 0;
  for (let i = 0; i + 1 < TREES.length; i += 2) {
    for (const [a, b] of [[TREES[i], TREES[i + 1]], [TREES[i], TREES[i]], [TREES[i], ['not', ['not', TREES[i]]]]]) {
      n++;
      const js = logicEquivalent(a, b);
      const [{ v }] = await q(`SELECT public.logic_equivalent($1::jsonb, $2::jsonb) AS v`, [J(a), J(b)]);
      if (js === v) agree++; else if (!bad) bad = { a, b, js, v };
      if (js) same++;
    }
  }
  ck(`logic_equivalent and its twin agree on all ${n} pairs (${same} equivalent)`, agree === n, J(bad));
  ck('p → q is ¬p ∨ q; the converse is not', logicEquivalent(parseLogic('r\\to s'), parseLogic('\\neg r\\lor s'))
    && !logicEquivalent(parseLogic('r\\to s'), parseLogic('s\\to r')));
  ck('a tautology is t; a contradiction is c', logicEquivalent(parseLogic('r\\lor\\neg r'), '1')
    && logicEquivalent(parseLogic('r\\land\\neg r'), '0'));
  ck('six letters cannot be told', logicEquivalent(parseLogic('r\\land s\\land u\\land v\\land w\\land z'), 'r') === null);
}

console.log('\n=== law steps: both sides agree ===');
const STEP_LAWS = LOGIC_LAWS.map(l => l.key).filter(k => k !== 'given');
{
  let agree = 0, n = 0, bad = null, yes = 0;
  for (let i = 0; i < 60; i++) {
    const a = TREES[i];
    const one = rewrites(a, STEP_LAWS, { t: true, c: true, dn: false, idem: false });
    const cands = [one[rnd(one.length || 1)], TREES[i + 60], a].filter(Boolean);
    if (one.length) {
      const two = rewrites(one[rnd(one.length)], STEP_LAWS, { t: false, c: false, dn: false, idem: false });
      if (two.length) cands.push(two[rnd(two.length)]);
    }
    for (const b of cands) {
      for (const laws of [[STEP_LAWS[rnd(13)]], [STEP_LAWS[rnd(13)], STEP_LAWS[rnd(13)]], STEP_LAWS]) {
        n++;
        const depth = laws.length === 13 ? 2 : 3;
        const js = stepFollows(a, b, laws, depth);
        const [{ v }] = await q(`SELECT public.logic_step_follows($1::jsonb, $2::jsonb, $3::text[], $4) AS v`,
          [J(a), J(b), laws, depth]);
        if (js === v) agree++; else if (!bad) bad = { a, b, laws, js, v };
        if (js) yes++;
      }
    }
  }
  ck(`logic_step_follows and its twin agree on all ${n} steps (${yes} follow)`, agree === n, J(bad));
}
const step = (a, b, laws) => stepFollows(parseLogic(a), parseLogic(b), laws);
const STEPS = [
  ['¬(r ∧ s)', '¬r ∨ ¬s', ['de_morgan'], true],
  ['¬r ∨ ¬s', '¬(r ∧ s)', ['de_morgan'], true],
  ['¬(r ∧ s)', '¬r ∨ ¬s', ['distributive'], false],
  ['¬¬r ∧ ¬¬u', 'r ∧ u', ['double_negation'], true],          // at two places at once
  ['r ∧ (s ∨ u)', '(r ∧ s) ∨ (r ∧ u)', ['distributive'], true],
  ['(r ∧ s) ∨ (r ∧ u)', 'r ∧ (s ∨ u)', ['distributive'], true], // factored back
  ['(s ∨ u) ∧ r', '(s ∧ r) ∨ (u ∧ r)', ['distributive'], false], // the book's form only
  ['(s ∨ u) ∧ r', '(r ∧ s) ∨ (r ∧ u)', ['commutative', 'distributive'], true],
  ['s ∧ t', 's', ['identity'], true],
  ['t ∧ s', 's', ['identity'], true],                          // either order, as the book does
  ['c ∨ s', 's', ['identity'], true],
  ['s', 's ∧ t', ['identity'], true],
  ['¬s ∨ s', 't', ['complement'], true],
  ['s ∧ ¬s', 'c', ['complement'], true],
  ['¬t', 'c', ['complement'], true],
  ['s ∨ t', 't', ['domination'], true],
  ['s ∧ c', 'c', ['domination'], true],
  ['s ∨ t', 't', ['identity'], false],
  ['r ∨ (r ∧ s)', 'r', ['absorption'], true],
  ['r ∧ (r ∨ s)', 'r', ['absorption'], true],
  ['r ∨ r', 'r', ['idempotent'], true],
  ['r → s', '¬r ∨ s', ['implication'], true],
  ['¬r ∨ s', 'r → s', ['implication'], true],
  ['r → s', '¬s → ¬r', ['contrapositive'], true],
  ['r ↔ s', '(r → s) ∧ (s → r)', ['biconditional'], true],
  ['(r ∨ s) ∨ u', 'r ∨ (s ∨ u)', ['associative'], true],
  ['(u ∧ ¬s) ∧ s', '(¬s ∧ s) ∧ u', ['commutative', 'associative'], true],
  ['(u ∧ ¬s) ∧ s', '(¬s ∧ s) ∧ u', ['associative'], false],
  ['¬(¬r ∧ u)', 'r ∨ ¬u', ['de_morgan', 'double_negation'], true],
  ['¬(¬r ∧ u)', 'r ∨ ¬u', ['de_morgan'], false],
];
for (const [a, b, laws, want] of STEPS) {
  const js = step(a, b, laws);
  const [{ v }] = await q(`SELECT public.logic_step_follows(public.logic_parse($1), public.logic_parse($2), $3::text[]) AS v`, [a, b, laws]);
  ck(`${a} ⟶ ${b} by ${laws.join(' + ')}: ${want ? 'follows' : 'does not'}`, js === want && v === want, `js ${js}, sql ${v}`);
}

console.log('\n=== law names ===');
{
  const NAMES = [["De Morgan's", 'de_morgan'], ['DeMorgans law', 'de_morgan'], ['de morgan’s laws', 'de_morgan'],
    ['Double Negation', 'double_negation'], ['double negative law', 'double_negation'], ['Complement', 'complement'],
    ['Negation Law', 'complement'], ['Universal Bound', 'domination'], ['Law of Identity', 'identity'],
    ['commutative property', 'commutative'], ['Conditional', 'implication'], ['Given', 'given'], ['Domination', 'domination'],
    ['Distribution', 'distributive'], ['', null], ['Magic', null], ['Associative Laws', 'associative']];
  let agree = 0, bad = null;
  for (const [n, k] of NAMES) {
    const [{ v }] = await q(`SELECT public.logic_law_key($1) AS v`, [n]);
    if (lawKey(n) === k && v === k) agree++; else if (!bad) bad = { n, k, js: lawKey(n), v };
  }
  ck(`all ${NAMES.length} law names read alike on both sides`, agree === NAMES.length, J(bad));
  ck('every law the list offers has a key', LOGIC_LAWS.every(l => lawKey(l.name) === l.key));
  const line = joinLine('r\\lor s', ['Commutative', 'Identity']);
  ck('a line keeps its laws', J(splitLine(line)) === J({ statement: 'r\\lor s', laws: ['Commutative', 'Identity'] }), line);
  const [{ s, l }] = await q(`SELECT public.logic_line_statement($1) AS s, public.logic_line_laws($1) AS l`, [line]);
  ck('…and the database splits it the same way', s === 'r\\lor s' && J(l) === J(['Commutative', 'Identity']), J({ s, l }));
  ck('a line with no law is just its statement', joinLine(' r ', []) === 'r' && splitLine('r').laws.length === 0);
  ck('a law with no statement is kept, and reads as no statement', splitLine(joinLine('', ['Identity'])).statement === '');
}

console.log('\n=== proofs: marks, reasons and ticks agree ===');
const L = (s, ...laws) => joinLine(s, laws);
const PA = { mode: 'proof', given: '\\neg(r\\land\\neg s)', steps: [{ latex: '\\neg r\\lor s', marks: 3 }], marks: 3, key_steps: 2 };
const PB = { mode: 'proof', given: 'r\\land(\\neg r\\lor s)', steps: [{ latex: 'r\\land s', marks: 5 }], marks: 5, key_steps: 4 };
const PC = { mode: 'proof', given: '[(r\\lor s)\\land\\neg r]\\to s', given_accept: ['[\\neg r\\land(r\\lor s)]\\to s'],
  steps: [{ latex: 't', marks: 6 }], marks: 6, key_steps: 6 };
const SIMP = { mode: 'simplify', given: '(r\\land s)\\lor c', steps: [{ latex: 'r\\land s', marks: 2 }], accept: ['s\\land r'], marks: 2 };
const ONE = { mode: 'logic', steps: [{ latex: 's\\to r', marks: 1 }], marks: 1 };
const PB_KEY = [L('r\\land(\\neg r\\lor s)', 'Given'), L('\\equiv(r\\land\\neg r)\\lor(r\\land s)', 'Distributive'),
  L('\\equiv c\\lor(r\\land s)', 'Complement'), L('\\equiv(r\\land s)\\lor c', 'Commutative'), L('\\equiv r\\land s', 'Identity')];
const PC_KEY = [L('[(r\\lor s)\\land\\neg r]\\to s', 'Given'), L('\\neg[(r\\lor s)\\land\\neg r]\\lor s', 'Implication'),
  L('[\\neg(r\\lor s)\\lor\\neg\\neg r]\\lor s', "De Morgan's"), L('[\\neg(r\\lor s)\\lor r]\\lor s', 'Double Negation'),
  L('\\neg(r\\lor s)\\lor(r\\lor s)', 'Associative'), L('t', 'Complement')];
const CASES = [
  // [name, rubric, lines, marks]
  ['A by the key', PA, [L('\\neg(r\\land\\neg s)', 'Given'), L('\\neg r\\lor\\neg\\neg s', "De Morgan's"), L('\\neg r\\lor s', 'Double Negation')], 3],
  ['A without restating the given', PA, [L('\\neg r\\lor\\neg\\neg s', "De Morgan's"), L('\\neg r\\lor s', 'Double Negation')], 3],
  ['A with two laws on one line', PA, [L('\\neg r\\lor s', "De Morgan's", 'Double Negation')], 3],
  ['A with one of two laws named', PA, [L('\\neg r\\lor s', "De Morgan's")], 2],
  ['A with a wrong law', PA, [L('\\neg r\\lor\\neg\\neg s', 'Distributive'), L('\\neg r\\lor s', 'Double Negation')], 2],
  ['A with no laws', PA, ['\\neg r\\lor\\neg\\neg s', '\\neg r\\lor s'], 1],
  ['A stopped half way', PA, [L('\\neg r\\lor\\neg\\neg s', "De Morgan's")], 1],
  ['A with a wrong line', PA, [L('\\neg r\\lor\\neg\\neg s', "De Morgan's"), L('r\\lor s', 'Double Negation')], 1],
  ['A with an unreadable line', PA, [L('\\neg r\\lor\\neg\\neg s', "De Morgan's"), L('\\neg r\\lor', 'Double Negation')], 1],
  ['A answer alone, with neither of its two laws', PA, [L('\\neg r\\lor s', 'Identity')], 1],
  ['A blank', PA, [], 0],
  ['A law with no statement is ignored', PA, [L('', 'Identity'), L('\\neg r\\lor\\neg\\neg s', "De Morgan's"), L('\\neg r\\lor s', 'Double Negation')], 3],
  ['A with work after the end', PA, [L('\\neg r\\lor\\neg\\neg s', "De Morgan's"), L('\\neg r\\lor s', 'Double Negation'), L('r', 'Identity')], 3],
  ['B by the key', PB, PB_KEY, 5],
  ['B with Identity taken directly', PB, [...PB_KEY.slice(0, 3), L('r\\land s', 'Identity')], 5],
  ['B by another route', PB, [L('(r\\land\\neg r)\\lor(r\\land s)', 'Distributive'), L('(r\\land s)\\lor(r\\land\\neg r)', 'Commutative'),
    L('(r\\land s)\\lor c', 'Complement'), L('r\\land s', 'Identity')], 5],
  ['B with a line written twice', PB, [PB_KEY[0], PB_KEY[1], PB_KEY[1], PB_KEY[2], PB_KEY[3], PB_KEY[4]], 5],
  ['B padded by going back and forth', PB, [PB_KEY[1], L('(r\\land s)\\lor(r\\land\\neg r)', 'Commutative'),
    L('(r\\land\\neg r)\\lor(r\\land s)', 'Commutative'), L('(r\\land s)\\lor(r\\land\\neg r)', 'Commutative')], 2],
  ['B with two missing laws', PB, [PB_KEY[0], '\\equiv(r\\land\\neg r)\\lor(r\\land s)', PB_KEY[2], '(r\\land s)\\lor c', PB_KEY[4]], 3],
  ['B uses two laws on the last line but names one', PB, [PB_KEY[1], L('r\\land s', 'Identity')], 4],
  ['B leaps from the given to the end', PB, [L('r\\land s', 'Identity')], 0],
  ['B leaps after a step', PB, [PB_KEY[0], PB_KEY[1], L('r', 'Identity'), L('r\\land s', 'Identity')], 1],
  ['B mis-spelt connectives still read', PB, [L('r\\wedge(\\sim r\\vee s)', 'Given'), L('(r\\wedge\\sim r)\\vee(r\\wedge s)', 'Distributive'),
    L('F\\vee(r\\wedge s)', 'Complement'), L('r\\wedge s', 'Identity')], 5],
  ['C by the key', PC, PC_KEY, 6],
  ['C from the other way of writing it', PC, [L('[\\neg r\\land(r\\lor s)]\\to s', 'Given'), L('\\neg[\\neg r\\land(r\\lor s)]\\lor s', 'Implication'),
    L('[\\neg\\neg r\\lor\\neg(r\\lor s)]\\lor s', "De Morgan's"), L('[r\\lor\\neg(r\\lor s)]\\lor s', 'Double Negation')], 3],
  ['C from a wrong statement', PC, [L('[(r\\lor s)\\land r]\\to s', 'Given'), L('t', 'Complement')], 0],
  ['C two laws per line, all named', PC, [L('[\\neg(r\\lor s)\\lor r]\\lor s', 'Implication', "De Morgan's", 'Double Negation'),
    L('t', 'Associative', 'Complement')], 6],
];
{
  let agree = 0, bad = null;
  for (const [name, rubric, lines, want] of CASES) {
    const js = markLogic(lines, rubric);
    const [{ m }] = await q(`SELECT public.logic_mark($1::jsonb, $2::jsonb) AS m`, [J(lines), J(rubric)]);
    const same = Number(m.marks) === js.marks && m.reason === js.reason && J(m.line_steps) === J(js.lineSteps);
    ck(`${name}: ${want}/${rubric.marks}`, js.marks === want && same,
      `js ${js.marks} "${js.reason}" ${J(js.lineSteps)} | sql ${m.marks} "${m.reason}" ${J(m.line_steps)}`);
    if (same) agree++; else if (!bad) bad = name;
  }
  ck(`every proof gets the same marks, reason and ticks on both sides`, agree === CASES.length, bad);
}
{
  const m = markLogic(PB_KEY, PB);
  ck('a proved proof says so', m.reason === 'Proved, with a law for every step.' && m.correct === true);
  const w = markLogic([PB_KEY[0], '(r\\land\\neg r)\\lor(r\\land s)', PB_KEY[2], '(r\\land s)\\lor c', PB_KEY[4]], PB);
  ck('missing laws are named by line', /lines 2 and 4 are missing/.test(w.reason), w.reason);
  const n = markLogic([PB_KEY[1], L('r\\lor s', 'Complement')], PB);
  ck('a line that is not equivalent is named', /Line 2 is not equivalent/.test(n.reason), n.reason);
  ck('no reason quotes the target', CASES.every(([, r, l]) => !markLogic(l, r).reason.includes('\\')));
}

console.log('\n=== one-line items ===');
{
  const S = [
    [[L('r\\land s', 'Identity')], 2, 'Correct result and law.'],
    [[L('s\\land r', 'Identity', 'Commutative')], 2, 'Correct result and law.'],
    [[L('r\\land s', 'Domination')], 1, 'The result is right; the law named does not give it.'],
    [['r\\land s'], 1, 'The result is right; the law is missing.'],
    [[L('c', 'Identity')], 1, 'The law is right; the result is not simplified correctly.'],
    [[L('(r\\land s)\\lor c', 'Identity')], 1, 'The law is right; the result is not simplified correctly.'],
    [[L('c', 'Domination')], 0, 'Neither the result nor the law is right.'],
    [[L('r\\land', 'Domination')], 0, 'The result could not be read as a statement.'],
    [[], 0, 'Nothing was written.'],
  ];
  for (const [lines, want, reason] of S) {
    const js = markLogic(lines, SIMP);
    const [{ m }] = await q(`SELECT public.logic_mark($1::jsonb, $2::jsonb) AS m`, [J(lines), J(SIMP)]);
    ck(`simplify ${J(lines)} → ${want}`, js.marks === want && js.reason === reason && Number(m.marks) === want && m.reason === reason,
      `js ${js.marks} ${js.reason} | sql ${m.marks} ${m.reason}`);
  }
  const O = [[['s\\to r'], 1], [['s\\rightarrow r'], 1], [['(s)\\to(r)'], 1], [['\\equiv s\\to r'], 1], [['r\\to s'], 0],
    [['\\neg s\\lor r'], 0], [['s\\to'], 0], [['r', 's\\to r'], 1]];
  for (const [lines, want] of O) {
    const js = markLogic(lines, ONE);
    const [{ m }] = await q(`SELECT public.logic_mark($1::jsonb, $2::jsonb) AS m`, [J(lines), J(ONE)]);
    ck(`logic ${J(lines)} → ${want}`, js.marks === want && Number(m.marks) === want && js.reason === m.reason, `${js.reason} | ${m.reason}`);
  }
  ck('an equivalent statement is not the statement asked for', markLogic(['\\neg r\\to\\neg s'], ONE).marks === 0);
}

console.log('\n=== the dashboard\'s markAnswer agrees ===');
{
  for (const [name, rubric, lines] of CASES.slice(0, 8)) {
    const a = markAnswer(lines, rubric), m = markLogic(lines, rubric);
    ck(`markAnswer: ${name}`, a.marks === m.marks && a.total === rubric.marks && J(a.lineSteps) === J(m.lineSteps)
      && a.reason === m.reason, J(a));
  }
  ck('isLogicMode reads a rubric and a work_mode alike', isLogicMode(PA) && isLogicMode('simplify') && isLogicMode('logic')
    && !isLogicMode('lines') && !isLogicMode({ mode: 'text' }) && !isLogicMode(null));
}

console.log('\n=== a whole sitting ===');
const PAPER = '7c2e1a44-3b5d-4e6f-8a9b-0c1d2e3f4a5c';
await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,
    duration_minutes,allow_retakes,show_answers)
  VALUES ('${PAPER}','seatwork','Practice','AERO 101','${INS}',true,60,true,true);`);
const TEXT = { mode: 'text', steps: [{ latex: 'Absorption', marks: 1 }], accept: ['absorption law'] };
const MATHS = { steps: [{ latex: "y'=7", marks: 2, label: 'Final answer' }] };
await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choices, correct_answer, marks, work_given, work_variable, work_rubric)
  VALUES ($1,$1,1,'Prove that ¬(r ∧ ¬s) ≡ ¬r ∨ s.','worked_solution','[]'::jsonb,NULL,3,'\\neg(r\\land\\neg s)\\equiv\\neg r\\lor s',NULL,$2::jsonb),
         ($1,$1,2,'Prove that r ∧ (¬r ∨ s) ≡ r ∧ s.','worked_solution','[]'::jsonb,NULL,5,'r\\land(\\neg r\\lor s)\\equiv r\\land s',NULL,$3::jsonb),
         ($1,$1,3,'Reduce the statement to t.','worked_solution','[]'::jsonb,NULL,6,NULL,NULL,$4::jsonb),
         ($1,$1,4,'Simplify (r ∧ s) ∨ c.','worked_solution','[]'::jsonb,NULL,2,'(r\\land s)\\lor c',NULL,$5::jsonb),
         ($1,$1,5,'Write "if s then r" in symbols, using ∧ ∨ ¬ →.','worked_solution','[]'::jsonb,NULL,1,NULL,NULL,$6::jsonb),
         ($1,$1,6,'Type the law.','worked_solution','[]'::jsonb,NULL,1,NULL,NULL,$7::jsonb),
         ($1,$1,7,'Differentiate','worked_solution','[]'::jsonb,NULL,2,'y=7x','x',$8::jsonb),
         ($1,$1,8,'Pick one','multiple_choice','["a","b","c","d"]'::jsonb,2,1,NULL,NULL,NULL)`,
  [PAPER, J(PA), J(PB), J(PC), J(SIMP), J(ONE), J(TEXT), J(MATHS)]);
const ids = await q(`SELECT id, question_number FROM public.questions WHERE exam_id=$1 ORDER BY question_number`, [PAPER]);
const qid = n => ids.find(r => r.question_number === n).id;
const sit = async (work, picked) => {
  await x(`DELETE FROM public.live_sessions WHERE student_id='${STU}'`);
  await q(`INSERT INTO public.live_sessions (student_id, exam_id, assessment_id, student_name, status, work_answers_json)
           VALUES ($1,$2,$2,'S One','active',$3::jsonb)`, [STU, PAPER, J(work)]);
  const t0 = performance.now();
  const r = (await q(`SELECT public.submit_assessment($1,$2,$3::jsonb,60,0,'[]'::jsonb) AS r`, [STU, PAPER, J(picked)]))[0].r;
  return { ...r, ms: performance.now() - t0 };
};
const FULL = {
  [qid(1)]: { lines: CASES[0][2] }, [qid(2)]: { lines: PB_KEY }, [qid(3)]: { lines: PC_KEY },
  [qid(4)]: { lines: [L('r\\land s', 'Identity')] }, [qid(5)]: { lines: ['s\\to r'] },
  [qid(6)]: { lines: ['Absorption Law'] }, [qid(7)]: { lines: ["y'=7"] },
};
const s1 = await sit(FULL, { [qid(8)]: 2 });
ck('every item right: 20 of 20 typed marks', Number(s1.work_marks) === 20 && Number(s1.work_total) === 20, J(s1));
const s2 = await sit({ ...FULL, [qid(2)]: { lines: CASES.find(c => c[0] === 'B with two missing laws')[2] },
  [qid(1)]: { lines: CASES.find(c => c[0] === 'A stopped half way')[2] } }, {});
ck('two missing laws on B (3) and A stopped half way (1): 20 − 2 − 2 = 16', Number(s2.work_marks) === 16, J(s2));
{
  const att = (await q(`SELECT answers_json FROM public.review_attempts WHERE student_id=$1 AND attempt_no=2`, [STU]))[0].answers_json;
  const b = att[qid(2)];
  ck('the proof is stored as written, with its marks, reason and ticks', b.marks === 3 && b.of === 5 && b.correct === false
    && /lines 2 and 4/.test(b.reason) && J(b.line_steps) === J([1, null, 1, null, 1]), J(b));
  ck('the laws are stored on the lines', att[qid(1)].lines[0].includes('\\text{(De Morgan'), att[qid(1)].lines[0]);
}
{
  // The slowest a sitting can reasonably be: every proof line with a wrong
  // law, so every step is also searched by all thirteen laws.
  const wrong = lines => lines.map(l => joinLine(splitLine(l).statement, ['Idempotent']));
  const s3 = await sit({ ...FULL, [qid(1)]: { lines: wrong(CASES[0][2]) }, [qid(2)]: { lines: wrong(PB_KEY) },
    [qid(3)]: { lines: wrong(PC_KEY) } }, {});
  ck(`a sitting with every law wrong marks in ${Math.round(s3.ms)} ms (limit 20 s; PGlite is the slower)`, s3.ms < 5000, J(s3));
  ck(`…and a right one in ${Math.round(s1.ms)} ms`, s1.ms < 3000);
  // Lines the length a student could paste: still marked inside the limit.
  const long = Array.from({ length: 45 }, (_, i) => joinLine(
    Array.from({ length: 6 }, (_, k) => (i + k) % 2 ? '\\neg\\neg r' : '(r\\lor s)').join('\\land '), ['Commutative']));
  const s4 = await sit({ ...FULL, [qid(1)]: { lines: long }, [qid(2)]: { lines: long }, [qid(3)]: { lines: long } }, {});
  ck(`three proofs of 45 long lines each mark in ${Math.round(s4.ms)} ms`, s4.ms < 8000, J(s4));
  // The widest search a line can ask for: a long statement, every step a
  // real one, every law named the two that rewrite the most places.
  const A = '\\neg(((r\\lor s)\\lor(u\\lor r))\\lor((s\\lor u)\\lor(r\\lor s)))';
  const B = '\\neg((r\\lor s)\\lor(u\\lor r))\\land\\neg((s\\lor u)\\lor(r\\lor s))';
  ck('the wide statements are inside the length limit', parseLogic(A) !== null && parseLogic(B) !== null);
  const WIDE = { mode: 'proof', given: A, steps: [{ latex: 'r', marks: 6 }], marks: 6, key_steps: 6 };
  const wide = Array.from({ length: 40 }, (_, i) => joinLine(i % 2 ? A : B, ['Commutative', 'Associative']));
  const t0 = performance.now();
  const wj = markLogic(wide, WIDE);
  const jsMs = performance.now() - t0;
  const t1 = performance.now();
  const [{ m: ws }] = await q(`SELECT public.logic_mark($1::jsonb, $2::jsonb) AS m`, [J(wide), J(WIDE)]);
  const sqlMs = performance.now() - t1;
  ck(`40 of the widest lines: ${Math.round(sqlMs)} ms in the database, ${Math.round(jsMs)} ms in JS, and they agree`,
    sqlMs < 8000 && Number(ws.marks) === wj.marks && ws.reason === wj.reason, `${ws.reason} | ${wj.reason}`);
}

console.log('\n=== the exam screen learns each mode, and nothing of the key ===');
{
  const r = await asAnon(`SELECT question_number, work_mode, work_given FROM public.get_exam_questions($1,$2,$3) ORDER BY 1`, [PAPER, STU, TOK]);
  ck('get_exam_questions works for the student', r.ok, r.message);
  const modes = r.ok ? r.rows.map(x => x.work_mode) : [];
  ck('the modes are proof, proof, proof, simplify, logic, text, none, none', J(modes) === J(['proof', 'proof', 'proof', 'simplify', 'logic', 'text', null, null]), J(modes));
  const raw = r.ok ? J(r.rows) : '';
  ck('…and no key, target or accepted form is sent', r.ok && !/key_steps|given_accept|"steps"|s\\\\to r/.test(raw), raw.slice(0, 300));
}

console.log('\n=== the review ===');
{
  const r = await asAnon(`SELECT public.get_answer_review($1,$2,2,$3) AS r`, [STU, PAPER, TOK]);
  ck('the student can read the review', r.ok, r.message);
  const rv = r.ok ? Object.fromEntries(r.rows[0].r.map(row => [row.question_number, row])) : {};
  ck('a proof comes back with its mode, every line and its ticks', rv[2]?.work_mode === 'proof' && rv[2]?.lines.length === 5
    && J(rv[2]?.line_steps) === J([1, null, 1, null, 1]) && Number(rv[2]?.earned) === 3, J(rv[2]));
  ck('…and the reason', /missing/.test(rv[2]?.reason || ''));
}

console.log('\n=== 076: a step that takes two laws, and lines written as equations ===');
{
  // A look-alike of the step a student took: Associative and Commutative
  // in one line, named Associative only.
  const PD = { mode: 'proof', given: '(s\\land u)\\land\\neg s', steps: [{ latex: 'c', marks: 5 }], marks: 5, key_steps: 4 };
  const route = laws2 => [L('(s\\land\\sim s)\\land u', ...laws2), L('c\\land u', 'Complement'), L('c', 'Domination')];
  const D = [
    ['two laws in one line, both named', PD, route(['Associative', 'Commutative']), 5, 'Proved, with a law for every step.'],
    ['…one of the two named', PD, route(['Associative']), 4,
      'Proved, but 1 law is missing or wrong. The law on line 1 is missing or does not give that step.'],
    ['…neither named', PD, route([]), 3,
      'Proved, but 2 laws are missing or wrong. The law on line 1 is missing or does not give that step.'],
    ['…a wrong law named', PD, route(['Distributive']), 3,
      'Proved, but 2 laws are missing or wrong. The law on line 1 is missing or does not give that step.'],
    ['three laws in one line is still a leap', PD, [L('(s\\land u)\\land\\neg s', 'Given'), L('c\\land u', 'Complement')], 0,
      'Line 2 does not follow from the line before it by one or two laws: write each step on its own line.'],
    ['a proof line written as an equation', PD, [L('(s\\land u)\\land\\neg s\\equiv(s\\land\\sim s)\\land u', 'Associative', 'Commutative'),
      L('=c\\land u', 'Complement'), L('\\equiv c', 'Domination')], 5, 'Proved, with a law for every step.'],
    ['a false equation stops the work', PD, [L('(s\\land\\sim s)\\land u', 'Associative', 'Commutative'), L('c\\land u\\equiv t', 'Complement')], 1,
      'Line 2 could not be read as a statement, so the work stops counting there.'],
    ['simplify written as the whole equation, ≡', SIMP, [L('(r\\land s)\\lor c\\equiv r\\land s', 'Identity')], 2, 'Correct result and law.'],
    ['simplify written as the whole equation, =', SIMP, [L('(r\\land s)\\lor c=r\\land s', 'Identity')], 2, 'Correct result and law.'],
    ['simplify with a false equation', SIMP, [L('(r\\land s)\\lor c\\equiv c', 'Identity')], 1,
      'The law is right; the result could not be read as a statement.'],
    ['simplify with a stray connective after it', SIMP, [L('r\\land s\\leftrightarrow', 'Identity')], 1,
      'The law is right; the result could not be read as a statement.'],
    ['a one-statement answer may be written as an equation', ONE, ['r\\lor\\neg s=s\\to r'], 1, 'Correct answer.'],
  ];
  for (const [name, rubric, lines, want, reason] of D) {
    const js = markLogic(lines, rubric);
    const [{ m }] = await q(`SELECT public.logic_mark($1::jsonb, $2::jsonb) AS m`, [J(lines), J(rubric)]);
    ck(`${name}: ${want}/${rubric.marks}`, js.marks === want && js.reason === reason
      && Number(m.marks) === want && m.reason === reason && J(m.line_steps) === J(js.lineSteps),
      `js ${js.marks} "${js.reason}" ${J(js.lineSteps)} | sql ${m.marks} "${m.reason}" ${J(m.line_steps)}`);
  }

  // The slowest new search: every line a real step that takes two laws,
  // naming a wrong one, so each tries every law beside it and then pairs.
  const A = '\\neg(\\neg((r\\lor s)\\lor(u\\lor r))\\land((s\\lor u)\\lor(r\\lor s)))';
  const B = '((r\\lor s)\\lor(u\\lor r))\\lor\\neg((s\\lor u)\\lor(r\\lor s))';
  ck('the two-law statements are inside the length limit', parseLogic(A) !== null && parseLogic(B) !== null);
  const SLOW = { mode: 'proof', given: A, steps: [{ latex: 'r', marks: 6 }], marks: 6, key_steps: 6 };
  const slow = Array.from({ length: 40 }, (_, i) => joinLine(i % 2 ? A : B, ['Idempotent']));
  const t0 = performance.now();
  const sj = markLogic(slow, SLOW);
  const jsMs = performance.now() - t0;
  const t1 = performance.now();
  const [{ m: ss }] = await q(`SELECT public.logic_mark($1::jsonb, $2::jsonb) AS m`, [J(slow), J(SLOW)]);
  const sqlMs = performance.now() - t1;
  ck(`40 two-law lines with a wrong law: ${Math.round(sqlMs)} ms in the database, ${Math.round(jsMs)} ms in JS, and they agree`,
    sqlMs < 8000 && Number(ss.marks) === sj.marks && ss.reason === sj.reason, `${ss.reason} | ${sj.reason}`);

  // …and the widest lines only the wider search finds a step: regrouping
  // and reordering wide sides (Associative, Commutative, Associative), the
  // law named wrong, forty times.
  const P1 = '(\\neg r\\land s)', P2 = '(u\\lor\\neg s)', P3 = '(r\\to u)';
  const X = `(${P1}\\lor ${P2})\\lor ${P3}`, Y = `(${P1}\\lor ${P3})\\lor ${P2}`;
  ck('the regrouped statements are inside the length limit, and three uses apart', parseLogic(X) !== null && parseLogic(Y) !== null
    && !stepFollows(parseLogic(X), parseLogic(Y), STEP_LAWS, 2) && stepFollows(parseLogic(X), parseLogic(Y), ['associative', 'commutative'], 3));
  const REGROUP = { mode: 'proof', given: X, steps: [{ latex: 'r', marks: 6 }], marks: 6, key_steps: 6 };
  const regroup = Array.from({ length: 40 }, (_, i) => joinLine(i % 2 ? X : Y, ['Idempotent']));
  const t2 = performance.now();
  const rj = markLogic(regroup, REGROUP);
  const rjMs = performance.now() - t2;
  const t3 = performance.now();
  const [{ m: rs }] = await q(`SELECT public.logic_mark($1::jsonb, $2::jsonb) AS m`, [J(regroup), J(REGROUP)]);
  const rsMs = performance.now() - t3;
  ck(`40 regrouping lines with a wrong law: ${Math.round(rsMs)} ms in the database, ${Math.round(rjMs)} ms in JS, and they agree`,
    rsMs < 8000 && Number(rs.marks) === rj.marks && rs.reason === rj.reason, `${rs.reason} | ${rj.reason}`);

  // 077 marks again what was submitted before 076, raise-only.
  const M077 = fs.readFileSync(P + '/sql/077_remark_in_batches_after_076.sql', 'utf8');
  const P76 = '3d0f6c2a-8e41-4b7a-9c55-1f2e3d4c5b6a';
  await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,duration_minutes,allow_retakes,show_answers)
           VALUES ('${P76}','seatwork','P 76','AERO 101','${INS}',true,60,true,true);`);
  await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text, question_type, choices, correct_answer, marks,
             work_given, work_variable, work_rubric)
           VALUES ($1,$1,1,'Prove it.','worked_solution','[]'::jsonb,NULL,5,'(s\\land u)\\land\\neg s\\equiv c',NULL,$2::jsonb)`, [P76, J(PD)]);
  const q76 = (await q(`SELECT id FROM public.questions WHERE exam_id = $1`, [P76]))[0].id;
  const sit76 = async lines => {
    await x(`DELETE FROM public.live_sessions WHERE student_id='${STU}'`);
    await q(`INSERT INTO public.live_sessions (student_id, exam_id, assessment_id, student_name, status, work_answers_json)
             VALUES ($1,$2,$2,'S One','active',$3::jsonb)`, [STU, P76, J({ [q76]: { lines } })]);
    return (await q(`SELECT public.submit_assessment($1,$2,'{}'::jsonb,60,0,'[]'::jsonb) AS r`, [STU, P76]))[0].r;
  };
  const short = (await sit76(route(['Associative']))).attempt_no;
  const full = (await sit76(route(['Associative', 'Commutative']))).attempt_no;
  // As they stood under 073: 0 and 5, marked before 076 went live.
  await q(`UPDATE public.review_attempts SET work_marks = CASE attempt_no WHEN $2::int THEN 0 ELSE 5 END,
             work_marked_at = '2000-01-01' WHERE assessment_id = $1`, [P76, short]);
  const left = async () => { const c = (await q(M077.slice(M077.lastIndexOf('SELECT\n'))))[0]; return Number(c.graded_left) + Number(c.practice_left); };
  ck('077 has both sittings of the logic paper to re-mark', (await left()) === 2, String(await left()));
  await x(M077);
  const marks = Object.fromEntries((await q(`SELECT attempt_no, work_marks FROM public.review_attempts WHERE assessment_id = $1`, [P76]))
    .map(r => [r.attempt_no, Number(r.work_marks)]));
  ck('…raises the one short a law to 4, leaves the full one at 5, and has none left', marks[short] === 4 && marks[full] === 5
    && (await left()) === 0, J(marks));
  await q(`UPDATE public.review_attempts SET work_marks = 5, work_marked_at = '2000-01-01' WHERE assessment_id = $1 AND attempt_no = $2`, [P76, short]);
  let refused = '';
  try { await x(M077); } catch (e) { refused = e.message; await x(`ROLLBACK`); }
  ck('…and refuses a run that would lower a mark, changing nothing', /Would go DOWN from 5 to 4/.test(refused)
    && Number((await q(`SELECT work_marks FROM public.review_attempts WHERE assessment_id = $1 AND attempt_no = $2`, [P76, short]))[0].work_marks) === 5,
    refused);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
