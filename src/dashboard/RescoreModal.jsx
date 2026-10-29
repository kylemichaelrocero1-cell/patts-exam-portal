import { useState } from 'react';
import Icon from '../components/Icon';
import { supabase } from '../supabase';
import { isMissingFunctionError } from '../lib/assessments';

// Re-score a paper after its key changed (sql/131). A mark is written when a
// sitting is filed, so a key edited later changed nothing already recorded.
// This asks rescore_paper() page by page — ten sittings a call keeps a long
// paper inside the time an instructor's request may run — first for a
// preview, then to apply exactly that.

const PAGE = 10;

async function allPages(examId, mode, apply, onProgress) {
  const rows = [];
  let offset = 0, total;
  for (;;) {
    const { data, error } = await supabase.rpc('rescore_paper', {
      p_assessment_id: examId, p_mode: mode, p_apply: apply, p_offset: offset, p_limit: PAGE,
    });
    if (error) throw error;
    rows.push(...(data?.rows || []));
    total = data?.sittings || 0;
    onProgress?.(Math.min(offset + PAGE, total), total);
    if (data?.next_offset == null) break;
    offset = data.next_offset;
  }
  return { rows, total };
}

const itemText = it => (typeof it.from === 'string'
  ? `Q${it.n} ${it.from} → ${it.to}`
  : `Q${it.n} ${it.from} → ${it.to} pts`);

