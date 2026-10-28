import { useState } from 'react';
import Icon from './Icon';
import { splitRow } from '../lib/questionCsv';
import { CSV_GUIDES, CSV_GENERAL_TIPS, guideCsv, tipParts } from '../lib/csvGuide';

// The question CSV, explained by the kind of paper being set. It sits wherever
// a Download Template button is — Create New Exam, and Import Questions on the
// Manage Questions tab — and every example it shows is a file the instructor
// can download as a starting point. The words live in lib/csvGuide.js, shared
// with the printable PDF guide.

const CSV_GUIDE_PDF = '/guides/PATTS_Question_CSV_Guide.pdf';

const COL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function downloadGuide(guide) {
  const blob = new Blob([guideCsv(guide)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = guide.file; a.click();
  URL.revokeObjectURL(url);
}

function Tip({ text }) {
  return tipParts(text).map((p, i) => (p.code
    ? <code key={i} style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3, fontSize: '0.92em' }}>{p.text}</code>
    : <span key={i}>{p.text}</span>));
}

/** The example drawn as a spreadsheet, the way it looks in Excel or Sheets. */
function SheetPreview({ lines }) {
  const rows = lines.map(splitRow);
  const width = Math.max(...rows.map(r => r.length));
  const cell = { border: '1px solid var(--line)', padding: '4px 8px', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12, textAlign: 'left' };
  const gutter = { ...cell, background: 'var(--surface-2)', color: 'var(--ink-4)', fontSize: 11, fontWeight: 500, textAlign: 'center', padding: '3px 6px' };
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-xs)', background: 'var(--surface)' }}>
      <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%' }}>
        <thead>
          <tr>
            <th style={gutter} aria-hidden="true"></th>
            {Array.from({ length: width }, (_, i) => <th key={i} style={gutter}>{COL_LETTERS[i] || ''}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              <td style={gutter}>{ri + 1}</td>
              {Array.from({ length: width }, (_, ci) => (
                <td key={ci} title={r[ci] || ''} style={{
                  ...cell,
                  ...(ri === 0 ? { fontWeight: 700, background: 'var(--navy-50)', color: 'var(--navy)', fontFamily: 'var(--font-mono)' } : { color: 'var(--ink-2)' }),
                }}>{r[ci] || ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CsvGuide() {
  const [key, setKey] = useState(CSV_GUIDES[0].key);
  const guide = CSV_GUIDES.find(g => g.key === key) || CSV_GUIDES[0];

  return (
    <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
      <div style={{ fontWeight: 600, color: 'var(--ink-1)', marginBottom: 8 }}>What kind of paper are you making?</div>
      <div role="group" aria-label="Kind of paper" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {CSV_GUIDES.map(g => {
          const on = g.key === key;
          return (
            <button key={g.key} type="button" aria-pressed={on} onClick={() => setKey(g.key)}
              style={{
                width: 'auto', padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--navy)' : 'var(--line)'}`,
                background: on ? 'var(--navy)' : 'var(--surface)', color: on ? 'white' : 'var(--ink-2)',
              }}>
              {g.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 14 }}>{guide.label}</div>
          <div>{guide.use}</div>
        </div>
        <button type="button" className="btn ghost sm" style={{ width: 'auto' }} onClick={() => downloadGuide(guide)}>
          <Icon name="download" size={13} /> Download this example
        </button>
      </div>

      <SheetPreview lines={guide.lines} />

      <ul style={{ margin: '12px 0 0', paddingLeft: 18 }}>
        {guide.tips.map((t, i) => <li key={i} style={{ marginBottom: 4 }}><Tip text={t} /></li>)}
      </ul>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 600, color: 'var(--ink-1)', marginBottom: 4 }}>For every file</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {CSV_GENERAL_TIPS.map((t, i) => <li key={i} style={{ marginBottom: 4 }}><Tip text={t} /></li>)}
        </ul>
        <a href={CSV_GUIDE_PDF} target="_blank" rel="noopener noreferrer" className="btn ghost sm"
          style={{ width: 'auto', marginTop: 10, display: 'inline-flex', textDecoration: 'none' }}>
          <Icon name="file-text" size={13} /> Open the printable guide (PDF)
        </a>
      </div>
    </div>
  );
}

/** The rows an uploaded file could not use, each with its row number and why. */
export function CsvErrors({ errors, heading = 'Fix these rows in your CSV:' }) {
  if (!errors?.length) return null;
  return (
    <div role="alert" style={{ marginTop: 12, background: 'var(--bad-bg)', border: '1px solid var(--bad-bd)', borderRadius: 'var(--r-sm)', padding: '10px 14px' }}>
      <p style={{ margin: '0 0 6px', fontWeight: 700, color: 'var(--bad)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="alert" size={14} color="var(--bad)" /> {heading}
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--bad)', fontSize: 12 }}>
        {errors.map((e, i) => <li key={i}>{e}</li>)}
      </ul>
    </div>
  );
}
