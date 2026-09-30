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

/**
 * Superscripts and subscripts KaTeX refuses to parse. The keyboard lets a
 * student stack a second superscript straight onto the first — seen on MATH
 * 117 RETAKE as \left(x\right)^2^{} — and KaTeX calls that a "Double
 * superscript" and prints the whole answer as red source. An EMPTY script is
 * dropped, since it draws as nothing; a second non-empty one is hung off an
 * empty group, x^2{}^3, which draws what was typed instead of an error.
 */
function stackedScripts(s) {
  s = s.replace(/(?<!\\)[\^_]\s*\{\s*\}/g, '');
  let out = '';
  let seen = { '^': false, _: false };
  const frames = [];        // one per open brace: { seen, isArg }
  let argNext = false;      // the next token is a script's argument
  // A token that is a script's argument keeps the base; any other is a new base.
  const endToken = () => {
    if (argNext) argNext = false;
    else seen = { '^': false, _: false };
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      const cmd = /^\\(?:[a-zA-Z]+|.)/.exec(s.slice(i))[0];
      out += cmd;
      i += cmd.length - 1;
      endToken();
    } else if (c === '^' || c === '_') {
      if (seen[c]) { out += '{}'; seen = { '^': false, _: false }; }
      seen[c] = true;
      out += c;
      argNext = true;
    } else if (c === '{') {
      frames.push({ seen, isArg: argNext });
      argNext = false;
      seen = { '^': false, _: false };
      out += c;
    } else if (c === '}') {
      out += c;
      const f = frames.pop();
      if (f?.isArg) seen = f.seen;
      else seen = { '^': false, _: false };
    } else if (/\s/.test(c)) {
      out += c;
    } else {
      out += c;
      endToken();
    }
  }
  return out;
}

export function displayLatex(latex) {
  let s = placeholders(String(latex ?? ''));
  for (const [re, to] of COMMANDS) s = s.replace(re, to);
  return stackedScripts(s);
}
