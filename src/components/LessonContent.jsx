import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { lessonSchema, prepareLessonMarkdown } from '../lib/lessonMarkdown';
import 'katex/dist/katex.min.css';

export default function LessonContent({ markdown }) {
  const src = prepareLessonMarkdown(markdown);

  if (!src.trim()) {
    return (
      <p style={{ color: 'var(--ink-4)', fontStyle: 'italic', margin: 0 }}>
        This lesson has no content yet.
      </p>
    );
  }

  return (
    <div className="lesson-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        // ORDER IS LOAD-BEARING. rehypeRaw parses the raw HTML in the source
        // (needed for the YouTube embeds), and rehypeSanitize must run AFTER it
        // so that parsed HTML is filtered against lessonSchema. Swapping these
        // two, or dropping the sanitize step, hands every instructor account a
        // stored-XSS primitive against every student. Covered by
        // src/lib/__tests__/lessonMarkdown.test.mjs.
        rehypePlugins={[rehypeRaw, [rehypeSanitize, lessonSchema], rehypeKatex]}
        components={{
          // Any link out of a lesson opens away from the portal, and noreferrer
          // stops the new tab reaching back through window.opener.
          a: ({ ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          // The only path to an iframe. `data-youtube` survives sanitising, an
          // authored <iframe> does not — so the src here is always built by us
          // from an id the regex already constrained to 11 word characters.
          div: ({ node, ...props }) => {
            const id = node?.properties?.dataYoutube;
            if (!id) return <div {...props} />;
            return (
              <div className="lesson-embed">
                <iframe
                  src={`https://www.youtube.com/embed/${id}`}
                  title="Lesson video"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
            );
          },
          img: ({ alt, ...props }) => <img alt={alt || ''} {...props} loading="lazy" />,
        }}
      >
        {src}
      </ReactMarkdown>
    </div>
  );
}
