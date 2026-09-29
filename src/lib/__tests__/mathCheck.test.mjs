// A worked solution is marked on meaning, not on typing. These pin the two
// things that has to get right: a step that follows is accepted however it is
// written, and a step that does not follow is caught on proof rather than on
// a simplifier's shrug.
//
//   npm run test:math
//
// The awkward cases are the point. sqrt(x^2) vs x must come apart (it only
// does if the sample points go negative); x^2-1 over x-1 must still match
// x+1 despite the hole; and x^2=4 must NOT licence x=2, because that step
// quietly drops a root.

import { ComputeEngine } from '@cortex-js/compute-engine';
import {
  useEngine, parseLine, equivalent, latexEquivalent, freeVars,
  sameEquation, constantRatio, differentiate, checkStep, checkWork,
  complexity, isFinalForm, sameSubject, indefiniteIntegrand,
} from '../mathCheck.js';
import {
  markWork, markAnswer, milestonesOf, totalMarks, isWorkedSolution, linesOf, hasWork,
  acceptedFormVerdict, sameValueAs,
} from '../workedSolution.js';

useEngine(new ComputeEngine());

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const E = s => parseLine(s).rhs;

console.log('=== reading a line ===');
check('an equation splits into two sides', parseLine('y=5x').isEquation);
check('a bare expression does not', !parseLine('5x').isEquation);
check('a blank line is empty, not invalid', parseLine('   ').empty);
check('unreadable maths is rejected', !parseLine('\\frac{1}{').valid);
check('a stray operator is rejected', !parseLine('x +').valid);
check('free variables ignore constants',
  eq(freeVars(E('e^{x}+\\pi y')), ['x', 'y']), JSON.stringify(freeVars(E('e^{x}+\\pi y'))));

console.log('\n=== the same thing, typed differently ===');
check('5(1)x^{1-1} is 5', equivalent(E('5(1)x^{1-1}'), E('5')) === 'equal');
check('x^{-1} is 1/x', equivalent(E('x^{-1}'), E('\\frac{1}{x}')) === 'equal');
check('(x+1)^2 expands', equivalent(E('(x+1)^2'), E('x^2+2x+1')) === 'equal');
check('the Pythagorean identity holds',
  equivalent(E('\\sin^2 x+\\cos^2 x'), E('1')) === 'equal');
check('e^{ln x} is x, though simplify cannot say so',
  equivalent(E('e^{\\ln x}'), E('x')) === 'equal');
check('a removable hole does not break a match',
  equivalent(E('\\frac{x^2-1}{x-1}'), E('x+1')) === 'equal');

console.log('\n=== and things that only look the same ===');
check('5x is not 5x+1', equivalent(E('5x'), E('5x+1')) === 'different');
check('sqrt(x^2) is NOT x — the negative sample points catch it',
  equivalent(E('\\sqrt{x^2}'), E('x')) === 'different');
check('sqrt(x^2) IS |x|', equivalent(E('\\sqrt{x^2}'), E('|x|')) === 'equal');
check('x+y is not 2x — the variables are sampled apart',
  equivalent(E('x+y'), E('2x')) === 'different');

console.log('\n=== rearranging an equation ===');
check('2x=6 gives x=3', sameEquation(parseLine('2x=6'), parseLine('x=3')));
check('2x+4=10 gives 2x=6', sameEquation(parseLine('2x+4=10'), parseLine('2x=6')));
check('x+y=5 gives y=5-x', sameEquation(parseLine('x+y=5'), parseLine('y=5-x')));
check('2x=6 does not give x=4', !sameEquation(parseLine('2x=6'), parseLine('x=4')));
check('x^2=4 does not licence x=2 — that drops a root',
  !sameEquation(parseLine('x^2=4'), parseLine('x=2')));
check('the ratio of 2x-6 to x-3 is 2',
  Math.abs(constantRatio(E('2x-6'), E('x-3')) - 2) < 1e-6);

