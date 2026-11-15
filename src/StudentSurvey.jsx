import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import Icon from './components/Icon';
import {
  SURVEY_ID, SURVEY_LABEL, STEPS, TEXT_MAX,
  emptyAnswers, cleanAnswers, isShown,
} from './lib/boardSurvey.js';
import { markSurveySeen } from './lib/surveyInvite.js';
import { isMissingFunctionError } from './lib/assessmentsCore.js';
import { gateErrorMessage, isSessionExpiredError } from './lib/sessionErrors.js';

// The board exam survey, as a student sees it (Survey tab). One short step at
// a time so it never feels long: about them, one step per subject (what came
// out, how well PATTS prepared them), the mock exams, the aero faculty, and a
// last step. Every Next saves to the database (sql/149), so a survey left
// halfway still counts; Submit marks it finished. A draft also stays in this
// browser, so a refresh loses nothing. The questions are src/lib/boardSurvey.js.

const LAST = STEPS.length - 1;
const draftKey = id => `patts_board_survey_${SURVEY_ID}_draft_${id}`;
const readDraft = id => {
  try { return JSON.parse(localStorage.getItem(draftKey(id)) || 'null'); } catch { return null; }
};
const writeDraft = (id, d) => {
  try { if (d) localStorage.setItem(draftKey(id), JSON.stringify(d)); else localStorage.removeItem(draftKey(id)); } catch { /* private mode */ }
};

function Chip({ type, name, on, onChange, children }) {
  return (
    <label className={`sv-chip${on ? ' is-on' : ''}`}>
      <input type={type} name={name} checked={on} onChange={onChange} />
      {type === 'checkbox' && <span className="sv-chip-box" aria-hidden="true">{on ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}</span>}
      {children}
    </label>
  );
}

function Question({ item, a, set }) {
  if (item.kind === 'text') {
    return (
      <div className="sv-q">
        <label className="sv-legend" htmlFor={`sv-${item.id}`}>
          {item.q}{item.optional && <span className="sv-optional"> (optional)</span>}
        </label>
        <textarea id={`sv-${item.id}`} className="sv-text" rows={3} maxLength={TEXT_MAX}
          value={a.text[item.id] || ''} placeholder={item.placeholder}
          onChange={e => set('text', item.id, e.target.value)} />
      </div>
    );
  }
  if (item.kind === 'one') {
    return (
      <fieldset className="sv-q">
        <legend className="sv-legend">{item.q}{item.optional && <span className="sv-optional"> (optional)</span>}</legend>
        <div className="sv-chips">
          {item.options.map(o => (
            <Chip key={o.id} type="radio" name={item.id} on={a.one[item.id] === o.id} onChange={() => set('one', item.id, o.id)}>{o.label}</Chip>
          ))}
        </div>
      </fieldset>
    );
  }
  const picked = a.many[item.id] || [];
  const toggle = id => set('many', item.id, picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id]);
  const groups = item.groups || [{ label: null, topics: item.options }];
  return (
    <fieldset className="sv-q">
      <legend className="sv-legend">{item.q}</legend>
      {groups.map(g => (
        <div key={g.label || 'all'} className="sv-group">
          {g.label && <div className="sv-group-label">{g.label}</div>}
          <div className="sv-chips">
            {g.topics.map(o => (
              <Chip key={o.id} type="checkbox" name={item.id} on={picked.includes(o.id)} onChange={() => toggle(o.id)}>{o.label}</Chip>
            ))}
          </div>
        </div>
      ))}
    </fieldset>
  );
}

