// sql/105: a problem answered as quantities, a mark for each value and a
// mark for each unit.
//
//   * quantity_number(), quantity_unit_key(), quantity_value_ok() and
//     mark_quantities() and their JS twins (src/lib/quantityAnswer.js) read
//     every answer alike — the dashboard re-marks with the JS, and saving
//     there overwrites the database's mark;
//   * the scheme: the value rounds to the key at the part's places (more
//     places are fine, fewer are not); the unit is an accepted one in any
//     spelling, and counts only beside a number;
//   * a whole sitting through submit_assessment() marks the problem and
//     leaves every other item as it was; the exam screen learns the mode and
//     the part labels, never the key;
//   * 105 runs twice, and its VERIFY row is all true.
//
// Look-alike problems only — never a real paper's.
//
//   npm run test:quantities
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quantityNumber, quantityUnitText, quantityUnitKey, quantityValueOk, markQuantities,
         markQuantityAnswer, quantityParts, partLine, splitPartLine, isQuantity } from '../../src/lib/quantityAnswer.js';
import { markAnswer } from '../../src/lib/workedSolution.js';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const J = v => JSON.stringify(v);
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
  '066_times_between_numbers_and_zero_terms', '071_the_keyboards_e_is_e',
  '073_logic_proofs_line_by_line']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