console.log('\n=== differentiating ===');
check('d/dx of 5x is 5', equivalent(differentiate(E('5x'), 'x'), E('5')) === 'equal');
check('d/dx of 3x^2+2x is 6x+2',
  equivalent(differentiate(E('3x^2+2x'), 'x'), E('6x+2')) === 'equal');

console.log('\n=== one step following another ===');
const step = (a, b) => checkStep(a, b, { variable: 'x' });
check("y=5x then y'=5(1)x^{1-1} is the power rule",
  step('y=5x', "y'=5(1)x^{1-1}").status === 'ok'
  && step('y=5x', "y'=5(1)x^{1-1}").rule === 'differentiate',
  JSON.stringify(step('y=5x', "y'=5(1)x^{1-1}")));
check("y'=5(1)x^{1-1} then y'=5 is a simplification",
  step("y'=5(1)x^{1-1}", "y'=5").status === 'ok'
  && step("y'=5(1)x^{1-1}", "y'=5").rule === 'simplify');
check('dy/dx works as well as the prime',
  step('y=5x', '\\frac{dy}{dx}=5').status === 'ok',
  JSON.stringify(step('y=5x', '\\frac{dy}{dx}=5')));
check("a wrong derivative is caught", step('y=5x', "y'=5x").status === 'broken');
check("a wrong simplification is caught", step("y'=10", "y'=5").status === 'broken');
check('the first line is judged only on being readable',
  step(null, 'y=5x').status === 'ok' && step(null, 'y=5x').rule === 'first');
check('an unreadable line is invalid, not broken',
  step('y=5x', '\\frac{1}{').status === 'invalid');
check('a valid rearrangement between lines is allowed',
  step('2x+4=10', 'x=3').status === 'ok');

console.log('\n=== integrating, and the constant that takes care of itself ===');
check('an indefinite integral yields its integrand',
  equivalent(indefiniteIntegrand(E('\\int 2x\\,dx')), E('2x')) === 'equal');
check('a DEFINITE integral is a number, not a claim about a function',
  indefiniteIntegrand(E('\\int_0^1 x^2\\,dx')) === null);
check('a plain expression is not an integral', indefiniteIntegrand(E('2x')) === null);
check('int 2x dx then x^2 + C follows',
  step('y=\\int 2x\\,dx', 'y=x^2+C').status === 'ok'
  && step('y=\\int 2x\\,dx', 'y=x^2+C').rule === 'integrate',
  JSON.stringify(step('y=\\int 2x\\,dx', 'y=x^2+C')));
check('the constant of integration is optional — it differentiates away either way',
  step('y=\\int 2x\\,dx', 'y=x^2').status === 'ok');
check('and it may be called anything',
  step('y=\\int 2x\\,dx', 'y=x^2+K').status === 'ok',
  JSON.stringify(step('y=\\int 2x\\,dx', 'y=x^2+K')));
check('a wrong antiderivative is caught',
  step('y=\\int 2x\\,dx', 'y=2x^2+C').status === 'broken',
  JSON.stringify(step('y=\\int 2x\\,dx', 'y=2x^2+C')));
check('sin integrates to -cos, not cos',
  step('y=\\int \\sin(x)\\,dx', 'y=-\\cos(x)+C').status === 'ok'
  && step('y=\\int \\sin(x)\\,dx', 'y=\\cos(x)+C').status === 'broken');
check('it works without an equals sign too',
  step('\\int 2x\\,dx', 'x^2+C').status === 'ok',
  JSON.stringify(step('\\int 2x\\,dx', 'x^2+C')));

console.log('\n=== a whole stack of working ===');
const good = checkWork(['y=5x', "y'=5(1)x^{1-1}", "y'=5"], { variable: 'x' });
check('every line of a sound solution is ok', good.every(s => s.status === 'ok'),
  JSON.stringify(good.map(s => s.status)));
