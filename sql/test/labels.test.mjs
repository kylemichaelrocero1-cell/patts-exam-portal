// sql/032: a label is part of the answer. "Find the second derivative" was
// answered f(x) = 12x^2 - 12x and marked right, because the label was
// stripped and only the value compared.
//
// Two things are tested hard here. The rule itself, in the database that
// applies it. And that the database and src/lib/mathLabel.js — the same rule
// in the dashboard, which re-marks a script when an instructor opens it —
// give the same answer on every case, because a disagreement means saving a
// script from the dashboard silently overturns the database's mark.
//
//   npm run test:labels
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelOf, labelsAgree } from '../../src/lib/mathLabel.js';
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
process.on('uncaughtException', e => { console.error('\nUNCAUGHT:', e.message); process.exit(1); });
const x = s => db.exec(s);
const q = async (s, p) => (await db.query(s, p)).rows;
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const asAnon = async (sql, p) => { try { await x(`SET ROLE anon`); return { ok: true, rows: await q(sql, p) }; }
  catch (e) { return { ok: false, message: e.message }; } finally { await x(`RESET ROLE`); } };
const one = async (sql, p) => Object.values((await q(sql, p))[0])[0];
const verdict = (a, acc) => one(`SELECT public.worked_answer_verdict($1, $2::text[]) v`, [a, acc]);
const match = (a, b) => one(`SELECT public.math_answers_match($1,$2) m`, [a, b]);

// ── The schema, exactly as score_worked_in_db builds it ────────────────
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
const TOK = 'tok-a';
await x(`INSERT INTO auth.users VALUES ('${INS}','i@p.ph');
  INSERT INTO public.users (id, full_name, section, session_token)
  VALUES ('${STU}','S One','MATH 117','${TOK}');`);
for (const f of ['001_assessments_and_lessons','002_review_mode_and_server_scoring','003_lock_answer_key',
  '012_five_option_items','002b_grant_new_columns','015_archive_assessments','016_unlimited_choices',
  '017_shuffle_questions_switch','018_multi_select_items','019_exam_password_on_assessments',
  '020_exam_content_behind_the_gate','024_worked_solution_items','025_points_per_item',
  '026_worked_answers_are_saved_and_scored','027_score_worked_in_the_database',
  '030_primes_as_the_editor_writes_them','031_any_function_name_is_a_subject']) {
  await x(fs.readFileSync(`${P}/sql/${f}.sql`, 'utf8'));
}

console.log('=== before 032: the bug ===');
const Q27 = ["f''(x)=12x^2-12x"];
ck('f(x) = 12x^2 - 12x MATCHED the second derivative — the bug',
  await match('f(x)=12x^2-12x', Q27[0]));

const MIG = fs.readFileSync(P + '/sql/032_a_label_is_part_of_the_answer.sql', 'utf8');
await x(MIG);
await x(MIG);
ck('032 applies, twice', true);

console.log('\n=== the item that started this: MATH 117 Q27 ===');
for (const [a, right, why] of [
  ['f(x)=12x^2-12x', false, 'the function is not its second derivative'],
  ['12x^2-12x', false, 'no label at all'],
  ['f^{\\prime}(x)=12x^2-12x', false, 'a first derivative is not a second'],
  ["f'''(x)=12x^2-12x", false, 'nor is a third'],
  ['g^{\\prime\\prime}(x)=12x^2-12x', false, 'a different function'],
  ["f''(t)=12x^2-12x", false, 'a different variable'],
  ["F''(x)=12x^2-12x", false, 'case counts: F is not f'],
  ['f^{\\prime\\prime}(x)=12x^2-12x', true, 'as the editor writes it'],
  ["f''(x)=12x^2-12x", true, 'as a person types it'],
  ['f^{\\prime\\prime}\\left(x\\right)=12x^{2}-12x', true, 'with \\left( and braces'],
  ["f''=12x^2-12x", true, 'without the (x)'],
  ['y^{\\prime\\prime}=12x^2-12x', true, "y'' stands in for f''(x)"],
  ['\\frac{d^2y}{dx^2}=12x^2-12x', true, 'Leibniz, in y'],
  ['\\frac{d^2f}{dx^2}=12x^2-12x', true, 'Leibniz, in f'],
  ['\\frac{d^2}{dx^2}f(x)=12x^2-12x', true, 'as an operator'],
  ['\\frac{\\mathrm{d}^2y}{\\mathrm{d}x^2}=12x^2-12x', true, 'with an upright d'],
  ['\\frac{d^2y}{dt^2}=12x^2-12x', false, 'Leibniz about the wrong variable'],
  ["f''(x)=12x^2-12", false, 'right label, wrong value'],
]) {
  const v = await verdict(a, Q27);
  ck(`${right ? 'RIGHT' : 'wrong'}  ${a}  — ${why}`, (v === null) === right, String(v));
}
ck('the reason names what was written and what was asked',
  await verdict('f(x)=12x^2-12x', Q27) === "Right value, but the wrong label: f(x) where the question asks for f''(x).",
  await verdict('f(x)=12x^2-12x', Q27));
