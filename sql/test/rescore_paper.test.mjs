// sql/131: re-score a paper after its key changes. Runs the migrations as
// live (through 116, 119, 120, 123, 130) + 131 against real PostgreSQL
// (PGlite), as the roles a browser has. Sittings are filed through
// submit_assessment(); then keys change (a choice that also counts, a unit
// to accept, a key that was wrong). A preview writes nothing; 'raise' only
// ever lifts an item; 'full' lets an item fall; totals follow the items;
// a hand mark is never touched; only the paper's instructor may call it;
// pages of sittings join up.
//   npm run test:rescore
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const db = new PGlite();
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
process.on('unhandledRejection', e => { console.error('\nREJECTED:', e?.message || e); process.exit(1); });
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const as = role => async (sql, params, uid = '') => {
  try {
    await x(`SET test.uid = '${uid}'`);
    await x(`SET ROLE ${role}`);
    return { ok: true, rows: await q(sql, params) };
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  } finally {
    await x(`RESET ROLE; SET test.uid = ''`);
  }
};
const asAnon = as('anon'), asInstructor = as('authenticated');

await x(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`);
const setup = fs.readFileSync(P + '/supabase_setup.sql', 'utf8');
await x(setup.match(/CREATE TABLE IF NOT EXISTS public\.\w+\s*\([^;]*?\);/gs).join('\n'));
await x(`ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS description text;
         ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS category text;`);
await x(setup.match(/ALTER TABLE public\.\w+\s+ENABLE ROW LEVEL SECURITY;/g).join('\n'));
await x(setup.match(/^(DROP POLICY IF EXISTS|CREATE POLICY)[\s\S]*?;/gm).filter(s => !/storage\./.test(s)).join('\n'));
await x(setup.match(/CREATE OR REPLACE FUNCTION public\.verify_exam_password[\s\S]*?END; \$\$;/)[0]);
await x(setup.match(/^(GRANT|REVOKE)[\s\S]*?;/gm).filter(g => /public\./.test(g) && !/storage|FUNCTION/.test(g)).join('\n'));
await x(`CREATE PUBLICATION supabase_realtime;`);

const INS = 'd24df77e-309a-4ed8-988f-da3ee1c76408';   // the paper's instructor
const OTH = 'c0ffee00-0000-4000-8000-000000000115';   // another instructor
const STU = '11111111-1111-1111-1111-111111111111', TOK = 'f0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1a';
const ABS = '22222222-2222-2222-2222-222222222222', TAB = 'a0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1b';   // the absent one
const EARLY = '33333333-3333-3333-3333-333333333333', TEA = 'b0e1d2c3-b4a5-4968-8778-6f5e4d3c2b1c'; // sitting before the switch
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph'), ('${OTH}','o@p.ph');
  INSERT INTO public.users (id, full_name, section, session_token) VALUES
    ('${STU}','Present, Paula','Aeng 427 -3B','${TOK}'),
    ('${ABS}','Absent, Arturo','Aeng 427 -5B','${TAB}'),
    ('${EARLY}','Early, Ester','Aeng 427 -3B','${TEA}');`);

