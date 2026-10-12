// sql/046: an answer typed as a word, not as maths.
//
//   * text_answer_key() / text_answer_verdict() (SQL) and their JS twins
//     (src/lib/textAnswer.js) reduce every string the same way and give the
//     same verdict — capitals and spaces ignored, punctuation trimmed only
//     at the ends;
//   * the dashboard's markAnswer() agrees, so a re-mark cannot overturn it;
//   * a whole sitting through submit_assessment() marks a text item, while a
//     maths item and a full solution on the same paper mark exactly as before;
//   * get_exam_questions() tells the exam screen which items are text, and
//     sends nothing of the key;
//   * the review shows the word back, and keeps the key back when told to;
//   * 046 runs twice.
//
// Look-alike items only — never a real paper's.
//
//   npm run test:text-answers
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { textAnswerKey, textAnswerVerdict, markTextAnswer, isTextAnswer } from '../../src/lib/textAnswer.js';
import { markAnswer } from '../../src/lib/workedSolution.js';
import { workedItemStats } from '../../src/lib/workedShape.js';
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
  '043_partial_working_earns_more', '045_brackets_that_change_nothing']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

console.log('\n=== 046 applies ===');
const M046 = fs.readFileSync(P + '/sql/046_answers_typed_as_words.sql', 'utf8');
await x(M046);
await x(M046);
ck('046 applies, twice', true);
{
  const [v] = await q(M046.slice(M046.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim());
  ck('046\'s VERIFY row is all true', Object.values(v).every(b => b === true), JSON.stringify(v));
}

console.log('\n=== the comparison: database and JS reduce every string alike ===');
const CORPUS = [
  'aileron', 'Aileron', 'AILERON', '  aileron  ', 'ai leron', 'Aileron.', '"Aileron"', '“Aileron”',
  '‘aileron’', '(aileron)', '[aileron]', 'aileron!', 'aileron?', 'aileron,', 'aileron;:', '.aileron.',
  "'aileron'", 'aileron\t', '\naileron\n', 'the aileron', 'aile-ron', "aileron's", 'ai.leron',
  'T', 't', ' F ', 'P.', 'N', 'No', 'no.', 'Yes', '', '   ', '...', '""', '()', 'é', 'Élevator',
  'trim tab', 'trimtab', 'TRIM  TAB', '42', '4 2', 'x^2', '\\land',
];
{
  let agree = 0, bad = null;
  for (const c of CORPUS) {
    const [{ k }] = await q(`SELECT public.text_answer_key($1) AS k`, [c]);
    if (k === textAnswerKey(c)) agree++; else if (!bad) bad = { c, sql: k, js: textAnswerKey(c) };
  }
  ck(`text_answer_key and its JS twin agree on all ${CORPUS.length} strings`, agree === CORPUS.length, JSON.stringify(bad));
}
{
  const KEYS = [['aileron'], ['trim tab'], ['T', 'True'], ['No'], ['elevator', 'stabilator']];
  let agree = 0, n = 0, bad = null;
  for (const accepted of KEYS) for (const c of CORPUS) {
    n++;
    const [{ v }] = await q(`SELECT public.text_answer_verdict($1, $2::text[]) AS v`, [c, accepted]);
    if (v === textAnswerVerdict(c, accepted)) agree++; else if (!bad) bad = { c, accepted, sql: v, js: textAnswerVerdict(c, accepted) };
  }
  ck(`text_answer_verdict and its twin agree on all ${n} pairs`, agree === n, JSON.stringify(bad));
}
const RIGHT = [['aileron', 'Aileron'], ['aileron', ' AILERON '], ['aileron', 'Aileron.'], ['aileron', '"aileron"'],
  ['aileron', '“Aileron”'], ['trim tab', 'Trim Tab'], ['trim tab', 'trimtab'], ['T', 't'], ['No', 'no.']];
for (const [key, typed] of RIGHT) {
  const [{ v }] = await q(`SELECT public.text_answer_verdict($1, ARRAY[$2]) AS v`, [typed, key]);
  ck(`right: "${typed}" for "${key}"`, v === null && textAnswerVerdict(typed, [key]) === null, String(v));
}
const WRONG = [['aileron', 'the aileron'], ['aileron', 'ailerons'], ['aileron', 'aile-ron'], ['T', 'True'],
  ['T', 'F'], ['No', 'Not'], ['aileron', ''], ['aileron', '...'], ['aileron', 'ai.leron']];
for (const [key, typed] of WRONG) {
  const [{ v }] = await q(`SELECT public.text_answer_verdict($1, ARRAY[$2]) AS v`, [typed, key]);
  ck(`wrong: "${typed}" for "${key}"`, v !== null && textAnswerVerdict(typed, [key]) !== null, String(v));
}
ck('an accept list is read: "True" counts where it is listed', textAnswerVerdict('true', ['T', 'True']) === null
  && (await q(`SELECT public.text_answer_verdict('true', ARRAY['T','True']) AS v`))[0].v === null);
ck('an empty accepted form never matches an empty answer',
  (await q(`SELECT public.text_answer_verdict('', ARRAY['']) AS v`))[0].v !== null && textAnswerVerdict('', ['']) !== null);
ck('the reason never quotes the key', textAnswerVerdict('rudder', ['aileron']) === 'Not the right answer.');

console.log('\n=== the dashboard\'s markAnswer agrees ===');
{
  const R = { mode: 'text', steps: [{ latex: 'aileron', marks: 2 }], accept: ['flaperon'] };
  const cases = [[['Aileron'], 2], [['FLAPERON.'], 2], [['rudder'], 0], [[], 0], [['', '  '], 0], [['rudder', 'aileron'], 2]];
  for (const [lines, want] of cases) {
    const a = markAnswer(lines, { ...R, marks: 2 });
    ck(`markAnswer ${JSON.stringify(lines)} → ${want}`, a.marks === want && a.total === 2 && a.correct === (want === 2), JSON.stringify(a));
  }
  ck('markAnswer on a text item never loads the algebra', markTextAnswer(['x^2'], R).reason === 'Not the right answer.');
  ck('isTextAnswer reads a rubric and a work_mode alike', isTextAnswer(R) && isTextAnswer('text') && !isTextAnswer({ mode: 'lines' }) && !isTextAnswer(null));
}

console.log('\n=== a whole sitting: a word, a maths answer and a full solution ===');
const PAPER = '7c2e1a44-3b5d-4e6f-8a9b-0c1d2e3f4a5b';
await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,
    duration_minutes,allow_retakes,show_answers)
  VALUES ('${PAPER}','exam','Practice','AERO 101','${INS}',true,60,true,true);`);
const TEXT = { mode: 'text', steps: [{ latex: 'aileron', marks: 1 }], accept: ['flaperon'] };
const MATHS = { steps: [{ latex: "y'=7", marks: 2, label: 'Final answer' }] };
const LINES = { mode: 'lines', steps: [{ latex: 'y=x^3', marks: 0 }, { latex: "y'=3x^2", marks: 3, alone: 2 }] };
await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
    question_type, choices, correct_answer, marks, work_given, work_variable, work_rubric)
  VALUES ($1,$1,1,'Type one word. The control surface that rolls the aircraft is the ______.','worked_solution','[]'::jsonb,NULL,1,NULL,NULL,$2::jsonb),
         ($1,$1,2,'Differentiate','worked_solution','[]'::jsonb,NULL,2,'y=7x','x',$3::jsonb),
         ($1,$1,3,'Differentiate, showing your working.','worked_solution','[]'::jsonb,NULL,3,'y=x^3','x',$4::jsonb),
         ($1,$1,4,'Pick one','multiple_choice','["a","b","c","d"]'::jsonb,2,1,NULL,NULL,NULL)`,
  [PAPER, JSON.stringify(TEXT), JSON.stringify(MATHS), JSON.stringify(LINES)]);
