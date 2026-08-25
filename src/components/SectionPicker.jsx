import { useState, useMemo, useRef, useEffect } from 'react';
import Icon from './Icon';

// Sections are stored as one comma-separated string. Typing that by hand is how
// "AENG 426" ends up as "AENG426", how a stray comma leaves a blank entry, and
// how a typo silently detaches a student or an exam from everything.
//
// This edits the same string, but through chips: pick from what already exists,
// and only fall back to typing for a genuinely new section.

const split = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);
const join = (arr) => arr.join(', ');

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
  const boxRef = useRef(null);

  // Close the picker on an outside click, so it does not sit open over the row.
  useEffect(() => {
    if (!adding) return;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setAdding(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [adding]);

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
        type="button"
        onClick={() => setAdding(v => !v)}
        className="btn ghost sm"
        style={{ width: 'auto', padding: compact ? '3px 8px' : '4px 10px', fontSize: 12 }}
      >
        <Icon name="plus" size={11} /> Add
      </button>

      {adding && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 60, marginTop: 6,
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 'var(--r-md)', boxShadow: 'var(--s-lg, 0 8px 24px rgba(0,0,0,.14))',
          padding: 10, minWidth: 240, maxWidth: 320,
        }}>
          <input
            className="input"
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); add(available[0] || draft); }
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="Search or type a new one"
            style={{ fontSize: 13, padding: '7px 9px', marginBottom: 8 }}
          />

          <div style={{ maxHeight: 190, overflowY: 'auto' }}>
            {available.length === 0 && !draft.trim() && (
              <p style={{ fontSize: 12, color: 'var(--ink-4)', margin: 0, padding: '4px 2px' }}>
                All existing sections are already added.
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
        </div>
      )}
    </div>
  );
}
