// The whole loop, end to end: the template an instructor downloads, through
// the parser, into the database, answered by a student, and scored.
//
// Each half was already tested on its own, which is exactly how a format and
// a marker drift apart — the parser writes `accept`, the marker reads it, and
// nothing before this ran both against the same row.
//
//   npm run test:csv-scored
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuestionCSV } from '../../src/lib/questionCsv.js';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const asAnon = async (sql, p) => { try { await x(`SET ROLE anon`); return { ok: true, rows: await q(sql, p) }; }
  catch (e) { return { ok: false, message: e.message }; } finally { await x(`RESET ROLE`); } };

// The template, recovered from the button that writes it.
const src = fs.readFileSync(path.join(P, 'src/AdminDashboard.jsx'), 'utf8');
const start = src.indexOf('const downloadWeightedCSVTemplate = ');
const block = src.slice(start, src.indexOf("].join('\\n');", start));
const csv = [...block.matchAll(/^ {6}'(.*)',$/gm)]
  .map(m => m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')).join('\n');
const { questions, errors } = parseQuestionCSV(csv);
ck('the template parses with no errors', errors.length === 0, JSON.stringify(errors));

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
const INS = 'd24df77e-309a-4ed8-988f-da3ee1c76408', STU = '11111111-1111-1111-1111-111111111111', TOK = 'tk';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.users (id, full_name, section, session_token)
  VALUES ('${STU}','S','MATH 117','${TOK}');`);
for (const f of ['001_assessments_and_lessons','002_review_mode_and_server_scoring','003_lock_answer_key',
  '012_five_option_items','002b_grant_new_columns','015_archive_assessments','016_unlimited_choices',
  '017_shuffle_questions_switch','018_multi_select_items','019_exam_password_on_assessments',
  '020_exam_content_behind_the_gate','022_answer_review_needs_identity','024_worked_solution_items',
  '025_points_per_item','026_worked_answers_are_saved_and_scored','027_score_worked_in_the_database',
  '028_worked_items_in_answer_review','029_guarded_review_shows_worked_items']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

const PAPER = '9b4f3a10-2c1d-4b8e-9f77-5a6d0e2c1b33';
await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,
    duration_minutes,allow_retakes,show_answers)
  VALUES ('${PAPER}','exam','From the template','MATH 117','${INS}',true,60,true,true);`);

// Imported exactly as the dashboard imports them: the parsed rows, verbatim.
for (const item of questions) {
  await q(`INSERT INTO public.questions (exam_id, assessment_id, question_number, question_text,
      question_type, choices, correct_answer, correct_answers, marks,
      work_given, work_variable, work_rubric)
    VALUES ($1,$1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11::jsonb)`,
    [PAPER, questions.indexOf(item) + 1, item.question_text, item.question_type,
     JSON.stringify(item.choices || []), item.correct_answer ?? null,
     item.correct_answers ? JSON.stringify(item.correct_answers) : null,
     item.marks ?? 1, item.work_given ?? null, item.work_variable ?? null,
     item.work_rubric ? JSON.stringify(item.work_rubric) : null]);
}
ck('every row of the template inserts into a real database',
  (await q(`SELECT count(*)::int c FROM public.questions WHERE exam_id=$1`, [PAPER]))[0].c === questions.length);

const rows = await q(`SELECT id, question_number n, question_type t, marks, work_given g, work_rubric r
  FROM public.questions WHERE exam_id=$1 ORDER BY question_number`, [PAPER]);
const maths = rows.filter(r => r.t === 'worked_solution');
const byGiven = g => maths.find(r => r.g === g);

await q(`SELECT public.submit_assessment($1,$2,'{}'::jsonb,60,0,'[]'::jsonb)`, [STU, PAPER]);

console.log('\n=== a student answers the imported maths items ===');
// Deliberately in forms OTHER than the one typed in the template.
const TYPED = [
  ['\\lim_{x\\to 2}(x+3)', '5',              true,  'the plain answer'],
  ['y=5x',                 '\\frac{dy}{dx}=5', true, 'Leibniz, handled by normalisation'],
  ['y=\\ln(x)',            "y'=x^{-1}",      true,  'needs the accept list'],
  ['y=\\int 2x\\,dx',      'y=x^2+K',        true,  'a different constant, also from the list'],
];
const work = {};
for (const [g, typed] of TYPED) work[byGiven(g).id] = { lines: [typed] };
const saved = await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb) AS r`,
  [STU, PAPER, TOK, JSON.stringify(work)]);
ck('the save-and-score call succeeds', saved.ok, saved.message);

const stored = (await q(`SELECT answers_json, work_marks, work_total
  FROM public.review_attempts WHERE student_id=$1`, [STU]))[0];
for (const [g, typed, want, why] of TYPED) {
  const got = stored.answers_json[byGiven(g).id];
  ck(`${typed}  (${why})`, got?.correct === want, JSON.stringify({ got: got?.correct, marks: got?.marks }));
}
const expected = TYPED.reduce((t, [g]) => t + Number(byGiven(g).marks), 0);
ck(`all four score their full marks: ${expected}`,
  Number(stored.work_marks) === expected, `${stored.work_marks} of ${stored.work_total}`);

console.log('\n=== and wrong answers still score nothing ===');
const wrong = {};
wrong[byGiven('y=5x').id] = { lines: ["y'=5x"] };
wrong[byGiven('y=\\ln(x)').id] = { lines: ["y'=\\ln(x)"] };
await asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb)`,
  [STU, PAPER, TOK, JSON.stringify(wrong)]);
const after = (await q(`SELECT answers_json FROM public.review_attempts WHERE student_id=$1`, [STU]))[0];
ck('a wrong derivative earns nothing', after.answers_json[byGiven('y=5x').id]?.correct === false);
ck('and neither does copying the question back',
  after.answers_json[byGiven('y=\\ln(x)').id]?.correct === false);

console.log('\n=== the student can review what they did ===');
{
  const r = await asAnon(`SELECT public.get_answer_review($1,$2,NULL,$3) AS r`, [STU, PAPER, TOK]);
  const items = r.ok ? r.rows[0].r : [];
  ck('the review returns every item on the imported paper',
    items.length === questions.length - 1, `${items.length} of ${questions.length} (essays excluded)`);
  const w = items.filter(i => i.question_type === 'worked_solution');
  ck('each maths item shows its problem and its answer',
    w.length === maths.length && w.every(i => i.work_given && i.correct_latex),
    JSON.stringify(w.map(i => [!!i.work_given, !!i.correct_latex])));
  ck('the accept list is not in what the student receives',
    !JSON.stringify(items).includes('x^{-1}') || !JSON.stringify(items).includes('accept'),
    'accept must not be a key on any row');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