export default function RescoreModal({ exam, onClose, onDone }) {
  const [mode, setMode] = useState('raise');
  const [busy, setBusy] = useState(null);           // 'preview' | 'apply' | null
  const [progress, setProgress] = useState(null);   // [done, total]
  const [preview, setPreview] = useState(null);     // { rows, total, mode }
  const [applied, setApplied] = useState(null);     // number of papers changed
  const [problem, setProblem] = useState('');

  const fail = (err) => {
    console.error('Re-score failed:', err);
    setProblem(isMissingFunctionError(err)
      ? 'Re-scoring needs a database update (sql/131) that has not been run yet. Nothing was changed.'
      : 'Could not re-score this paper. Nothing was changed — please try again.');
  };

  const runPreview = async () => {
    setBusy('preview'); setProblem(''); setApplied(null); setPreview(null);
    try {
      const { rows, total } = await allPages(exam.id, mode, false, (d, t) => setProgress([d, t]));
      setPreview({ rows: rows.sort((a, b) => (a.name || '').localeCompare(b.name || '')), total, mode });
    } catch (e) { fail(e); }
    setBusy(null); setProgress(null);
  };

  const runApply = async () => {
    setBusy('apply'); setProblem('');
    try {
      const { rows } = await allPages(exam.id, preview.mode, true, (d, t) => setProgress([d, t]));
      setApplied(rows.length);
      setPreview(null);
      onDone?.();
    } catch (e) { fail(e); }
    setBusy(null); setProgress(null);
  };

  const downs = preview?.rows.filter(r => r.to < r.from).length || 0;
  const pick = m => { setMode(m); setPreview(null); setApplied(null); };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-labelledby="rescore-title" style={{ background: 'var(--surface)', borderRadius: 'var(--r-2xl)', width: '100%', maxWidth: 620, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--sh-modal)' }}>
        <div className="patts-header" style={{ padding: '22px 26px' }}>
          <h2 id="rescore-title" style={{ margin: 0, color: 'white', fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="refresh" size={18} color="white" /> Re-score after a key change
          </h2>
          <p style={{ margin: '5px 0 0', color: 'rgba(255,255,255,.7)', fontSize: 13 }}>{exam.title}</p>
        </div>

        <div style={{ padding: '18px 26px', overflowY: 'auto', flex: 1, fontSize: 13.5, color: 'var(--ink-2)' }}>
          <p style={{ margin: '0 0 12px', lineHeight: 1.55 }}>
            Marks every submitted paper again against the questions as they are now. Use it after you change a
            key, add a choice that also counts, or add a unit or answer form.
          </p>

          <div role="radiogroup" aria-label="How to re-score" style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
            {[
              ['raise', 'Raise only', 'Nobody goes down. For a key that was too strict: another choice also counts, a unit or form to accept.'],
              ['full', 'Full re-score', 'Every answer takes its new mark, up or down. For a key that was simply wrong.'],
            ].map(([m, label, hint]) => (
              <label key={m} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 'var(--r-sm)', cursor: 'pointer',
                border: `1.5px solid ${mode === m ? 'var(--navy)' : 'var(--line)'}`, background: mode === m ? 'var(--navy-50)' : 'var(--surface)' }}>
                <input type="radio" name="rescore-mode" checked={mode === m} onChange={() => pick(m)} disabled={!!busy} style={{ marginTop: 3, width: 16, height: 16 }} />
                <span><strong style={{ color: 'var(--ink-1)' }}>{label}</strong><br /><span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{hint}</span></span>
              </label>
            ))}
          </div>

          <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--ink-3)' }}>
            Answers you marked by hand are never changed. Practice retakes are not re-scored.
          </p>

          {problem && (
            <div role="alert" style={{ background: 'var(--bad-bg)', border: '1px solid var(--bad-bd)', color: 'var(--bad)', borderRadius: 'var(--r-sm)', padding: '10px 12px', marginBottom: 12, fontWeight: 600 }}>
              {problem}
            </div>
          )}

          {progress && (
            <p style={{ margin: '0 0 12px', fontWeight: 600, color: 'var(--navy)' }}>
              {busy === 'apply' ? 'Applying' : 'Checking'}… {progress[0]} of {progress[1]} papers
            </p>
          )}

          {applied !== null && (
            <div style={{ background: 'var(--ok-bg)', border: '1px solid var(--ok-bd)', color: 'var(--ok)', borderRadius: 'var(--r-sm)', padding: '10px 12px', marginBottom: 12, fontWeight: 600 }}>
              Done — {applied} paper{applied === 1 ? '' : 's'} re-scored.
            </div>
          )}

          {preview && (
            preview.rows.length === 0 ? (
              <p style={{ margin: 0, fontWeight: 600 }}>
                Nothing changes — all {preview.total} submitted paper{preview.total === 1 ? '' : 's'} already match the key.
              </p>
            ) : (
              <>
                <p style={{ margin: '0 0 8px', fontWeight: 600, color: 'var(--ink-1)' }}>
                  {preview.rows.length} of {preview.total} paper{preview.total === 1 ? '' : 's'} would change
                  {downs > 0 && <span style={{ color: 'var(--bad)' }}> — {downs} go{downs === 1 ? 'es' : ''} down</span>}:
                </p>
                <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                  {preview.rows.map(r => (
                    <div key={r.result_id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', padding: '8px 12px', borderTop: '1px solid var(--line)' }}>
                      <span style={{ flex: '1 1 180px', fontWeight: 600, color: 'var(--ink-1)', overflowWrap: 'anywhere' }}>{r.name}</span>
                      <span style={{ fontWeight: 700, color: r.to < r.from ? 'var(--bad)' : 'var(--ok)', whiteSpace: 'nowrap' }}>
                        {r.from} → {r.to}{r.out_of ? ` / ${r.out_of}` : ''}
                      </span>
                      <span style={{ flex: '1 1 100%', fontSize: 12, color: 'var(--ink-3)' }}>{r.items.map(itemText).join(' · ')}</span>
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '14px 26px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <button type="button" className="btn ghost" onClick={onClose} disabled={!!busy} style={{ width: 'auto' }}>Close</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={runPreview} disabled={!!busy} style={{ width: 'auto' }}>
            {busy === 'preview' ? 'Checking…' : preview ? 'Check again' : 'Preview changes'}
          </button>
          {preview?.rows.length > 0 && (
            <button type="button" className="btn" onClick={runApply} disabled={!!busy}
              style={{ width: 'auto', ...(downs ? { background: 'var(--bad)' } : {}) }}>
              {busy === 'apply' ? 'Applying…' : `Apply to ${preview.rows.length} paper${preview.rows.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