const MIG = ['001_assessments_and_lessons', '002_review_mode_and_server_scoring', '003_lock_answer_key',
  '012_five_option_items', '002b_grant_new_columns', '015_archive_assessments', '016_unlimited_choices',
  '017_shuffle_questions_switch', '018_multi_select_items', '019_exam_password_on_assessments',
  '020_exam_content_behind_the_gate', '021_revoke_direct_question_reads', '022_answer_review_needs_identity',
  '023_drop_unidentified_answer_review', '024_worked_solution_items', '025_points_per_item',
  '026_worked_answers_are_saved_and_scored', '027_score_worked_in_the_database',
  '028_worked_items_in_answer_review', '029_guarded_review_shows_worked_items',
  '030_primes_as_the_editor_writes_them', '031_any_function_name_is_a_subject',
  '032_a_label_is_part_of_the_answer', '033_a_minus_may_sit_on_the_numerator',
  '036_four_primes_and_brackets', '037_keyboard_leftovers', '038_any_arrow_is_to',
  '039_submit_files_the_working', '042_working_marked_line_by_line', '043_partial_working_earns_more',
  '045_brackets_that_change_nothing', '046_answers_typed_as_words',
  '050_answers_as_the_keyboard_spells_them', '053_marking_fast_again', '054_time_to_submit',
  '058_keyboard_spellings_fast', '061_minus_out_of_a_bracket', '066_times_between_numbers_and_zero_terms',
  '071_the_keyboards_e_is_e', '073_logic_proofs_line_by_line', '076_two_law_steps_and_equations',
  '081_hyperbolic_functions_as_typed', '083_file_before_marking',
  '094_removing_a_student_keeps_other_instructors_students', '095_writes_belong_to_the_papers_instructors',
  '105_answers_with_units', '107_papers_without_sets', '110_duplicate_any_paper',
  '115_admit_students_from_the_live_monitor'];
for (const f of MIG) await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
for (const f of ['116_papers_with_sets', '119_display_style_is_not_part_of_an_answer', '120_force_submit_in_one_step', '123_quantity_answers_within_a_tolerance'])
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
const S130 = fs.readFileSync(`${P}/sql/130_either_answer_counts.sql`, 'utf8');
const run130 = async () => { try { await x(S130); return ''; } catch (e) { await x('ROLLBACK').catch(() => {}); return e.message; } };

await x(S130);
await x(fs.readFileSync(`${P}/sql/131_rescore_a_paper.sql`, 'utf8'));
await x(fs.readFileSync(`${P}/sql/131_rescore_a_paper.sql`, 'utf8'));
{ const S = fs.readFileSync(`${P}/sql/131_rescore_a_paper.sql`, 'utf8');
  const [r] = await q(S.slice(S.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim());
  ck('131 applies twice; VERIFY all true', Object.values(r).every(v => v === true), JSON.stringify(r)); }
await x(`INSERT INTO public.instructors (id, email, full_name) VALUES ('${INS}','i@p.ph','Ins'), ('${OTH}','o@p.ph','Oth') ON CONFLICT DO NOTHING`);

const PAPER = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1131';
const Q1 = 'f1f1f1f1-0000-4000-8000-000000000001', Q2 = 'f1f1f1f1-0000-4000-8000-000000000002', Q3 = 'f1f1f1f1-0000-4000-8000-000000000003';
const RUB = units => JSON.stringify({ mode: 'quantity', parts: [{ key: 'a', value: '2.67', decimals: 2, units, value_marks: 2, unit_marks: 2 }] });
await x(`INSERT INTO public.assessments (id, kind, title, target_section, instructor_id, is_open, duration_minutes)
  VALUES ('${PAPER}','exam','Re-score me','Aeng 427 -3B, Aeng 427 -5B','${INS}',true,60);
  INSERT INTO public.questions (id, exam_id, assessment_id, question_number, question_text, question_type, choices, correct_answer, correct_answers, marks, work_given, work_rubric) VALUES
    ('${Q1}','${PAPER}','${PAPER}',1,'Pick A','multiple_choice','["a","b","c","d"]'::jsonb,0,NULL,2,NULL,NULL),
    ('${Q2}','${PAPER}','${PAPER}',2,'Tick A and B','multi_select','["a","b","c","d"]'::jsonb,NULL,'[0,1]'::jsonb,1,NULL,NULL),
    ('${Q3}','${PAPER}','${PAPER}',3,'Speed','worked_solution',NULL,NULL,NULL,4,'a) Speed (2 decimal places)','${RUB(['m/s'])}'::jsonb);`);
const sitting = async (stu, tok, picks, speed) => {
  await x(`INSERT INTO public.live_sessions (student_id, exam_id, student_name, status, work_answers_json)
    VALUES ('${stu}','${PAPER}','x','active','${JSON.stringify({ [Q3]: { lines: [`a) ${speed}`] } })}'::jsonb)`);
  const r = await asAnon(`SELECT public.submit_assessment($1,$2,$3::jsonb,600,0,'[]'::jsonb) r`, [stu, PAPER, JSON.stringify(picks)]);
  if (!r.ok) console.log('  submit failed:', r.message);
};
await sitting(STU, TOK, { [Q1]: 2, [Q2]: [0, 1] }, '2.67 mps');     // Paula: C (wrong), multi right, unit wrong → 1 + 2 = 3
await sitting(EARLY, TEA, { [Q1]: 0, [Q2]: [0] }, '2.67 m/s');     // Ester: A (right), multi wrong, full → 2 + 4 = 6
await sitting(ABS, TAB, { [Q1]: 3 }, '9 m/s');                       // Arturo: D, typed wrong value → 0 + 2 = 2, then hand-marked 4
const row = async stu => (await q(`SELECT score, points_earned, work_marks, answers_json a FROM public.results WHERE student_id = $1 AND exam_id = $2`, [stu, PAPER]))[0];
const tot = r => Number(r.points_earned) + Number(r.work_marks);
{
  const a = await row(ABS);
  await q(`UPDATE public.results SET answers_json = jsonb_set(answers_json, '{${Q3}}', answers_json -> '${Q3}' || '{"marks": 4, "reason": "Marked by instructor. Checker said: x"}'::jsonb), work_marks = 4 WHERE student_id = $1 AND exam_id = $2`, [ABS, PAPER]);
  void a;
}
ck('as filed: Paula 3, Ester 6, Arturo 4 (hand mark)', tot(await row(STU)) === 3 && tot(await row(EARLY)) === 6 && tot(await row(ABS)) === 4,
  [tot(await row(STU)), tot(await row(EARLY)), tot(await row(ABS))].join(','));

