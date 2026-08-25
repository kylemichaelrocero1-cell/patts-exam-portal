import { useState } from 'react';
import Icon from '../components/Icon';
import { supabase } from '../supabase';

// Per-assessment review controls, plus the action that turns a real paper
// into a practice copy.
//
// The safety rule this UI has to carry: switching answers on for a paper you
// still mark hands students the key. So the destructive-feeling option is the
// one that is loud, and the safe path — duplicating — is the one put forward.

// Defined at module scope: a component created inside render is a new type on
// every pass, which remounts its subtree and loses focus mid-typing.
function ToggleRow({ on, set, label, hint, danger }) {
  return (
    <label style={{
      display: 'flex', gap: 11, alignItems: 'flex-start', padding: '12px 14px',
      border: `1px solid ${on && danger ? 'var(--warn-bd)' : 'var(--line)'}`,
      background: on && danger ? 'var(--warn-bg)' : 'var(--surface)',
      borderRadius: 'var(--r-md)', marginBottom: 10, cursor: 'pointer',
    }}>
      <input type="checkbox" checked={on} onChange={e => set(e.target.checked)} style={{ marginTop: 2 }} />
      <span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>{hint}</span>
      </span>
    </label>
  );
}

export default function ReviewSettings({ assessment, sections = [], onClose, onSaved }) {
  const a = assessment;
  const [retakes, setRetakes] = useState(!!a.allow_retakes);
  const [answers, setAnswers] = useState(!!a.show_answers);
  // Kept as-is on save so an existing paper's stored policy is not silently
  // rewritten; nothing in the dashboard reads it any more.
  const policy = a.score_policy || 'latest';
  const [busy, setBusy] = useState(false);

  const [dupOpen, setDupOpen] = useState(false);
  const [dupTitle, setDupTitle] = useState(`Mock Exam — ${a.title}`);
  const [dupSection, setDupSection] = useState('Pre-Boards PATTS');

  const hasResults = (a._resultCount ?? 0) > 0;

  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from('assessments')
      .update({ allow_retakes: retakes, show_answers: answers, score_policy: policy })
      .eq('id', a.id);
    setBusy(false);
    if (error) return alert('Could not save: ' + error.message);
    onSaved?.({ ...a, allow_retakes: retakes, show_answers: answers, score_policy: policy });
    onClose();
  };

  const duplicate = async () => {
    if (!dupTitle.trim()) return alert('Give the copy a name.');
    if (!dupSection.trim()) return alert('Choose which section the copy is for.');
    setBusy(true);
    const { data, error } = await supabase.rpc('duplicate_assessment', {
      p_source_id: a.id,
      p_new_title: dupTitle.trim(),
      p_target_section: dupSection.trim(),
      p_allow_retakes: true,
      p_show_answers: true,
      p_score_policy: 'latest',
    });
    setBusy(false);
    if (error) return alert('Could not duplicate: ' + error.message);
    alert(
      `"${dupTitle.trim()}" created for ${dupSection.trim()}.\n\n` +
      'It is CLOSED until you open it, and it has unlimited retakes and answer ' +
      'review switched on. The original paper is untouched.'
    );
    onSaved?.(null, data);
    onClose();
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1200, padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ maxWidth: 620, width: '100%', maxHeight: '92vh', overflowY: 'auto', padding: 24 }}>
        <h3 style={{ margin: '0 0 4px' }}>Review settings</h3>
        <p style={{ margin: '0 0 18px', color: 'var(--ink-3)', fontSize: 13.5 }}>{a.title}</p>

        {/* The warning that matters. Shown before the switch, not after. */}
        {hasResults && !a.show_answers && (
          <div style={{ background: 'var(--warn-bg)', border: '1.5px solid var(--warn-bd)', borderRadius: 'var(--r-md)', padding: '12px 14px', marginBottom: 16, display: 'flex', gap: 9 }}>
            <Icon name="alert" size={16} color="#B8860B" />
            <span style={{ fontSize: 13, color: '#7B5800', lineHeight: 1.55 }}>
              This paper already has <strong>{a._resultCount} graded submissions</strong>. If you
              might reuse these questions, duplicate it as a mock exam instead — switching answers
              on here reveals the key for the real paper.
            </span>
          </div>
        )}

        <ToggleRow
          on={retakes} set={setRetakes}
          label="Unlimited retakes"
          hint="Students can sit this as many times as they like. Attempts are kept separately and never change a graded result."
        />
        <ToggleRow
          on={answers} set={setAnswers} danger
          label="Show correct answers after submitting"
          hint="After a student submits, they can see which questions they got right and what the correct answer was. Only ever switch this on for practice material."
        />

        {/* The which-attempt-counts picker is gone: the dashboard no longer
            chooses one. Class Review shows the latest attempt — where the
            student stands today — and Practice Results shows first, latest,
            best and the whole history. score_policy stays in the database for
            the assessment_scores view, set to 'latest' on new mock copies. */}
        {retakes && (
          <p style={{ margin: '2px 2px 10px', fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.55 }}>
            Class Review will show each student's <strong>latest</strong> attempt on this paper.
            Every attempt is listed in the Practice Results tab.
          </p>
        )}

        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />

        {!dupOpen ? (
          <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setDupOpen(true)}>
            <Icon name="copy" size={14} /> Duplicate as a mock exam
          </button>
        ) : (
          <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: 14 }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
              Copies this paper and its questions into a new one with retakes and answer
              review on. Created <strong>closed</strong>, and the original is left exactly as it is.
            </p>
            <label className="label">Name</label>
            <input className="input" value={dupTitle} onChange={e => setDupTitle(e.target.value)} />
            <label className="label">For which section</label>
            <input
              className="input" value={dupSection} list="rs-sections"
              onChange={e => setDupSection(e.target.value)}
              placeholder="Pre-Boards PATTS"
            />
            <datalist id="rs-sections">
              {sections.map(sec => <option key={sec} value={sec} />)}
            </datalist>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn sm" style={{ width: 'auto' }} onClick={duplicate} disabled={busy}>
                {busy ? 'Creating…' : 'Create copy'}
              </button>
              <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setDupOpen(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 22 }}>
          <button className="btn ghost" style={{ width: 'auto' }} onClick={onClose}>Cancel</button>
          <button className="btn" style={{ width: 'auto' }} onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
