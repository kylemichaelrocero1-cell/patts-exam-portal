// LaTeX from the maths keyboard (MathLive), made drawable by KaTeX.
//
// MathLive writes a few commands of its own that KaTeX has never heard of,
// and KaTeX's answer to an unknown command is to print its NAME in red. So a
// student who typed d/dx showed up on the review screens as
// "d / \differentialD x", and an empty box left in an answer as
// "\placeholder". What is stored is untouched; this is only for drawing it.

// MathLive's own commands, as KaTeX can draw them.
const COMMANDS = [
  [/\\differentialD(?![a-zA-Z])/g, '\\mathrm{d}'],
  [/\\capitalDifferentialD(?![a-zA-Z])/g, '\\mathrm{D}'],
  [/\\exponentialE(?![a-zA-Z])/g, '\\mathrm{e}'],
  [/\\imaginaryI(?![a-zA-Z])/g, '\\mathrm{i}'],
  [/\\imaginaryJ(?![a-zA-Z])/g, '\\mathrm{j}'],
  [/\\doubleprime(?![a-zA-Z])/g, '\\prime\\prime'],
  [/\\mleft(?![a-zA-Z])/g, '\\left'],
  [/\\mright(?![a-zA-Z])/g, '\\right'],
];

/**
 * An empty box the student left in the answer is drawn as a box, which is
 * what they saw; a filled one is drawn as what they put in it. MathLive
 * writes it \placeholder{}, \placeholder[id]{value} or bare \placeholder.
 */
function placeholders(s) {
  return s
    .replace(/\\placeholder(?:\[[^\]]*\])?\{([^{}]*)\}/g, (_, v) => (v.trim() ? v : '\\square '))
    .replace(/\\placeholder(?![a-zA-Z])(?:\[[^\]]*\])?/g, '\\square ');
}

export function displayLatex(latex) {
  let s = placeholders(String(latex ?? ''));
  for (const [re, to] of COMMANDS) s = s.replace(re, to);
  return s;
}
