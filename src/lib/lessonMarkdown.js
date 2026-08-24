import { defaultSchema } from 'rehype-sanitize';

// Lesson bodies are markdown written by instructors and rendered for students.
// Instructors are trusted, but "trusted" is not a security model — a compromised
// or careless account must not be able to inject script into every student's
// browser. Everything goes through rehype-sanitize; this schema is the allowlist:
// KaTeX's MathML output, GFM tables, and YouTube iframes. Nothing else.
export const lessonSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    // KaTeX renders to MathML + spans
    'math', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt',
    'mspace', 'mtext', 'semantics', 'annotation',
    // GFM tables
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'details', 'summary',
    // NOTE: 'iframe' is deliberately absent. rehype-raw parses raw HTML out of
    // lesson bodies, so allow-listing iframe here would let an instructor embed
    // any origin they liked. Video embeds instead go through a data-youtube
    // marker (below) which the renderer turns into an iframe from a validated
    // 11-character id — so the iframe is always constructed by us, never authored.
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'style'],
    div: [...(defaultSchema.attributes?.div ?? []), 'dataYoutube'],
    img: [...(defaultSchema.attributes?.img ?? []), 'src', 'alt', 'title'],
  },
  // Block javascript:/data: URLs outright.
  protocols: {
    ...defaultSchema.protocols,
    src: ['http', 'https'],
    href: ['http', 'https', 'mailto'],
  },
};

// Copy-paste out of Word routinely splits "](" across a line break, which
// silently turns a link into literal text. Cheap to repair, confusing to debug.
export function normalizeMarkdown(md) {
  return (md || '').replace(/]\s*\n\s*\(/g, '](');
}

// Turn a bare YouTube link on its own line into an embed. Instructors paste
// watch URLs; nobody types an iframe by hand.
const YT = /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})\S*$/;

export function embedYoutube(md) {
  return (md || '').split('\n').map(line => {
    const m = line.trim().match(YT);
    // Emit a marker, never an iframe. The id is captured by [\w-]{11}, so it
    // cannot carry quotes or break out of the attribute.
    return m ? `<div data-youtube="${m[1]}"></div>` : line;
  }).join('\n');
}

export function prepareLessonMarkdown(md) {
  return embedYoutube(normalizeMarkdown(md));
}

// A student sees a lesson when it is published AND targets one of their
// sections. Sections are a comma-separated list on both sides — compare
// membership, never the whole string (see the Results-filter bug).
export function lessonVisibleTo(lesson, studentSection) {
  if (!lesson?.is_published) return false;
  const target = (lesson.target_section || '').split(',').map(s => s.trim()).filter(Boolean);
  if (target.length === 0) return true; // untargeted lesson = everyone
  const mine = (studentSection || '').split(',').map(s => s.trim()).filter(Boolean);
  return target.some(t => mine.includes(t));
}
