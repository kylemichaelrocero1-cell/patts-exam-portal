import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

// Sections are stored as one comma-separated string. Typing that by hand is how
// "AENG 426" ends up as "AENG426", how a stray comma leaves a blank entry, and
// how a typo silently detaches a student or an exam from everything.
//
// This edits the same string, but through chips: pick from what already exists,
// and only fall back to typing for a genuinely new section.

const split = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);
const join = (arr) => arr.join(', ');

const PANEL_W = 260;

export default function SectionPicker({
  value,                 // the comma-separated string
  onChange,              // (nextString) => void
  options = [],          // sections that already exist
  placeholder = 'No sections yet',
  compact = false,
}) {
  const selected = useMemo(() => split(value), [value]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [pos, setPos] = useState(null);
  const boxRef = useRef(null);
  const panelRef = useRef(null);
  const btnRef = useRef(null);

  // The picker lives inside table cells whose ancestors clip overflow
  // (.table-scroll, .card), so an absolutely positioned panel loses everything
  // below the first line — the list of sections included. Render it in a portal
  // at fixed coordinates instead, and keep those coordinates in step with the
  // button as the page or the table scrolls.
  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8)),
      top: r.bottom + 6,
      bottom: window.innerHeight - r.top + 6,
      flip: below < 260 && r.top > below, // not enough room under the button
      maxH: Math.max(160, (below < 260 && r.top > below ? r.top : below) - 20),
    });
  }, []);

  // Only subscribes while open; the opening click does the first placement, so
  // nothing here sets state during render.
  useEffect(() => {
    if (!adding) return;
    const onDown = (e) => {
      if (boxRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setAdding(false);
    };
    document.addEventListener('mousedown', onDown);
    // Capture phase so scrolling any ancestor (the table, the page) repositions.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [adding, place]);

  const available = options
    .filter(o => o && !selected.includes(o))
    .filter(o => o.toLowerCase().includes(draft.trim().toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  const add = (sec) => {
    const s = (sec || '').trim();
    // Guard the two failure modes typing allows: an embedded comma would
    // silently create two sections, and a duplicate would double the entry.
    if (!s || s.includes(',') || selected.includes(s)) { setDraft(''); return; }
    onChange(join([...selected, s]));
    setDraft('');
  };

  const remove = (sec) => onChange(join(selected.filter(s => s !== sec)));

  const unusedCount = options.filter(o => o && !selected.includes(o)).length;

  const panel = adding && pos && createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed', left: pos.left, zIndex: 1200,
        ...(pos.flip ? { bottom: pos.bottom } : { top: pos.top }),
        background: 'var(--surface)', border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)', boxShadow: 'var(--s-lg, 0 8px 24px rgba(0,0,0,.14))',
        padding: 10, width: PANEL_W,
      }}
    >
      <input
        className="input"
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); add(available[0] || draft); }
          if (e.key === 'Escape') setAdding(false);
        }}
        placeholder={unusedCount ? 'Search or type a new one' : 'Type a new section'}
        style={{ fontSize: 13, padding: '7px 9px', marginBottom: 8 }}
      />

      <div style={{ maxHeight: Math.min(220, pos.maxH), overflowY: 'auto' }}>
        {available.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--ink-4)', margin: 0, padding: '4px 2px' }}>
            {options.length === 0
              ? 'No sections yet — type one to create it.'
              : draft.trim()
                ? 'No match.'
                : 'All existing sections are already added.'}
          </p>
        )}
        {available.map(o => (
          <button
            key={o}
            type="button"
            onClick={() => add(o)}
            style={{
              display: 'block', width: '100%', textAlign: 'left', background: 'none',
              border: 0, padding: '6px 8px', borderRadius: 'var(--r-xs)', cursor: 'pointer',
              fontSize: 13, color: 'var(--ink-1)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            {o}
          </button>
        ))}

        {/* Creating a new section stays possible, but it is the explicit
            path rather than the default one. */}
        {draft.trim() && !options.includes(draft.trim()) && !selected.includes(draft.trim()) && (
          <button
            type="button"
            onClick={() => add(draft)}
            style={{
              display: 'block', width: '100%', textAlign: 'left', background: 'var(--ok-bg)',
              border: '1px dashed var(--ok-bd)', padding: '6px 8px', borderRadius: 'var(--r-xs)',
              cursor: 'pointer', fontSize: 13, color: 'var(--ok)', marginTop: 4,
            }}
          >
            Create new section “{draft.trim()}”
          </button>
        )}
      </div>
    </div>,
    document.body
  );

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
      {selected.length === 0 && !adding && (
        <span style={{ fontSize: 12.5, color: 'var(--ink-4)', fontStyle: 'italic' }}>{placeholder}</span>
      )}

      {selected.map(sec => (
        <span key={sec} className="px-pill brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, paddingRight: 4 }}>
          {sec}
          <button
            type="button"
            onClick={() => remove(sec)}
            aria-label={`Remove ${sec}`}
            style={{ width: 'auto', background: 'none', border: 0, padding: '0 2px', cursor: 'pointer', color: 'inherit', opacity: .65, lineHeight: 1, fontSize: 14 }}
          >
            ×
          </button>
        </span>
      ))}

      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (adding) { setAdding(false); return; }
          place();          // measure before the panel exists, not after
          setDraft('');
          setAdding(true);
        }}
        className="btn ghost sm"
        style={{ width: 'auto', padding: compact ? '3px 8px' : '4px 10px', fontSize: 12 }}
      >
        <Icon name="plus" size={11} /> Add
        {unusedCount > 0 && (
          <span style={{ opacity: .6, marginLeft: 2 }}>({unusedCount})</span>
        )}
      </button>

      {panel}
    </div>
  );
}