const bad = checkWork(['y=5x', "y'=5(1)x^{1-1}", "y'=10"], { variable: 'x' });
check('the line that goes wrong is the one flagged',
  eq(bad.map(s => s.status), ['ok', 'ok', 'broken']), JSON.stringify(bad.map(s => s.status)));
check('blank lines in the middle are dropped, not failed',
  checkWork(['y=5x', '  ', "y'=5"], { variable: 'x' }).length === 2);

console.log('\n=== marks ===');
const rubric = {
  variable: 'x',
  marks: 3,
  steps: [
    { latex: "y'=5(1)x^{1-1}", marks: 1, label: 'Power rule applied' },
    { latex: "y'=5", marks: 2, label: 'Final answer' },
  ],
};
check('the total is the instructor\'s number', totalMarks(rubric) === 3);
check('milestones drop blank or unmarked rows',
  milestonesOf({ steps: [{ latex: '', marks: 1 }, { latex: 'x', marks: null }, { latex: 'y', marks: 1 }] }).length === 1);

const full = markWork(['y=5x', "y'=5(1)x^{1-1}", "y'=5"], rubric);
check('a complete, sound solution takes all 3 marks', full.marks === 3, JSON.stringify(full));

const shortRoute = markWork(['y=5x', "y'=5"], rubric);
check('a correct shorter route still takes all 3 — milestones are a route, not the only one',
  shortRoute.marks === 3, JSON.stringify(shortRoute));

const stopped = markWork(['y=5x', "y'=5(1)x^{1-1}"], rubric);
check('working that stops after the power rule takes 1 of 3',
  stopped.marks === 1, JSON.stringify(stopped));

const wrong = markWork(['y=5x', "y'=5x"], rubric);
check('a solution that goes wrong is penalised, not merely unrewarded',
  wrong.marks === 0, JSON.stringify(wrong));

const blank = markWork([], rubric);
check('nothing written scores nothing', blank.marks === 0 && blank.blank);

check('a mark never exceeds the total and never goes below zero',
  markWork(['y=5x', "y'=5"], { ...rubric, marks: 2 }).marks === 2
  && markWork(['y=5x', "y'=99", "y'=98"], rubric).marks === 0);

check('the mark always carries a reason',
  [full, stopped, wrong, blank].every(r => typeof r.reason === 'string' && r.reason.length > 0));

check('equivalent typing earns the milestone',
  markWork(['y=5x', '\\frac{dy}{dx}=5\\cdot 1\\cdot x^{0}'], rubric).marks >= 1,
  JSON.stringify(markWork(['y=5x', '\\frac{dy}{dx}=5\\cdot 1\\cdot x^{0}'], rubric)));