ck('a missing label says so',
  /no label — the answer should begin f''\(x\) =/.test(await verdict('12x^2-12x', Q27)));
ck('a wrong value is reported as a wrong value',
  await verdict("f(x)=12x^2", Q27) === 'Not an accepted answer.');

console.log('\n=== an accept list that mixes labelled and bare forms (Q17, Q28) ===');
const Q17 = ["g'(x)=\\frac{x}{\\sqrt{x^2+1}}", '\\frac{x}{\\sqrt{x^2+1}}', 'x/\\sqrt{x^2+1}',
             "g'(x)=x/\\sqrt{x^2+1}", 'x(x^2+1)^{-1/2}'];
ck("a bare accept entry does not let a WRONG label through: g(x) = x/√(x²+1)",
  await verdict('g(x)=\\frac{x}{\\sqrt{x^2+1}}', Q17) !== null);
ck("nor no label at all", await verdict('\\frac{x}{\\sqrt{x^2+1}}', Q17) !== null);
ck("the key's label with an accepted bare VALUE is right: g'(x) = x(x²+1)^(-1/2)",
  await verdict("g^{\\prime}(x)=x(x^2+1)^{-1/2}", Q17) === null);
const Q28 = ['\\frac{d^3y}{dx^3}=180x^2', '180x^2', "y'''=180x^2", 'd^3y/(dx^3)=180x^2'];
for (const [a, right] of [
  ["y^{\\prime\\prime\\prime}=180x^2", true], ['d^3y/dx^3=180x^2', true], ['d^3y/(dx^3)=180x^2', true],
  ["y''=180x^2", false], ['180x^2', false], ['y=180x^2', false], ["f'''(x)=180x^2", false],
]) {
  ck(`Q28 ${right ? 'RIGHT' : 'wrong'}  ${a}`, ((await verdict(a, Q28)) === null) === right,
    String(await verdict(a, Q28)));
}

console.log('\n=== a key with no label judges none ===');
ck('a limit answered 6', await verdict('6', ['6']) === null);
ck('or L = 6', await verdict('L=6', ['6']) === null);
ck('h\'\'(2) = 12 against a bare 12 — a label taken at a number is still a label',
  await verdict("h^{\\prime\\prime}(2)=12", ['12']) === null);
ck('and a wrong number is still wrong', await verdict('7', ['6']) !== null);
ck('an expression answer with dy/dx inside it is not mistaken for a label',
  await verdict('3y^2\\frac{dy}{dx}', ['3y^2\\frac{dy}{dx}']) === null);

console.log('\n=== what must NOT change ===');
ck('2x = 6 is still not x = 3 (031)', !(await match('2x=6', 'x=3')));
ck('and x = 3 is right for x = 3', await verdict('x=3', ['x=3']) === null);
ck('y = 3 does not stand in for x = 3 — x is the unknown, not a function',
  await verdict('y=3', ['x=3']) !== null);
ck("the editor's prime still matches a typed one (030)", await match('y^{\\prime}=6x', "y'=6x"));
ck('numbers still compare as numbers', await match('2', '2.0') && await match('\\frac{1}{4}', '0.25'));
ck('an unfinished answer still does not match', !(await match('\\cos(\\placeholder{})', '\\cos(x)')));
ck("Leibniz still equals Lagrange on the value", await verdict('\\frac{dy}{dx}=-\\frac{x}{y}', ['dy/dx=-x/y', '-x/y', '\\frac{dy}{dx}=-\\frac{x}{y}']) === null);

console.log('\n=== the database and the dashboard agree ===');
// The same corpus through math_label() and labelOf(). Anything one calls a
// label and the other does not is exactly the disagreement that would let a
// saved script overturn the database's mark.
const CORPUS = [
  'f(x)=1', "f'(x)=1", 'f^{\\prime\\prime}(x)=1', "f'''=1", 'y=1', "y''=1", 'x=3', 'L=6', 'd(t)=1',
  "d'(t)=1", "h''(2)=12", "h''(-1.5)=0", 'f^{(4)}(x)=0', 'm^{(4)}(v)=0', 'F(x)=1', 'Y=1',
  '\\frac{dy}{dx}=1', '\\frac{d^2y}{dx^2}=1', '\\frac{d^{2}y}{dx^{2}}=1', '\\dfrac{d^3y}{dx^3}=1',
  'dy/dx=1', 'd^2y/dx^2=1', 'dy/(dx)=1', 'd^3y/(dx^3)=1', '\\frac{d}{dx}y=1',
  '\\frac{d^2}{dx^2}f(x)=1', '\\frac{\\mathrm{d}y}{\\mathrm{d}x}=1', '\\frac{d^2y}{dx}=1',
  '2x=6', 'x+1=2', '12x^2-12x', '6', 'f(x,y)=1', 'ff(x)=1', "\\sin(x)=1", '\\lim_{x\\to3}f(x)=6',
  'f^{\\prime}\\left(x\\right)=1', 'y^{\\prime\\prime\\prime}=1', 'g\\,^{\\prime}(x) = 1',
];
const jsCanon = l => (l ? `${l.fn}|${l.order}|${l.at}` : null);
let disagree = [];
for (const s of CORPUS) {
  const sql = await one(`SELECT public.math_label($1) l`, [s]);
  const js = jsCanon(labelOf(s));
  if (sql !== js) disagree.push(`${s}: sql=${sql} js=${js}`);
}
ck(`math_label() and labelOf() read all ${CORPUS.length} left-hand sides the same`, disagree.length === 0, disagree.join('; '));

