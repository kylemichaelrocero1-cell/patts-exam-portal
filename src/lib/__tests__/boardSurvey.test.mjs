// The board exam survey's questions and answer handling (src/lib/boardSurvey.js).
//   npm run test:board-survey
import {
  STEPS, ITEMS, SUBJECTS, SCALES, TEXT_MAX, SURVEY_ID,
  emptyAnswers, cleanAnswers, isShown, stepAnswered, nameShown,
  tally, scaleAverage, shareOf, answerText, itemById,
} from '../boardSurvey.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const dupes = list => list.filter((v, i) => list.indexOf(v) !== i);

console.log('=== THE QUESTIONS ===');
check('the survey id is one the database accepts', /^[a-z0-9_]{1,40}$/.test(SURVEY_ID));
check('a step about them, one per subject, then mock exams, faculty and a last step',
  STEPS.map(s => s.id).join() === ['you', ...SUBJECTS.map(s => s.key), 'mocks', 'faculty', 'last'].join());
check('every question id is used once', dupes(ITEMS.map(i => i.id)).length === 0, dupes(ITEMS.map(i => i.id)).join());
check('every step id is used once', dupes(STEPS.map(s => s.id)).length === 0);
check('every pick question has at least two options, each id used once',
  ITEMS.filter(i => i.kind !== 'text').every(i => i.options.length >= 2 && !dupes(i.options.map(o => o.id)).length),
  ITEMS.filter(i => i.kind !== 'text' && dupes(i.options.map(o => o.id)).length).map(i => i.id).join());
check('every topic id is unique within its subject', SUBJECTS.every(s => !dupes(s.topics.map(t => t.id)).length));
check('every scale question points at a real four-point scale',
  ITEMS.filter(i => i.scale).every(i => SCALES[i.scale]?.length === 4 && SCALES[i.scale] === i.options));
check('each subject asks what came out and how well PATTS prepared them',
  SUBJECTS.every(s => itemById(`topics_${s.key}`)?.kind === 'many' && itemById(`prep_${s.key}`)?.scale === 'PREP'));
check('the mock exam questions the faculty asked for are there',
  ['mocks_helpful', 'mocks_prepared'].every(id => itemById(id)?.step === 'mocks'));
check('so is what they wish the faculty had done', itemById('wished')?.step === 'faculty' && itemById('faculty_wish')?.kind === 'text');
check('every text box has a placeholder', ITEMS.filter(i => i.kind === 'text').every(i => i.placeholder));
check('a PATTS survey: no AeroHub among what they used to review',
  !JSON.stringify(ITEMS.filter(i => i.options).map(i => i.options)).toLowerCase().includes('aerohub'));
check('the topics recalled after the exam can be ticked',
  ['rate_turn', 'mass_flow', 'axes', 'stability'].every(id => SUBJECTS[1].topics.some(t => t.id === id))
  && ['beams_mixed', 'rope_tension', 'pressure_vessel', 'shaft_key', 'welds', 'friction'].every(id => SUBJECTS[2].topics.some(t => t.id === id))
  && ['fuel_grades', 'prop_rpm'].every(id => SUBJECTS[3].topics.some(t => t.id === id))
  && ['oil_canning', 'flight_levels', 'load_limits'].every(id => SUBJECTS[4].topics.some(t => t.id === id))
  && ['pcar2', 'econ_terms'].every(id => SUBJECTS[5].topics.some(t => t.id === id)));