console.log('\n=== answer only, all or nothing ===');
{
  const r = { variable: 'x', marks: 2, steps: [{ latex: "y'=5", marks: 2, label: 'Final answer' }] };
  check('the right answer takes every mark', markAnswer(["y'=5"], r).marks === 2);
  check('a wrong answer takes none — there is no partial credit here',
    markAnswer(["y'=5x"], r).marks === 0);
  check('nothing written takes none, and says so',
    markAnswer([], r).marks === 0 && markAnswer([], r).blank);
  // Changed 2026-09-27 (sql/032): the key has a label, so the label is part
  // of the answer. A bare 5 has not said what 5 is.
  check('a bare 5 is refused — the key is labelled, so the answer must be too',
    markAnswer(['5'], r).marks === 0 && markAnswer(['5'], r).labelWrong === true
    && /no label/.test(markAnswer(['5'], r).reason),
    JSON.stringify(markAnswer(['5'], r)));
  check('and it is NOT docked for failing to follow from the problem, which is what markWork would do',
    markAnswer(["y'=5"], r).marks === 2 && markWork(['y=5x', '5'], r).marks < 2,
    `markAnswer=${markAnswer(["y'=5"], r).marks} markWork=${markWork(['y=5x', '5'], r).marks}`);
  check('an unsimplified but equal answer is refused, and flagged as a near miss',
    markAnswer(["y'=5(1)x^{1-1}"], r).marks === 0
    && markAnswer(["y'=5(1)x^{1-1}"], r).nearMiss === true,
    JSON.stringify(markAnswer(["y'=5(1)x^{1-1}"], r)));
  check('the reason distinguishes a near miss from a plain wrong answer',
    /not simplified|form asked/i.test(markAnswer(["y'=5(1)x^{1-1}"], r).reason)
    && /not the right answer/i.test(markAnswer(["y'=99"], r).reason));
}
{
  // MATH 117 Q27. f(x) = 12x^2 - 12x was marked right: the value matches and
  // the label, which is what "second derivative" is testing, was stripped.
  const q27 = { variable: 'x', marks: 3, steps: [{ latex: "f''(x)=12x^2-12x", marks: 3 }] };
  const m = a => markAnswer([a], q27);
  check('f(x) = … is wrong for a second derivative', m('f(x)=12x^2-12x').marks === 0,
    JSON.stringify(m('f(x)=12x^2-12x')));
  check("f'(x) = … is wrong too — isFinalForm alone took it", m("f^{\\prime}(x)=12x^2-12x").marks === 0);
  check("f''(x) = …, as the editor writes it, is right", m("f^{\\prime\\prime}(x)=12x^2-12x").marks === 3);
  check("y'' and d²y/dx² stand in for f''(x)",
    m("y^{\\prime\\prime}=12x^2-12x").marks === 3 && m('\\frac{d^2y}{dx^2}=12x^2-12x').marks === 3);
  check("g''(x), f''(t) and F''(x) are wrong",
    m("g''(x)=12x^2-12x").marks === 0 && m("f''(t)=12x^2-12x").marks === 0 && m("F''(x)=12x^2-12x").marks === 0);
  check('the reason names both labels',
    /wrong label: f\(x\) where the question asks for f''\(x\)/.test(m('f(x)=12x^2-12x').reason),
    m('f(x)=12x^2-12x').reason);
  check('a wrong VALUE is reported as a wrong value, whatever its label',
    m("f(x)=12x^2").reason === 'Not the right answer.');
  const lim = { variable: 'x', marks: 2, steps: [{ latex: '6', marks: 2 }] };
  check('a key with no label judges none: 6 and L = 6 are both right',
    markAnswer(['6'], lim).marks === 2 && markAnswer(['L=6'], lim).marks === 2);
}
{
  // MATH 117 Q23, d/dx(y^3). The engine cannot see that y' is dy/dx, so the
  // accept list is the only thing that says 3y^2y' is right — and the
  // dashboard's marker used to ignore it, re-marking wrong what the database
  // had marked right.
  const q23 = { variable: 'x', marks: 2,
    steps: [{ latex: '3y^2\\frac{dy}{dx}', marks: 2 }], accept: ['3y^2dy/(dx)', "3y^2y'"] };
  const m = a => markAnswer([a], q23);
  check("an accepted answer is right: 3y^2y', and as the editor writes it",
    m("3y^2y'").marks === 2 && m('3y^{2}y^{\\prime}').marks === 2,
    JSON.stringify(m('3y^{2}y^{\\prime}')));
  check('the key itself is still right', m('3y^2\\frac{dy}{dx}').marks === 2);
  check("but not y'' or a missing y'",
    m("3y^2y''").marks === 0 && m('3y^2').marks === 0 && m("2y^2y'").marks === 0);
  // Since dy/dx and y' became unknowns of their own (derivAsUnknown), the
  // engine sees this without the list; the database still needs the entry.
  check("the dashboard now sees y' as dy/dx on its own",
    markAnswer(["3y^2y'"], { ...q23, accept: [] }).marks === 2);
  check('and still not 2y^2 dy/dx, which the engine used to call equal',
    markAnswer(['2y^2\\frac{dy}{dx}'], q23).marks === 0 && markAnswer(['2y^2y^{\\prime}'], q23).marks === 0);
  check('nor d/dx(3y^2), an unworked derivative that came out "equal" as 0 = 0',
    markAnswer(['\\frac{d}{dx}\\left(3y^2\\right)'], q23).marks === 0);
}
{
  // "Write the expression for f'(x) … Do not simplify": the value of the
  // limit is not what was asked, however many students write it.
  const q3 = { variable: 'x', marks: 4, steps: [{ latex: "f'(x)=\\lim_{h\\to 0}\\frac{(x+h)^3-x^3}{h}", marks: 4 }],
    accept: ['\\lim_{h\\to 0}\\frac{(x+h)^3-(x)^3}{h}'] };
  check("a key that is a written-out limit does not take its value: f'(x) = 3x^2 is wrong",
    markAnswer(['f^{\\prime}\\left(x\\right)=3x^2'], q3, { given: 'f(x)=x^3' }).marks === 0);
  check('the limit written out, as the editor writes it, is right',
    markAnswer(['f^{\\prime}\\left(x\\right)=\\lim_{h\\to0}\\frac{\\left(x+h\\right)^3-x^3}{h}'], q3, { given: 'f(x)=x^3' }).marks === 4);
  const lim = { variable: 'x', marks: 2, steps: [{ latex: '10', marks: 2 }] };
  check('copying a limit question back is not its answer',
    markAnswer(['\\lim_{x\\to 5}\\frac{x^2-25}{x-5}'], lim, { given: '\\lim_{x\\to 5}\\frac{x^2-25}{x-5}' }).marks === 0);
  // The dashboard marked k^{(4)}(s) = 0 wrong once it had read the problem
  // k(s) = …; the database had it right.
  const q4 = { variable: 's', marks: 2, steps: [{ latex: '0', marks: 2 }] };
  check('k^{(4)}(s) = 0 is right, with the problem read first',
    markAnswer(['k^{\\left(4\\right)}\\left(s\\right)=0'], q4, { given: 'k(s)=s^3+4s^2-1', variable: 's' }).marks === 2);
  check("but k^4(s) = 0 is not — without brackets it is a power",
    markAnswer(['k^4\\left(s\\right)=0'], q4, { given: 'k(s)=s^3+4s^2-1', variable: 's' }).marks === 0);
}
{
  // The question editor's warning on an accepted form. It flagged Q23's
  // 3y^2dy/(dx) as NOT matching 3y^2 dy/dx — an invitation to delete a
  // right answer — because the engine read dy/(dx) as d*y/(d*x).
  const v = acceptedFormVerdict;
  check('3y^2dy/(dx) is not called different from 3y^2 dy/dx',
    v('3y^2dy/(dx)', '3y^2\\frac{dy}{dx}') !== 'different', v('3y^2dy/(dx)', '3y^2\\frac{dy}{dx}'));
  check("nor is 3y^2y'", v("3y^2y'", '3y^2\\frac{dy}{dx}') !== 'different');
  check('but 2y^2dy/(dx) is not called EQUAL either — the engine cannot tell',
    v('2y^2dy/(dx)', '3y^2\\frac{dy}{dx}') !== 'equal', v('2y^2dy/(dx)', '3y^2\\frac{dy}{dx}'));
  check('a Leibniz label is judged as a label: dy/dx = -x/y is equal',
    v('dy/dx=-x/y', '\\frac{dy}{dx}=-\\frac{x}{y}') === 'equal', v('dy/dx=-x/y', '\\frac{dy}{dx}=-\\frac{x}{y}'));
  check('and a wrong value after it is still different',
    v('dy/dx=x/y', '\\frac{dy}{dx}=-\\frac{x}{y}') === 'different');
  check("a wrong label is different: f(x)= where f''(x)= is the answer",
    v('f(x)=12x^2-12x', "f''(x)=12x^2-12x") === 'different');
  check('real algebra is still checked: x^{-1} and 1/x',
    v('x^{-1}', '\\frac{1}{x}') === 'equal' && v("y'=x^{-1}", "y'=\\frac{1}{x}") === 'equal'
    && v('x^{-2}', '\\frac{1}{x}') === 'different');
  check('and a minus on the numerator is the same answer',
    v('\\frac{-6}{(2u+1)^4}', '-\\frac{6}{(2u+1)^4}') === 'equal');
}
{
  // sameValueAs: the instructor's rule — any form of the right value, with
  // no demand that it be simplified.
  check('the product rule applied and left unsimplified is the same value',
    sameValueAs('s^{\\prime}\\left(t\\right)=\\left(t+2\\right)^{\\frac12}+\\frac12t\\left(t+2\\right)^{-\\frac12}',
      "s'(t)=\\frac{3t+4}{2\\sqrt{t+2}}"));
  check('a negative exponent for a fraction',
    sameValueAs('g^{\\prime}\\left(x\\right)=x\\left(x^2+4\\right)^{-\\frac12}', "g'(x)=\\frac{x}{\\sqrt{x^2+4}}"));
  check('dy/dx written first', sameValueAs('\\frac{dy}{dx}4y^3', '4y^3\\frac{dy}{dx}'));
  check('but not k^4(s) = 0 — a power, not a label', !sameValueAs('k^4\\left(s\\right)=0', '0'));
  check('nor 3y^3 dy/dx', !sameValueAs('3y^3\\frac{dy}{dx}', '4y^3\\frac{dy}{dx}'));
  check('nor an unworked d/dx', !sameValueAs('\\frac{d}{dx}\\left(4y^3\\right)', '4y^3\\frac{dy}{dx}'));
  check("nor 3x^2 for a key that is a written-out limit",
    !sameValueAs('f^{\\prime}\\left(x\\right)=3x^2', "f'(x)=\\lim_{h\\to 0}\\frac{(x+h)^3-x^3}{h}"));
  check('nor a wrong sign', !sameValueAs('q^{\\prime}\\left(w\\right)=\\frac{w^2-4}{\\left(w^2+4\\right)^2}',
    "q'(w)=\\frac{4-w^2}{(w^2+4)^2}"));
}
{
  const solve = { variable: 'x', marks: 3, steps: [{ latex: 'x=3', marks: 3, label: 'Final answer' }] };
  check('solving: x=3 is the answer', markAnswer(['x=3'], solve).marks === 3);
  check('solving: 2x=6 is NOT, however equivalent',
    markAnswer(['2x=6'], solve).marks === 0);
}
{
  const integral = { variable: 'x', marks: 3, steps: [{ latex: 'y=x^2+C', marks: 3 }] };
  const gi = { given: 'y=\\int 2x\\,dx' };
  check('an integral takes any constant', markAnswer(['y=x^2+K'], integral, gi).marks === 3,
    JSON.stringify(markAnswer(['y=x^2+K'], integral, gi)));
  check('and none at all', markAnswer(['y=x^2'], integral, gi).marks === 3);
  check('and the key\'s own C', markAnswer(['y=x^2+C'], integral, gi).marks === 3);
  check('but not a wrong antiderivative', markAnswer(['y=2x^2+C'], integral, gi).marks === 0);
  check('and copying the question back is not an answer',
    markAnswer(['y=\\int 2x\\,dx'], integral, gi).marks === 0,
    JSON.stringify(markAnswer(['y=\\int 2x\\,dx'], integral, gi)));
}
{
  // dy/dx = f and y = int f dx are the SAME exercise to a student, and were
  // not the same to the marker: only the integral form differentiated the
  // answer back, so a differential equation answered with a different
  // constant letter scored zero while the identical integral scored full.
  const de = { variable: 'x', marks: 3, steps: [{ latex: 'y=x^2+C', marks: 3 }] };
  const gd = { given: '\\frac{dy}{dx}=2x' };
  check('a differential equation takes the key\'s own constant',
    markAnswer(['y=x^2+C'], de, gd).marks === 3);
  check('and another letter for it, exactly as the integral form does',
    markAnswer(['y=x^2+K'], de, gd).marks === 3,
    JSON.stringify(markAnswer(['y=x^2+K'], de, gd)));
  check('and none at all', markAnswer(['y=x^2'], de, gd).marks === 3);
  check('a wrong antiderivative is still refused',
    markAnswer(['y=2x^2+C'], de, gd).marks === 0);
  check('copying the equation back is not an answer',
    markAnswer(['\\frac{dy}{dx}=2x'], de, gd).marks === 0,
    JSON.stringify(markAnswer(['\\frac{dy}{dx}=2x'], de, gd)));
  check('nor is failing to integrate at all',
    markAnswer(['y=2x'], de, gd).marks === 0);
  check('the two shapes agree, which is the whole point',
    markAnswer(['y=x^2+K'], de, gd).marks
      === markAnswer(['y=x^2+K'], de, { given: 'y=\\int 2x\\,dx' }).marks);
}
check('a plain question still marks on the key, not by differentiating',
  markAnswer(["y'=2x"], { marks: 1, steps: [{ latex: "y'=2x", marks: 1 }] },
             { given: 'y=x^2' }).marks === 1);

