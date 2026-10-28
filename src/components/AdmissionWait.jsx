// The screen between the password and the paper when the instructor lets
// each student in from the live monitor (sql/115).
//
// It asks request_admission() every few seconds with an entry id made here,
// and only that id can fetch the paper once the instructor allows it — so a
// reload, another login or another phone is a new entry and waits again. The
// student's name is shown large and a clock ticks, so the instructor walking
// the room sees at a glance that it is this student's own live screen.
//
// The sitting has not started: ExamBoard, which opens it and starts its
// clock, only mounts once this screen hands over.

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { supabase } from '../supabase';
import { formatName } from '../lib/personName';
import { newEntryId, ADMISSION_POLL_MS, admissionView, waitedFor } from '../lib/admission';
import { gateErrorMessage, isSessionExpiredError } from '../lib/sessionErrors';

export default function AdmissionWait({ exam, student, onEnter, onCancel }) {
  const [entry, setEntry] = useState(() => newEntryId());
  const [status, setStatus] = useState(null);
  const [problem, setProblem] = useState(null);   // { text, fatal }
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const enteredRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let stop = false, timer = null;
    const ask = async () => {
      const { data, error } = await supabase.rpc('request_admission', {
        p_assessment_id: exam.id,
        p_student_id: student.id,
        p_session_token: localStorage.getItem('local_session_token'),
        p_entry: entry,
      });
      if (stop) return;
      if (error) {
        // A refusal the student can act on stops the asking; anything else
        // (a dropped connection) is tried again on the next tick.
        const fatal = isSessionExpiredError(error) || /password|section|not open|exists/i.test(error.message || '');
        setProblem({ text: fatal ? gateErrorMessage(error) : 'Trying to reach the server…', fatal });
        if (!fatal) timer = setTimeout(ask, ADMISSION_POLL_MS);
        return;
      }
      setProblem(null);
      setStatus(data);
      const view = admissionView(data);
      if (view.enter) {
        if (!enteredRef.current) {
          enteredRef.current = true;
          onEnter(data === 'admitted' ? entry : null);
        }
        return;
      }
      if (data === 'waiting' || !view.again) timer = setTimeout(ask, ADMISSION_POLL_MS);
    };
    ask();
    return () => { stop = true; clearTimeout(timer); };
    // A new entry starts the asking over; onEnter is the parent's and stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, exam.id, student.id]);

  const askAgain = () => {
    setStatus(null);
    setProblem(null);
    setSince(Date.now());
    setEntry(newEntryId());
  };

  const view = admissionView(status);
  const tone = problem?.fatal ? 'bad' : view.tone;
  const clock = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

  return (
    <div className="admission-wait" role="dialog" aria-modal="true" aria-labelledby="admission-title"
      style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.92)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: 16, overflowY: 'auto' }}>
      <div style={{ background: 'var(--white)', borderRadius: 'var(--r-xl)', maxWidth: 420, width: '100%', overflow: 'hidden', boxShadow: 'var(--s-xl)' }}>
        <div style={{ background: 'linear-gradient(110deg, var(--navy-dark), var(--navy))', padding: '22px 22px 18px', textAlign: 'center', borderBottom: '3px solid var(--gold)' }}>
          <p style={{ color: 'rgba(244,208,63,.85)', margin: 0, fontSize: 13, fontWeight: 600 }}>{exam.title}</p>
          <h2 id="admission-title" style={{ color: 'white', margin: '10px 0 2px', fontSize: 24, fontWeight: 800, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
            {formatName(student.full_name)}
          </h2>
          <p style={{ color: 'rgba(255,255,255,.75)', margin: 0, fontSize: 13 }}>Show this screen to your instructor</p>
          <p aria-live="off" style={{ color: 'white', margin: '12px 0 0', fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, letterSpacing: '.04em' }}>
            {clock}
          </p>
        </div>

        <div style={{ padding: '20px 22px 22px' }} aria-live="polite">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span aria-hidden="true" style={{ flex: 'none', marginTop: 2 }}>
              {tone === 'bad'
                ? <Icon name="alert-circle" size={22} color="var(--bad)" />
                : <span className="admission-spinner" style={{ display: 'block', width: 20, height: 20, border: '3px solid var(--line)', borderTopColor: 'var(--navy)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
            </span>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: tone === 'bad' ? 'var(--bad)' : 'var(--ink-1)' }}>
                {problem?.fatal ? 'Cannot ask to enter' : view.title}
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.45 }}>
                {problem ? problem.text : view.text}
              </p>
              {status === 'waiting' && !problem && (
                <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--ink-3)' }}>Waiting {waitedFor(since, now)}</p>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            {view.again && !problem?.fatal && (
              <button type="button" className="btn" onClick={askAgain} style={{ flex: '1 1 140px', minHeight: 44 }}>
                <Icon name="refresh" size={15} /> Ask again
              </button>
            )}
            <button type="button" className="btn ghost" onClick={onCancel} style={{ flex: '1 1 140px', minHeight: 44 }}>
              Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