console.log('\n=== CLEANING ===');
{
  const c = cleanAnswers({
    one: { result: 'passed', ready: 'nonsense', made_up: 'yes', hardest: 'aero' },
    many: { topics_math: ['bearing', 'bearing', 'not_a_topic', 7], wished: 'consult' },
    text: { faculty_wish: `  ${'x'.repeat(TEXT_MAX + 50)}  `, recall_math: '   ', made_up: 'hi' },
    extra: 'dropped',
  });
  check('a known pick is kept', c.one.result === 'passed' && c.one.hardest === 'aero');
  check('an unknown option is dropped', !('ready' in c.one));
  check('an unknown question is dropped', !('made_up' in c.one) && !('made_up' in c.text) && !('extra' in c));
  check('a many keeps known ids once each', JSON.stringify(c.many.topics_math) === '["bearing"]');
  check('a many that is not a list is dropped', !('wished' in c.many));
  check('text is trimmed and capped', c.text.faculty_wish.length === TEXT_MAX);
  check('blank text is dropped', !('recall_math' in c.text));
  check('junk gives empty answers', JSON.stringify(cleanAnswers(null)) === JSON.stringify(emptyAnswers())
    && JSON.stringify(cleanAnswers([1, 2])) === JSON.stringify(emptyAnswers()));
}
{
  const c = cleanAnswers({ one: { mocks_taken: 'none', mocks_helpful: 'very' }, many: { mocks_best: ['math'], mocks_better: ['more'] } });
  check('took no mock exams: how helpful they were is not counted', !('mocks_helpful' in c.one) && !('mocks_best' in c.many));
  check('but what would make them better still is', c.many.mocks_better?.[0] === 'more');
  const t = cleanAnswers({ one: { mocks_taken: 'few', mocks_helpful: 'very' } });
  check('took some: it is', t.one.mocks_helpful === 'very');
  const s = cleanAnswers({ one: { share: 'name' } });
  check('may we share it, with no message: not counted', !('share' in s.one));
  const m = cleanAnswers({ one: { share: 'anon' }, text: { message: 'Pray and solve' } });
  check('with a message: counted', m.one.share === 'anon');
}

console.log('\n=== WHAT SHOWS ===');
{
  const helpful = itemById('mocks_helpful');
  check('mock exam questions show before "how many" is answered', isShown(helpful, emptyAnswers()));
  check('and hide after "None"', !isShown(helpful, { ...emptyAnswers(), one: { mocks_taken: 'none' } }));
  check('a step with nothing answered is unanswered', !stepAnswered(STEPS[0], emptyAnswers()));
  check('one pick answers it', stepAnswered(STEPS[0], { ...emptyAnswers(), one: { take: 'first' } }));
  check('a name shows only on yes', nameShown({ one: { show_name: 'yes' } }) && !nameShown({ one: { show_name: 'no' } })
    && !nameShown({ one: {} }) && !nameShown(null));
}

console.log('\n=== TALLIES ===');
{
  const A = (one = {}, many = {}, text = {}) => ({ one, many, text });
  const list = [
    A({ mocks_helpful: 'very', prep_math: 'well' }, { wished: ['consult', 'reviewers'] }),
    A({ mocks_helpful: 'helpful', prep_math: 'none' }, { wished: ['consult'] }),
    A({ mocks_helpful: 'none' }),
    A({}),
  ];
  const t = tally(itemById('wished'), list);
  check('a many counts each pick, and people who picked', t.answered === 2
    && t.rows.find(r => r.id === 'consult').n === 2 && t.rows.find(r => r.id === 'reviewers').n === 1);
  check('options keep the question’s order, zeros included', t.rows.map(r => r.id).join() === itemById('wished').options.map(o => o.id).join());
  check('a scale averages 1–4 over those who answered', scaleAverage(itemById('mocks_helpful'), list) === (4 + 3 + 1) / 3);
  check('prep: Well and Not at all average 2', scaleAverage(itemById('prep_math'), list) === 2);
  check('no answers, no average', scaleAverage(itemById('prep_aero'), list) === null);
  check('share of helpful or very helpful', shareOf(itemById('mocks_helpful'), list, ['helpful', 'very']) === 67);
  check('no answers, no share', shareOf(itemById('mocks_prepared'), list, ['a_lot']) === null);
  check('answer text for a pick, a many and a text box',
    answerText(itemById('mocks_helpful'), list[0]) === 'Very helpful'
    && answerText(itemById('wished'), list[0]) === 'Consultation hours; Reviewers and formula sheets'
    && answerText(itemById('faculty_wish'), A({}, {}, { faculty_wish: 'More drills' })) === 'More drills'
    && answerText(itemById('wished'), list[3]) === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
