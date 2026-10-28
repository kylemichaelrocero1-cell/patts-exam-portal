// sql/110: Duplicate works on every paper, and the copy is the whole paper.
//
//   * a paper that lives only in assessments (a mock exam, a seatwork, one
//     loaded from the SQL editor) is copied — the old duplicate_exam()
//     refused it with "You do not have access to this exam";
//   * every item is copied as it is: choices, keys, multi-answer keys,
//     points, typed-answer keys and rubrics; and the paper's settings;
//   * the copy is closed and unscheduled, and belongs to the caller or the
//     instructor it is given to; the source is untouched;
//   * only the owner, or an instructor it is shared with, may copy it;
//     students cannot call it;
//   * 110 runs twice, and its VERIFY row is all true.
//
// Look-alike papers only.
//
//   npm run test:duplicate
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const J = v => JSON.stringify(v);
const as = async (role, uid, sql, params) => {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid || '']);
  await x(`SET ROLE ${role}`);
  try { return { ok: true, rows: await q(sql, params) }; }
  catch (e) { return { ok: false, message: e.message }; }
  finally { await x('RESET ROLE'); }
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
  '073_logic_proofs_line_by_line', '107_papers_without_sets']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}


const KAI = 'a0000000-0000-0000-0000-0000000000a1', BEA = 'b0000000-0000-0000-0000-0000000000b1';
const COL = 'c0000000-0000-0000-0000-0000000000c1';
await x(`INSERT INTO auth.users VALUES ('${KAI}','k@p.ph'),('${BEA}','b@p.ph'),('${COL}','c@p.ph');
  INSERT INTO public.instructors (id, email, full_name) VALUES ('${KAI}','k@p.ph','Kai'),('${BEA}','b@p.ph','Bea'),('${COL}','c@p.ph','Col');`);
const SRC = '5a000000-0000-0000-0000-000000000001';
await x(`INSERT INTO public.assessments (id, kind, title, description, target_section, instructor_id, is_open,
    opens_at, closes_at, duration_minutes, exam_password, has_password, allow_retakes, show_answers, score_policy,
    review_shows_key, shuffle_choices, shuffle_questions, uses_sets)
  VALUES ('${SRC}','seatwork','Look-alike Seatwork','About things.','AERO 101','${KAI}',true,
    now() - interval '1 day', now() + interval '1 day', 45, 'pw', true, true, true, 'latest',
    false, false, true, false);`);