check('an item with no key cannot be marked, and says so rather than scoring 0 silently',
  /no answer key/i.test(markAnswer(['x'], { marks: 2, steps: [] }).reason));

console.log('\n=== a finished answer, not merely an equal one ===');
check('5 is simpler than 5(1)x^{1-1}', complexity(E('5')) < complexity(E('5(1)x^{1-1}')));
check("y'=5 is a finished answer", isFinalForm("y'=5", "y'=5"));
check("y'=5(1)x^{1-1} is equal to the answer but is not the answer written out",
  latexEquivalent("y'=5(1)x^{1-1}", "y'=5") === 'equal'
  && !isFinalForm("y'=5(1)x^{1-1}", "y'=5"));
check('a little slack: 2.5 passes where the key says 5/2',
  isFinalForm('x=2.5', 'x=\\frac{5}{2}'));
check('2x=6 is a valid STEP towards x=3',
  step('2x+4=10', '2x=6').status === 'ok');
check('but it is NOT the answer — solving for x has to say what x is',
  !isFinalForm('2x=6', 'x=3'),
  'isFinalForm(2x=6, x=3) must be false');
check('though the two are still equivalent equations, which is why this needed a rule',
  latexEquivalent('2x=6', 'x=3') === 'equal');
check('x=3 is the answer', isFinalForm('x=3', 'x=3'));
check('a bare 5 counts as the answer where the key says y\'=5 — only the label is missing',
  isFinalForm('5', "y'=5"));
