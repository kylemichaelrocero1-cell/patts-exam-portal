// Renders lesson markdown through the REAL pipeline (same plugins and schema
// the app uses) and asserts both that good content survives and that hostile
// content does not. Node-only: no browser, no DOM.
//
//   npm run test:lessons

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import {
  lessonSchema, prepareLessonMarkdown, normalizeMarkdown,
  embedYoutube, lessonVisibleTo,
} from '../lessonMarkdown.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`); }
};

// Exercises the identical plugin chain used by LessonContent.jsx
const components = {
  a: (props) => createElement('a', { ...props, target: '_blank', rel: 'noopener noreferrer' }),
  div: ({ node, ...props }) => {
    const id = node?.properties?.dataYoutube;
    if (!id) return createElement('div', props);
    return createElement('div', { className: 'lesson-embed' },
      createElement('iframe', {
        src: `https://www.youtube.com/embed/${id}`,
        title: 'Lesson video', allowFullScreen: true, loading: 'lazy',
      }));
  },
};
const render = (md) => renderToStaticMarkup(
  createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [rehypeRaw, [rehypeSanitize, lessonSchema], rehypeKatex],
    components,
  }, prepareLessonMarkdown(md))
);

console.log('\n=== RENDERING ===');
check('headings render', render('# Title').includes('<h1>Title</h1>'));
check('bold/italic render', /<strong>bold<\/strong>/.test(render('**bold**')));
check('lists render', render('- a\n- b').includes('<li>a</li>'));
check('code blocks render', render('```\nx=1\n```').includes('<code>'));
check('GFM tables render',
  /<table>[\s\S]*<th>A<\/th>[\s\S]*<td>1<\/td>/.test(render('| A |\n|---|\n| 1 |')));
check('links render and open safely',
  /<a href="https:\/\/x.com"/.test(render('[x](https://x.com)')));

console.log('\n=== MATH (KaTeX) ===');
const math = render('$E = mc^2$');
check('inline math becomes KaTeX markup', math.includes('katex'), math.slice(0, 120));
check('block math renders', render('$$\\frac{a}{b}$$').includes('katex'));

console.log('\n=== YOUTUBE ===');
const yt = render('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
check('watch URL becomes an embed iframe',
  yt.includes('youtube.com/embed/dQw4w9WgXcQ'), yt.slice(0, 160));
check('youtu.be short URL works',
  render('https://youtu.be/dQw4w9WgXcQ').includes('embed/dQw4w9WgXcQ'));
check('a YouTube link inside a sentence is NOT embedded',
  !render('see https://youtu.be/dQw4w9WgXcQ ok').includes('<iframe'));

console.log('\n=== SANITIZATION (hostile input) ===');
const xss = [
  ['<script> tag',            '<script>alert(1)</script>',                    /<script/i],
  ['inline onerror handler',  '<img src=x onerror="alert(1)">',               /onerror/i],
  ['javascript: link',        '[click](javascript:alert(1))',                 /javascript:/i],
  ['iframe to attacker host', '<iframe src="https://evil.com/x"></iframe>',   /evil\.com/i],
  ['authored youtube-looking iframe', '<iframe src="https://www.youtube.com/embed/x"></iframe>', /<iframe/i],
  ['onclick on a div',        '<div onclick="alert(1)">x</div>',              /onclick/i],
  ['data: URI image',         '<img src="data:text/html,<script>alert(1)</script>">', /data:text\/html/i],
];
for (const [name, input, forbidden] of xss) {
  const out = render(input);
  check(`blocked: ${name}`, !forbidden.test(out), `got: ${out.slice(0, 100)}`);
}
// the iframe allowlist must still permit YouTube specifically
check('YouTube iframe still allowed after sanitising',
  render('https://youtu.be/dQw4w9WgXcQ').includes('<iframe'));

console.log('\n=== HELPERS ===');
check('normalizeMarkdown repairs split link',
  normalizeMarkdown('[a]\n(https://x.com)') === '[a](https://x.com)');
check('embedYoutube leaves plain text alone',
  embedYoutube('hello') === 'hello');
check('empty input is safe', prepareLessonMarkdown(undefined) === '');

console.log('\n=== VISIBILITY ===');
const L = (p) => ({ is_published: true, target_section: '', ...p });
check('unpublished lesson hidden',
  lessonVisibleTo(L({ is_published: false, target_section: 'AENG 426' }), 'AENG 426') === false);
check('matching section visible',
  lessonVisibleTo(L({ target_section: 'AENG 426' }), '1, AENG 426') === true);
check('non-matching section hidden',
  lessonVisibleTo(L({ target_section: 'AENG 426' }), 'AENG 223L') === false);
check('untargeted lesson visible to all',
  lessonVisibleTo(L({ target_section: '' }), 'AENG 223L') === true);
check('substring section does NOT match (223L vs 223L-3)',
  lessonVisibleTo(L({ target_section: 'AENG 223L-3' }), 'AENG 223L') === false);
check('multi-section lesson matches any',
  lessonVisibleTo(L({ target_section: 'AENG 426, AENG 223L' }), 'AENG 223L') === true);
check('null student section hidden from targeted lesson',
  lessonVisibleTo(L({ target_section: 'AENG 426' }), null) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