// `preview`: an instructor trying the form from the Board Survey page. Nothing
// is read, saved or remembered.
export default function StudentSurvey({ student, preview = false }) {
  const [phase, setPhase] = useState(preview ? 'form' : 'loading');   // loading | closed | form | done
  const [step, setStep] = useState(0);
  const [a, setA] = useState(emptyAnswers);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const topRef = useRef(null);
  const chain = useRef(Promise.resolve());

  // Their answers: this browser's draft if there is one, else what was saved.
  useEffect(() => {
    if (preview) return undefined;
    let cancelled = false;
    markSurveySeen(student.id);
    (async () => {
      const draft = readDraft(student.id);
      const { data, error: err } = await supabase.rpc('my_board_survey', {
        p_student_id: student.id,
        p_session_token: localStorage.getItem('local_session_token'),
        p_survey: SURVEY_ID,
      });
      if (cancelled) return;
      if (err && isMissingFunctionError(err)) { setPhase('closed'); return; }
      if (err) setError(gateErrorMessage(err));
      // Saved somewhere else since this draft was written: the saved copy wins.
      const savedLater = data?.updated_at && draft?.at && Date.parse(data.updated_at) > draft.at;
      if (draft?.answers && !savedLater) {
        setA(cleanAnswers(draft.answers));
        setStep(Math.min(Math.max(0, draft.step | 0), LAST));
        setPhase('form');
      } else if (data?.answers) {
        setA(cleanAnswers(data.answers));
        setPhase(data.completed_at ? 'done' : 'form');
      } else {
        setPhase('form');
      }
    })();
    return () => { cancelled = true; };
  }, [student.id, preview]);

  useEffect(() => {
    if (phase === 'form' && !preview) writeDraft(student.id, { step, answers: a, at: Date.now() });
  }, [phase, step, a, student.id, preview]);

  const set = (kind, id, value) => setA(prev => ({ ...prev, [kind]: { ...prev[kind], [id]: value } }));

  // Saves run one after another, so an older step can never land after Submit.
  const save = final => {
    if (preview) return Promise.resolve(null);
    const answers = cleanAnswers(a);
    const run = chain.current.then(async () => {
      try {
        const { error: err } = await supabase.rpc('save_my_board_survey', {
          p_student_id: student.id,
          p_session_token: localStorage.getItem('local_session_token'),
          p_survey: SURVEY_ID,
          p_answers: answers,
          p_final: final,
        });
        return err || null;
      } catch (e) {
        return e;
      }
    });
    chain.current = run;
    return run;
  };

  const toTop = () => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const go = s => { setStep(s); setError(''); toTop(); };

  const next = async e => {
    e.preventDefault();
    if (step < LAST) {
      // Not waited on: the next step shows at once. A session that has ended
      // is said here rather than only at Submit.
      save(false).then(err => { if (err && isSessionExpiredError(err)) setError(gateErrorMessage(err)); });
      go(step + 1);
      return;
    }
    setSending(true); setError('');
    const err = await save(true);
    setSending(false);
    if (err) {
      setError(isMissingFunctionError(err) ? 'The survey is not open yet.' : gateErrorMessage(err));
      return;
    }
    if (!preview) writeDraft(student.id, null);
    setPhase('done');
    toTop();
  };

  if (phase === 'loading') {
    return <div className="sv-wrap" style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 40 }}>Loading survey…</div>;
  }

  if (phase === 'closed') {
    return (
      <div className="sv-wrap">
        <div className="card sv-done">
          <span className="chip chip-navy"><Icon name="clock" size={18} /></span>
          <h2>Not open yet</h2>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="sv-wrap" ref={topRef}>
        <div className="card sv-done" role="status">
          <span className="chip chip-ok"><Icon name="check" size={20} /></span>
          <h2>Thank you!</h2>
          <p>Your answers help the aero faculty prepare the next batch.</p>
          <button type="button" className="btn ghost" onClick={() => { setStep(0); setPhase('form'); }}>
            <Icon name="edit" size={15} /> Edit answers
          </button>
        </div>
      </div>
    );
  }

  const s = STEPS[step];
  return (
    <div className="sv-wrap" ref={topRef}>
      <div className="sv-head">
        <div className="eyebrow">Board exam survey · {SURVEY_LABEL}</div>
        <div className="sv-progress" aria-hidden="true"><span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
        <div className="sv-count">{step + 1} / {STEPS.length}</div>
      </div>

      <form className="card sv-card" onSubmit={next} noValidate>
        <h2 className="sv-title">{s.title}</h2>
        {s.sub && <p className="sv-sub">{s.sub}</p>}
        {s.items.filter(it => isShown(it, a)).map(it => <Question key={it.id} item={it} a={a} set={set} />)}

        {error && (
          <div className="sv-error" role="alert"><Icon name="alert" size={15} /> {error}</div>
        )}
        <div className="sv-nav">
          {step > 0 && (
            <button type="button" className="btn ghost" onClick={() => go(step - 1)}>
              <Icon name="arrow-left" size={15} /> Back
            </button>
          )}
          <button type="submit" className="btn" disabled={sending}>
            {step < LAST ? <>Next <Icon name="arrow-right" size={15} /></> : sending ? 'Sending…' : <>Submit <Icon name="send" size={15} /></>}
          </button>
        </div>
      </form>
    </div>
  );
}