const ids = await q(`SELECT id, question_number FROM public.questions WHERE exam_id=$1 ORDER BY question_number`, [PAPER]);
const qid = n => ids.find(r => r.question_number === n).id;
const sit = async (work, picked) => {
  await x(`DELETE FROM public.live_sessions WHERE student_id='${STU}'`);
  await q(`INSERT INTO public.live_sessions (student_id, exam_id, assessment_id, student_name, status, work_answers_json)
           VALUES ($1,$2,$2,'S One','active',$3::jsonb)`, [STU, PAPER, JSON.stringify(work)]);
  return (await q(`SELECT public.submit_assessment($1,$2,$3::jsonb,60,0,'[]'::jsonb) AS r`,
    [STU, PAPER, JSON.stringify(picked)]))[0].r;
};
const r1 = await sit({ [qid(1)]: { lines: ['  Aileron.'] }, [qid(2)]: { lines: ["y'=7"] }, [qid(3)]: { lines: ['y=x^3', "y'=3x^2"] } }, { [qid(4)]: 2 });
ck('word + maths + full solution, all right: 6 of 6 typed marks', Number(r1.work_marks) === 6 && Number(r1.work_total) === 6, JSON.stringify(r1));
const r2 = await sit({ [qid(1)]: { lines: ['rudder'] }, [qid(2)]: { lines: ["y'=7"] }, [qid(3)]: { lines: ["y'=3x^2"] } }, { [qid(4)]: 0 });
ck('a wrong word earns nothing; the maths items mark as before (2 + 2 = 4)', Number(r2.work_marks) === 4, JSON.stringify(r2));
const att2 = (await q(`SELECT answers_json FROM public.review_attempts WHERE student_id=$1 AND attempt_no=2`, [STU]))[0].answers_json;
ck('the wrong word is stored as typed, with the reason', JSON.stringify(att2[qid(1)].lines) === '["rudder"]'
  && att2[qid(1)].correct === false && att2[qid(1)].reason === 'Not the right answer.', JSON.stringify(att2[qid(1)]));