const labelled = CORPUS.filter(s => labelOf(s));
disagree = [];
for (const a of labelled) for (const b of labelled) {
  const sql = await one(`SELECT public.math_labels_agree(public.math_label($1), public.math_label($2)) g`, [a, b]);
  const js = labelsAgree(labelOf(a), labelOf(b));
  if (sql !== js) disagree.push(`${a} vs ${b}: sql=${sql} js=${js}`);
}
ck(`and agree on all ${labelled.length ** 2} pairings`, disagree.length === 0, disagree.slice(0, 5).join('; '));

disagree = [];
for (const s of labelled) {
  const n = await one(`SELECT public.normalize_math($1) n`, [s]);
  if (n !== '1' && !/^(12|0|6|3)$/.test(n)) disagree.push(`${s} -> ${n}`);
}
ck('everything read as a label is also stripped before the value is compared',
  disagree.length === 0, disagree.join('; '));

console.log('\n=== end to end: saved, scored, stored ===');
const PAPER = '22222222-2222-2222-2222-222222222222';
await x(`INSERT INTO public.assessments (id,kind,title,target_section,instructor_id,is_open,
    duration_minutes,allow_retakes,show_answers)
  VALUES ('${PAPER}','exam','MATH 117 RETAKE','MATH 117','${INS}',true,60,false,false);`);
await q(`INSERT INTO public.questions (exam_id,assessment_id,question_number,question_text,
    question_type,choices,marks,work_given,work_variable,work_rubric)
  VALUES ($1,$1,1,'Find the second derivative.','worked_solution','[]'::jsonb,3,'f(x)=x^4-2x^3+x','x',$2::jsonb),
         ($1,$1,2,'Evaluate the limit.','worked_solution','[]'::jsonb,2,'\\lim_{x\\to3}(x+3)','x',$3::jsonb)`,
  [PAPER,
   JSON.stringify({ steps: [{ latex: "f''(x)=12x^2-12x", marks: 3 }], accept: [] }),
   JSON.stringify({ steps: [{ latex: '6', marks: 2 }], accept: [] })]);
const ids = await q(`SELECT id, question_number n FROM public.questions WHERE exam_id=$1 ORDER BY question_number`, [PAPER]);
const qid = n => ids.find(r => r.n === n).id;
await q(`SELECT public.submit_assessment($1,$2,'{}'::jsonb,60,0,'[]'::jsonb)`, [STU, PAPER]);
const save = async work => asAnon(`SELECT public.save_worked_answers($1,$2,$3,$4::jsonb) AS r`,
  [STU, PAPER, TOK, JSON.stringify(work)]);
{
  const r = await save({ [qid(1)]: { lines: ['f(x)=12x^2-12x'] }, [qid(2)]: { lines: ['6'] } });
  ck('f(x) = … on the real scorer: 2 of 5, only the limit', r.ok && Number(r.rows[0].r.work_marks) === 2,
    JSON.stringify(r.ok ? r.rows[0].r : r.message));
  const row = (await q(`SELECT answers_json FROM public.results WHERE student_id=$1 AND exam_id=$2`, [STU, PAPER]))[0];
  const item = row.answers_json[qid(1)];
  ck('the item is stored wrong, with the reason why',
    item.correct === false && Number(item.marks) === 0 && /wrong label: f\(x\)/.test(item.reason),
    JSON.stringify(item));
}
{
  const r = await save({ [qid(1)]: { lines: ['f^{\\prime\\prime}(x)=12x^2-12x'] }, [qid(2)]: { lines: ['6'] } });
  ck("f''(x) = … as the editor writes it: 5 of 5", r.ok && Number(r.rows[0].r.work_marks) === 5,
    JSON.stringify(r.ok ? r.rows[0].r : r.message));
}

console.log('\n=== accepted_answers() puts the model answer first ===');
ck('so the label a reason quotes is the one the instructor wrote',
  JSON.stringify(await one(`SELECT public.accepted_answers($1::jsonb) a`,
    [JSON.stringify({ steps: [{ latex: "y'''=180x^2" }], accept: ['180x^2', 'a', "y'''=180x^2"] })]))
  === JSON.stringify(["y'''=180x^2", '180x^2', 'a']));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