console.log('\n=== 105 applies ===');
const M = fs.readFileSync(P + '/sql/105_answers_with_units.sql', 'utf8');
await x(M);
await x(M);
ck('105 applies, twice', true);
{
  const [v] = await q(M.slice(M.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim());
  ck("105's VERIFY row is all true", Object.values(v).every(b => b === true), J(v));
}
{
  const r = await asAnon(`SELECT public.mark_quantities('[]'::jsonb, '{}'::jsonb)`);
  ck('the marker is not callable from a browser', !r.ok, J(r.rows));
}

console.log('\n=== reading the number ===');
const NUMBERS = [
  ['24.49 crates per order', '24.49'], ['Q = 1,250.5 crates', '1250.5'], ['Q* = 25.', '25'],
  ['.5 hours', '0.5'], ['-.25 units', '-0.25'], ['− 3 days', '3'], ['−3 days', '-3'], ['₱12,000 per year', '12000'],
  ['ROP=180 units', '180'], ['a = b = 7.000 trucks', '7.000'], ['about 3 or 4', '3'], ['no number here', null],
  ['', null], ['   ', null], ['45 min = 0.75 hr', '0.75'], ['P1,500.00/yr', '1500.00'], ['0 units', '0'],
  ['1e3 units', '1'], ['12,', '12'], [',5 kg', '5'],
];
for (const [text, want] of NUMBERS) {
  const js = quantityNumber(text);
  const [{ n: sq }] = await q(`SELECT public.quantity_number($1) AS n`, [text]);
  ck(`number of ${J(text)} is ${J(want)} on both sides`, js === want && sq === want, `js ${J(js)} sql ${J(sq)}`);
}

console.log('\n=== reading the unit ===');
const UNITS = [
  ['crates/order', ['Crates per Order', 'crate per order', 'crates / orders', 'CRATES/ORDER', 'crates per  order.', '(crates/order)']],
  ['php/year', ['₱ per year', '₱/year', 'PHP per year', 'php / years', 'Php/Year']],
  ['customers/hour', ['customers per hour', 'customer/hour', 'Customers / Hours']],
  ['days', ['day', 'Days', 'days.', ' days ']],
  ['%', ['%', ' % ']],
];
for (const [base, forms] of UNITS) {
  const wantJs = quantityUnitKey(base);
  const [{ k: wantSql }] = await q(`SELECT public.quantity_unit_key($1) AS k`, [base]);
  ck(`${base} keys alike on both sides`, wantJs === wantSql, `${wantJs} | ${wantSql}`);
  let agree = 0, bad = null;
  for (const f of forms) {
    const js = quantityUnitKey(f);
    const [{ k: sq }] = await q(`SELECT public.quantity_unit_key($1) AS k`, [f]);
    if (js === wantJs && sq === wantJs) agree++; else if (!bad) bad = { f, js, sq };
  }
  ck(`all ${forms.length} spellings of ${base} are one unit`, agree === forms.length, J(bad));
}
{
  const DIFFER = [['php/year', 'php/yr'], ['crates/order', 'crates'], ['hours', 'minutes'], ['days', 'day/order'],
                  ['php/unit/year', 'php/unit'], ['/year', 'php/year']];
  let ok = 0, bad = null;
  for (const [a, b] of DIFFER) {
    const [{ k1, k2 }] = await q(`SELECT public.quantity_unit_key($1) k1, public.quantity_unit_key($2) k2`, [a, b]);
    if (quantityUnitKey(a) !== quantityUnitKey(b) && k1 !== k2 && quantityUnitKey(a) === k1) ok++; else if (!bad) bad = [a, b, k1, k2];
  }
  ck(`${DIFFER.length} different units stay different on both sides`, ok === DIFFER.length, J(bad));
}
{
  const texts = ['24.49 crates per order', 'EOQ = 12 days', '₱1,200 per year', '7', 'crates', '3.5 hrs.'];
  let ok = 0, bad = null;
  for (const t of texts) {
    const [{ u }] = await q(`SELECT public.quantity_unit_text($1) AS u`, [t]);
    if (u === quantityUnitText(t)) ok++; else if (!bad) bad = [t, u, quantityUnitText(t)];
  }
  ck('the unit text left beside the number agrees', ok === texts.length, J(bad));
}

console.log('\n=== the value, rounded as instructed ===');
const VALUES = [
  ['31.42', '31.42', 2, true], ['31.4159', '31.42', 2, true], ['31.4', '31.42', 2, false], ['31.415', '31.42', 2, true],
  ['31.4149', '31.42', 2, false], ['31.420', '31.42', 2, true], ['31', '31.42', 2, false], ['25', '25', 0, true],
  ['24.5', '25', 0, true], ['24.49', '25', 0, false], ['1.005', '1.01', 2, true], ['1.004', '1.01', 2, false],
  ['-2.5', '-3', 0, true], ['-2.4', '-2', 0, true], ['0.004', '0', 2, true], ['-0.004', '0', 2, true],
  ['1250', '1250.00', 2, true], ['0.7500', '0.75', 2, true], ['0.75', '0.8', 1, true], ['0.74', '0.8', 1, false],
  ['123456789.125', '123456789.13', 2, true], [null, '5', 0, false], ['5', null, 0, false],
];
for (const [n, key, d, want] of VALUES) {
  const js = quantityValueOk(n, key, d);
  const [{ ok: sq }] = await q(`SELECT public.quantity_value_ok($1, $2, $3) AS ok`, [n, key, d]);
  ck(`${n} against ${key} at ${d} places: ${want}`, js === want && sq === want, `js ${js} sql ${sq}`);
}

console.log('\n=== marking a problem ===');
const PROBLEM = { mode: 'quantity', parts: [
  { key: 'a', value: '31.42', decimals: 2, units: ['crates/order', 'crates per order'], value_marks: 1, unit_marks: 1 },
  { key: 'b', value: '6', decimals: 0, units: ['orders/year'] },
  { key: 'c', value: '18850.00', decimals: 2, units: ['php/year', 'pesos/year'], value_marks: 2, unit_marks: 1 },
  { key: 'd', value: '0.75', decimals: 2, units: ['hours', 'hrs'] },
] };
const CASES = [
  ['all right', ['a) EOQ = 31.42 crates per order', 'b) 6 orders/year', 'c) ₱18,850.00 per year', 'd) 0.75 hours'], 9],
  ['all right, written loosely', ['a) 31.4159 Crates/Order', 'b) N = 6 orders per year', 'c) 18850 PHP/year', 'd) .75 hrs'], 9],
  ['units missing', ['a) 31.42', 'b) 6', 'c) 18850', 'd) 0.75'], 5],
  ['values off, units right', ['a) 31.4 crates/order', 'b) 7 orders/year', 'c) ₱18,800 /year', 'd) 0.8 hours'], 4],
  ['unit with no number earns nothing', ['a) crates per order', 'b) orders/year'], 0],
  ['a part left blank and one not given', ['a) 31.42 crates/order', 'b)   ', 'c) 18850 pesos/year'], 5],
  ['parts out of order', ['d) 0.75 hours', 'a) 31.42 crates/order'], 4],
  ['a later line for a part wins', ['a) 30 crates', 'a) 31.42 crates/order'], 2],
  ['lines with no part letter are ignored', ['31.42 crates/order', 'b) 6 orders/year'], 2],
  ['nothing written', [], 0],
  ['wrong unit family', ['a) 31.42 crates/year', 'b) 6 orders', 'c) 18850 php', 'd) 45 minutes'], 4],
];
for (const [name, lines, want] of CASES) {
  const js = markQuantities(lines, PROBLEM);
  const [{ m: sq }] = await q(`SELECT public.mark_quantities($1::jsonb, $2::jsonb) AS m`, [J(lines), J(PROBLEM)]);
  const same = Number(sq.marks) === js.marks && Number(sq.of) === js.total && sq.reason === js.reason
    && J(sq.parts.map(p => [p.key, p.blank, p.value_ok, p.unit_ok, Number(p.marks)]))
     === J(js.parts.map(p => [p.key, p.blank, p.value_ok, p.unit_ok, p.marks]));
  ck(`${name}: ${want} of 9, and both sides agree`, js.marks === want && js.total === 9 && same,
     `js ${js.marks} "${js.reason}" | sql ${sq.marks} "${sq.reason}"`);
}
{
  const m = markQuantities(['a) 31.4 crates/year', 'b) 6 orders/year'], PROBLEM);
  ck('the reason names the parts and never the key', m.reason === 'Value wrong: a. Unit wrong or missing: a. Left blank: c, d.'
    && !/31\.42|18850|crates\/order/.test(m.reason), m.reason);
  const a = markAnswer(['a) 31.42 crates/order', 'b) 6 orders/year'], PROBLEM);
  ck("the dashboard's markAnswer routes a quantity item here", a.marks === 4 && a.total === 9 && !a.correct
    && Array.isArray(a.parts) && a.parts.length === 4, J(a));
  const full = markQuantityAnswer(CASES[0][1], PROBLEM);
  ck('a fully right problem is correct', full.correct && full.marks === 9);
}

console.log('\n=== the stored shape ===');
{
  const parts = quantityParts('a) Economic order quantity (2 decimal places)\nb) Orders per year\n\nNot a part\nc) Total cost');
  ck('work_given lines become labelled parts', J(parts) === J([{ key: 'a', label: 'Economic order quantity (2 decimal places)' },
    { key: 'b', label: 'Orders per year' }, { key: 'c', label: 'Total cost' }]), J(parts));
  ck('a part line carries its letter and reads back', J(splitPartLine(partLine('c', '₱1,200 per year'))) === J({ key: 'c', text: '₱1,200 per year' }));
  ck('isQuantity reads a rubric and a work_mode alike', isQuantity(PROBLEM) && isQuantity('quantity') && !isQuantity('text') && !isQuantity(null));
}

console.log('\n=== a whole sitting ===');
const PAPER = '5d1c9e22-7a3b-4c4d-9e8f-1a2b3c4d5e6f';
await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,
    duration_minutes,allow_retakes,show_answers)
  VALUES ('${PAPER}','exam','Practice','AERO 101','${INS}',true,60,false,false);`);
const GIVEN = 'a) Order quantity (2 decimal places)\nb) Orders a year (whole number)\nc) Annual cost (2 decimal places)\nd) Time in the system (2 decimal places)';
await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choices, correct_answer, marks, work_given, work_variable, work_rubric)
  VALUES ($1,$1,1,'A look-alike depot problem.','worked_solution','[]'::jsonb,NULL,9,$2,NULL,$3::jsonb),
         ($1,$1,2,'Type the word.','worked_solution','[]'::jsonb,NULL,1,NULL,NULL,$4::jsonb),
         ($1,$1,3,'Pick one','multiple_choice','["a","b","c","d"]'::jsonb,2,1,NULL,NULL,NULL)`,
  [PAPER, GIVEN, J(PROBLEM), J({ mode: 'text', steps: [{ latex: 'Rudder', marks: 1 }] })]);