check('canonicalisation folds x^1 away, so 3(2)x^{2-1} IS 6x by the time it parses',
  complexity(E('3(2)x^{2-1}')) === complexity(E('6x')),
  `${complexity(E('3(2)x^{2-1}'))} vs ${complexity(E('6x'))}`);
check('but x^0 survives, so 5(1)x^{1-1} stays distinguishable from 5',
  complexity(E('5(1)x^{1-1}')) > complexity(E('5')));
check('Leibniz and Lagrange name the same subject',
  sameSubject(parseLine("y'=5").lhs, parseLine('\\frac{dy}{dx}=5').lhs));

console.log('\n=== shapes ===');
check('the worked type is recognised', isWorkedSolution({ question_type: 'worked_solution' })
  && !isWorkedSolution({ question_type: 'essay' }) && !isWorkedSolution({}));
check('lines read from either shape',
  eq(linesOf({ lines: ['a', 'b'] }), ['a', 'b']) && eq(linesOf(['a']), ['a']) && eq(linesOf(null), []));
check('empty work is not work', !hasWork({ lines: ['', '  '] }) && hasWork({ lines: ['x'] }));
check('latexEquivalent compares whole equations',
  latexEquivalent("y'=5", "y'=5(1)x^{1-1}") === 'equal'
  && latexEquivalent("y'=5", "y'=6") === 'different');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
