import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import {
  INTERACTIVE_SANDBOX, buildLessonDocument, readLessonMessage,
} from '../lib/lessonMaterial';

// Shows an uploaded interactive page in a frame of its own. Read the rules above
// INTERACTIVE_SANDBOX before changing how the frame is set up.
//
// The file is fetched and handed over as srcdoc rather than linked: storage does
// not serve HTML as a page, and srcdoc keeps it out of any origin that matters.
//
// `url` is the saved file; `file` is one the instructor has chosen but not yet
// uploaded, so a lesson can be tried before it is saved. `scrollPage` lets the
// page bring its own top back into view when the student changes part; off in
// the editor, whose modal scrolls instead of the window.
export default function InteractiveLesson({ url, file, title, scrollPage = false }) {
  const frame = useRef(null);
  const [doc, setDoc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState(640);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let html;
        if (file) {
          html = await file.text();
        } else {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          html = await res.text();
        }
        if (!cancelled) { setDoc(buildLessonDocument(html)); setFailed(false); }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [url, file, attempt]);

  useEffect(() => {
    const onMessage = (e) => {
      // Only this lesson's own frame may steer this lesson's frame.
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const msg = readLessonMessage(e.data);
      if (!msg) return;
      if (msg.type === 'height') setHeight(msg.value);
      else if (scrollPage) {
        const top = frame.current.getBoundingClientRect().top + window.scrollY + msg.value;
        window.scrollTo({ top: Math.max(0, top - 8) });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [scrollPage]);

  if (failed) {
    return (
      <div style={{ padding: '28px 16px', textAlign: 'center' }}>
        <Icon name="alert" size={22} color="var(--warn)" />
        <p style={{ color: 'var(--ink-2)', fontSize: 14, margin: '8px 0 12px' }}>
          Could not load this lesson. Check your connection and try again.
        </p>
        <button className="btn ghost sm" style={{ width: 'auto' }}
          onClick={() => { setFailed(false); setDoc(null); setAttempt(a => a + 1); }}>
          <Icon name="refresh" size={13} /> Try again
        </button>
      </div>
    );
  }

  if (doc === null) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Loading lesson…</div>;
  }

  return (
    <iframe
      ref={frame}
      className="lesson-frame"
      title={title || 'Interactive lesson'}
      sandbox={INTERACTIVE_SANDBOX}
      srcDoc={doc}
      scrolling="no"
      referrerPolicy="no-referrer"
      style={{ height }}
    />
  );
}