const rescore = (mode, apply, uid = INS, offset = 0, limit = 10) =>
  asInstructor(`SELECT public.rescore_paper($1, $2, $3, $4, $5) r`, [PAPER, mode, apply, offset, limit], uid);

console.log('\n=== WHO MAY ===');
ck('a student cannot call it', !(await asAnon(`SELECT public.rescore_paper($1)`, [PAPER])).ok);
ck('another instructor cannot', /access/i.test((await rescore('raise', false, OTH)).message || ''));
ck('a mode other than raise or full is refused', !(await rescore('down', false)).ok);

console.log('\n=== C ALSO COUNTS, AND "mps" IS A UNIT: RAISE ===');
await x(`UPDATE public.questions SET accepted_answers = '[2]' WHERE id = '${Q1}';
         UPDATE public.questions SET work_rubric = '${RUB(['m/s', 'mps'])}'::jsonb WHERE id = '${Q3}';`);
{
  const before = JSON.stringify(await row(STU));
  const r = await rescore('raise', false);
  const rows = r.rows?.[0]?.r?.rows || [];
  const paula = rows.find(x => x.name === 'Present, Paula');
  ck('preview: only Paula changes, 3 → 7, items 1 and 3', r.ok && rows.length === 1 && paula?.from === 3 && paula?.to === 7
    && JSON.stringify(paula.items.map(i => i.n).sort()) === '[1,3]', r.message || JSON.stringify(rows));
  ck('a preview writes nothing', JSON.stringify(await row(STU)) === before);
  ck('the hand-marked sitting is not in it', !rows.some(x => x.name === 'Absent, Arturo'));
}
{
  const r = await rescore('raise', true);
  const p = await row(STU);
  ck('applied: Paula 7 — C right (2), multi right (1), 2.67 mps 4/4', r.ok && tot(p) === 7 && p.score === 2 && p.a[Q1].is_correct === true && Number(p.a[Q3].marks) === 4, r.message || JSON.stringify(p));
  ck('Ester untouched (6), Arturo\'s hand mark untouched (4)', tot(await row(EARLY)) === 6 && tot(await row(ABS)) === 4 && /^Marked by instructor/.test((await row(ABS)).a[Q3].reason));
  ck('a second raise changes nothing', ((await rescore('raise', false)).rows?.[0]?.r?.rows || []).length === 0);
}