const ids = await q(`SELECT id, question_number FROM public.questions WHERE exam_id=$1 ORDER BY question_number`, [PAPER]);
const qid = n => ids.find(r => r.question_number === n).id;
const sit = async (work, picked) => {
  await x(`DELETE FROM public.results WHERE student_id='${STU}'; DELETE FROM public.live_sessions WHERE student_id='${STU}'`);
  await q(`INSERT INTO public.live_sessions (student_id, exam_id, assessment_id, student_name, status, work_answers_json)
           VALUES ($1,$2,$2,'S One','active',$3::jsonb)`, [STU, PAPER, J(work)]);
  return (await q(`SELECT public.submit_assessment($1,$2,$3::jsonb,60,0,'[]'::jsonb) AS r`, [STU, PAPER, J(picked)]))[0].r;
};
{
  const r = await sit({ [qid(1)]: { lines: CASES[1][1] }, [qid(2)]: { lines: ['rudder'] } }, { [qid(3)]: 2 });
  ck('every part right: 10 of 10 typed marks', Number(r.work_marks) === 10 && Number(r.work_total) === 10, J(r));
  const r2 = await sit({ [qid(1)]: { lines: CASES[2][1] }, [qid(2)]: { lines: ['elevator'] } }, {});
  ck('units missing on every part: 5 of 10', Number(r2.work_marks) === 5, J(r2));
  const [{ a }] = await q(`SELECT answers_json -> $2 AS a FROM public.results WHERE student_id=$1`, [STU, qid(1)]);
  ck('the answer is stored as written, with its marks, reason and parts', a.marks === 5 && a.of === 9 && a.correct === false
    && a.reason === 'Unit wrong or missing: a, b, c, d.' && a.parts.length === 4 && J(a.lines) === J(CASES[2][1]), J(a));
}

console.log('\n=== the exam screen learns the parts, and nothing of the key ===');
{
  const r = await asAnon(`SELECT question_number, work_mode, work_given FROM public.get_exam_questions($1,$2,$3) ORDER BY 1`, [PAPER, STU, TOK]);
  // A closed sitting is not re-opened by a read; open a fresh one to look.
  ck('get_exam_questions works for the student', r.ok, r.message);
  const first = r.ok ? r.rows[0] : {};
  ck('the problem arrives as a quantity item with its part labels', first.work_mode === 'quantity' && first.work_given === GIVEN, J(first));
  ck('…and the labels read back as four parts', quantityParts(first.work_given).length === 4);
  const raw = r.ok ? J(r.rows) : '';
  ck('…and no key, accepted unit or rubric is sent', r.ok && !/31\.42|18850|crates\/order|orders\/year|"parts"|"units"/.test(raw), raw.slice(0, 300));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