// A word the maths marker would have taken: "aileron" as LaTeX letters is
// not what decides a text item, and a maths item is not judged as text.
const r3 = await sit({ [qid(1)]: { lines: ['FLAPERON'] }, [qid(2)]: { lines: ["Y'=7"] }, [qid(3)]: { lines: [] } }, {});
ck('the accept list counts in capitals; a maths answer is NOT made case-blind (1 + 0 + 0)', Number(r3.work_marks) === 1, JSON.stringify(r3));
{
  // save_worked_answers re-marks with the student's own copy, the same way.
  const sv = (await q(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb) AS r`,
    [STU, PAPER, TOK, JSON.stringify({ [qid(1)]: { lines: ['aileron'] } })]))[0].r;
  ck('save_worked_answers marks a text item too', Number(sv.work_marks) === 1, JSON.stringify(sv));
}

console.log('\n=== the exam screen learns which items are text ===');
{
  const r = await asAnon(`SELECT question_number, work_mode FROM public.get_exam_questions($1,$2,$3) ORDER BY 1`, [PAPER, STU, TOK]);
  ck('get_exam_questions works for the student', r.ok, r.message);
  ck('item 1 is "text", item 3 "lines", the others have no mode', r.ok && r.rows[0].work_mode === 'text'
    && r.rows[1].work_mode === null && r.rows[2].work_mode === 'lines' && r.rows[3].work_mode === null, JSON.stringify(r.rows));
  const raw = r.ok ? JSON.stringify(r.rows) : '';
  ck('…and the word is nowhere in what is sent', r.ok && !/aileron|flaperon/i.test(raw), raw.slice(0, 200));
}

console.log('\n=== the review ===');
const review = async () => {
  const r = await asAnon(`SELECT public.get_answer_review($1,$2,2,$3) AS r`, [STU, PAPER, TOK]);
  return r.ok ? Object.fromEntries(r.rows[0].r.map(row => [row.question_number, row])) : r.message;
};
{
  const rv = await review();
  ck('the missed word: what was typed, the mode, and the answer', rv[1].chosen === 'rudder' && rv[1].work_mode === 'text'
    && rv[1].correct_latex === 'aileron' && rv[1].is_correct === false, JSON.stringify(rv[1]));
  ck('the accept list is not released', !JSON.stringify(rv).includes('flaperon'));
}
await x(`UPDATE public.assessments SET review_shows_key = false WHERE id = '${PAPER}'`);
{
  const rv = await review();
  ck('key kept back: the missed word has no answer', rv[1].correct_latex === null && rv[1].key_hidden === true, JSON.stringify(rv[1]));
  ck('key kept back: the word is nowhere in the review', !/aileron/i.test(JSON.stringify(rv)));
}

console.log('\n=== the class analysis groups words as they are marked ===');
{
  const aj = v => ({ [qid(1)]: { lines: [v], marks: textAnswerVerdict(v, ['aileron']) === null ? 1 : 0, of: 1 } });
  const st = workedItemStats({ id: qid(1), marks: 1, work_rubric: TEXT }, [aj('Aileron'), aj('aileron.'), aj('rudder'), aj('RUDDER')]);
  ck('"Aileron" and "aileron." are one group; "rudder" and "RUDDER" another', st.groups.length === 2
    && st.groups.every(g => g.count === 2) && st.full === 2 && st.zero === 2, JSON.stringify(st.groups));
  const mst = workedItemStats({ id: qid(2), marks: 2, work_rubric: MATHS },
    [{ [qid(2)]: { lines: ["y'=7"], marks: 2 } }, { [qid(2)]: { lines: ["Y'=7"], marks: 0 } }]);
  ck('maths answers are still grouped exactly as written', mst.groups.length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