const RUBRIC = { mode: 'quantity', parts: [{ key: 'a', value: '12', decimals: 0, units: ['crates'] }] };
await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text, question_type,
    category, choices, correct_answer, correct_answers, marks, work_given, work_variable, work_rubric)
  VALUES ($1,$1,1,'Pick one','multiple_choice','Part A','["w","x","y","z"]'::jsonb,2,NULL,2,NULL,NULL,NULL),
         ($1,$1,2,'Pick all','multi_select','Part A','["w","x","y","z","v"]'::jsonb,NULL,'[0,3]'::jsonb,1,NULL,NULL,NULL),
         ($1,$1,3,'Type it','worked_solution','Part B','[]'::jsonb,NULL,NULL,5,'y=x^2','x','{"steps":[{"latex":"2x","marks":5}]}'::jsonb),
         ($1,$1,4,'Quantities','worked_solution','Part B','[]'::jsonb,NULL,NULL,2,'a) Count',NULL,$2::jsonb)`,
  [SRC, J(RUBRIC)]);
ck('the source lives only in assessments, as a loaded paper does',
   (await q(`SELECT count(*)::int c FROM public.exams WHERE id=$1`, [SRC]))[0].c === 0);

await x(setup.match(/CREATE OR REPLACE FUNCTION public\.duplicate_exam[\s\S]*?END; \$\$;/)[0]
  + '\nGRANT EXECUTE ON FUNCTION public.duplicate_exam(uuid, text, text, uuid) TO authenticated;');

console.log('\n=== before 110: the old button ===');
{
  const r = await as('authenticated', KAI, `SELECT public.duplicate_exam($1,'Copy','AERO 102',$2)`, [SRC, KAI]);
  ck('duplicate_exam() refuses a paper the owner holds — the reported bug',
     !r.ok && /do not have access/.test(r.message), r.message);
}

console.log('\n=== 110 applies ===');
const M = fs.readFileSync(P + '/sql/110_duplicate_any_paper.sql', 'utf8');
await x(M);
await x(M);
ck('110 applies, twice', true);
{
  const [v] = await q(M.slice(M.indexOf('-- VERIFY')).replace(/^--.*$/gm, '').trim());
  ck("110's VERIFY row is all true", Object.values(v).every(b => b === true), J(v));
}

const COLS = `question_number, question_text, question_type, category, choices, correct_answer, correct_answers,
  marks, work_given, work_variable, work_rubric`;
const itemsOf = async id => q(`SELECT ${COLS} FROM public.questions WHERE exam_id=$1 ORDER BY question_number`, [id]);
const srcItems = await itemsOf(SRC);

console.log('\n=== the owner copies it ===');
{
  const r = await as('authenticated', KAI, `SELECT public.duplicate_paper($1,'  Copy for B  ','AERO 102', NULL) AS id`, [SRC]);
  ck('the owner can duplicate a paper that is only in assessments', r.ok, r.message);
  const id = r.rows?.[0]?.id;
  const [c] = await q(`SELECT * FROM public.assessments WHERE id=$1`, [id]);
  ck('the copy is the caller\'s, with the new title and section', c.instructor_id === KAI && c.title === 'Copy for B' && c.target_section === 'AERO 102');
  ck('…closed and unscheduled', c.is_open === false && c.opens_at === null && c.closes_at === null);
  ck('…with the paper\'s settings', c.kind === 'seatwork' && c.description === 'About things.' && c.duration_minutes === 45
     && c.exam_password === 'pw' && c.has_password && c.allow_retakes && c.show_answers && c.score_policy === 'latest'
     && c.review_shows_key === false && c.shuffle_choices === false && c.shuffle_questions === true && c.uses_sets === false, J(c));
  const items = await itemsOf(id);
  ck('every item is copied as it is: choices, keys, multi-answer keys, points, rubrics',
     J(items) === J(srcItems), J(items.map(i => [i.question_type, i.marks])));
  const [s] = await q(`SELECT title, is_open, instructor_id FROM public.assessments WHERE id=$1`, [SRC]);
  ck('the source is untouched', s.title === 'Look-alike Seatwork' && s.is_open === true && s.instructor_id === KAI
     && J(await itemsOf(SRC)) === J(srcItems));
}

console.log('\n=== giving a copy to another instructor ===');
{
  const r = await as('authenticated', KAI, `SELECT public.duplicate_paper($1,'For Bea','AENG 223L',$2) AS id`, [SRC, BEA]);
  const [c] = r.ok ? await q(`SELECT instructor_id FROM public.assessments WHERE id=$1`, [r.rows[0].id]) : [{}];
  ck('the owner can give the copy to a colleague', r.ok && c.instructor_id === BEA, r.message);
  const n = await as('authenticated', KAI, `SELECT public.duplicate_paper($1,'x','y',$2)`, [SRC, 'd0000000-0000-0000-0000-000000000000']);
  ck('…but not to someone who is not an instructor', !n.ok && /not found/.test(n.message), n.message);
}

console.log('\n=== who may copy ===');
{
  const r = await as('authenticated', BEA, `SELECT public.duplicate_paper($1,'Mine now','AENG 223L',NULL)`, [SRC]);
  ck("an instructor cannot copy someone else's paper", !r.ok && /own or one shared/.test(r.message), r.message);
  // A share points at the legacy row, so this paper is made the old way.
  const OLD = '5a000000-0000-0000-0000-000000000002';
  await x(`INSERT INTO public.exams (id, title, target_section, instructor_id, is_open, duration_minutes)
             VALUES ('${OLD}','Older Quiz','AERO 101','${KAI}',false,30);
           INSERT INTO public.exam_shares (exam_id, shared_by, shared_with) VALUES ('${OLD}','${KAI}','${COL}')`);
  const s = await as('authenticated', COL, `SELECT public.duplicate_paper($1,'Shared copy','AERO 103',NULL) AS id`, [OLD]);
  ck('an instructor it is shared with can', s.ok, s.message);
  const o = await as('authenticated', KAI, `SELECT public.duplicate_paper($1,'Older copy','AERO 104',NULL) AS id`, [OLD]);
  ck('a paper made the old way copies too', o.ok, o.message);
  const a = await as('anon', null, `SELECT public.duplicate_paper($1,'x','y',NULL)`, [SRC]);
  ck('a student cannot call it', !a.ok && /permission denied/.test(a.message), a.message);
  const b = await as('authenticated', KAI, `SELECT public.duplicate_paper($1,'  ','AERO 101',NULL)`, [SRC]);
  ck('a copy needs a title', !b.ok && /title and a section/.test(b.message), b.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