console.log('\n=== THE KEY WAS WRONG: B, NOT A ===');
await x(`UPDATE public.questions SET correct_answer = 1, accepted_answers = NULL WHERE id = '${Q1}'`);
{
  const raise = (await rescore('raise', false)).rows?.[0]?.r?.rows || [];
  ck('raise: nobody goes down', raise.every(x => x.to >= x.from), JSON.stringify(raise));
  const full = (await rescore('full', false)).rows?.[0]?.r?.rows || [];
  const names = full.map(x => `${x.name}:${x.from}→${x.to}`).sort();
  ck('full preview: Ester 6 → 4 and Paula 7 → 5 (A and C no longer count)', JSON.stringify(names) === JSON.stringify(['Early, Ester:6→4', 'Present, Paula:7→5']), JSON.stringify(names));
  await rescore('full', true);
  ck('full applied: Ester 4, Paula 5, Arturo\'s hand mark still 4', tot(await row(EARLY)) === 4 && tot(await row(STU)) === 5 && tot(await row(ABS)) === 4);
}

console.log('\n=== PAGES ===');
await x(`UPDATE public.questions SET correct_answer = 3 WHERE id = '${Q1}'`);
{
  const p1 = (await rescore('raise', false, INS, 0, 2)).rows?.[0]?.r;
  const p2 = (await rescore('raise', false, INS, p1?.next_offset ?? 99, 2)).rows?.[0]?.r;
  ck('a page of 2 of 3 sittings says where the next starts; the last says none', p1?.sittings === 3 && p1?.next_offset === 2 && p2?.next_offset === null, JSON.stringify([p1?.next_offset, p2?.next_offset]));
  const all = [...(p1?.rows || []), ...(p2?.rows || [])].map(x => x.name);
  ck('the pages together find Arturo (D is now right)', all.includes('Absent, Arturo'), JSON.stringify(all));
}

console.log('\n=== ANSWER REVIEW SHOWS EACH PART (132) ===');
{
  const S132 = fs.readFileSync(`${P}/sql/132_review_shows_each_part.sql`, 'utf8');
  await x(S132); await x(S132);
  const [v] = await q(S132.slice(S132.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim());
  ck('132 applies twice; VERIFY true', v.review_sends_parts === true && v.review_sends_key_when_shown === true, JSON.stringify(v));
  await x(`UPDATE public.assessments SET show_answers = true, review_shows_key = false WHERE id = '${PAPER}'`);
  const r = await asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3) r`, [STU, PAPER, TOK]);
  const rows = r.rows?.[0]?.r || [];
  const typed = rows.find(x => x.question_id === Q3);
  const part = typed?.parts?.[0];
  ck('the typed item comes with its parts: a, 4 of 4, value and unit right', r.ok && part?.key === 'a' && Number(part.marks) === 4 && Number(part.of) === 4 && part.value_ok === true && part.unit_ok === true, r.message || JSON.stringify(typed));
  ck('…and nothing of the key: no value, units or rubric in the part', part && !('value' in part) && !('units' in part) && !JSON.stringify(typed).includes('2.67"'), JSON.stringify(part));
  const picked = rows.find(x => x.question_id === Q1);
  ck('a picked item has no parts', picked && (picked.parts === undefined || picked.parts === null));
  ck('the key is not sent while the paper hides it', !typed?.key_parts);
  await x(`UPDATE public.assessments SET review_shows_key = true WHERE id = '${PAPER}'`);
  const r2 = await asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3) r`, [STU, PAPER, TOK]);
  const t2 = (r2.rows?.[0]?.r || []).find(x => x.question_id === Q3);
  ck('when the paper shows the key: each part\'s right value and unit (2.67 m/s)', JSON.stringify(t2?.key_parts) === JSON.stringify([{ key: 'a', unit: 'm/s', value: '2.67' }]), JSON.stringify(t2?.key_parts));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
