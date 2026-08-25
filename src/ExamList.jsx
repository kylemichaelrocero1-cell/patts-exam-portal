import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import {
  selectAssessments, isAvailableNow, availabilityState, formatWindow, KIND_LABEL,
  fetchAssessmentById,
} from './lib/assessments';

export default function ExamList({ embedded = false, kind = null, student, selectedSection, onStartExam, onLogout }) {
  const [exams, setExams] = useState([]);
  const [completedExams, setCompletedExams] = useState([]);
  const [activeSessions, setActiveSessions] = useState({});
  const [attempts, setAttempts] = useState({});   // assessment_id -> attempts, newest first
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(false);

  // Password gate state
  const [pendingExam, setPendingExam] = useState(null);
  const [enteredPassword, setEnteredPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);

  const [recoveryMsg, setRecoveryMsg] = useState('');

  // On login, scan localStorage for saved exam progress and recover any unscored results
  useEffect(() => {
    if (!student?.id) return;

    const recover = async () => {
      const prefix = `exam_progress_${student.id}_`;
      const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
      if (!keys.length) return;

      let recovered = 0;

      for (const key of keys) {
        const examId = key.slice(prefix.length);
        let saved;
        try { saved = JSON.parse(localStorage.getItem(key)); } catch { continue; }
        if (!saved?.answers) continue;

        // Only recover if a result row exists but has no scored answers
        const { data: rows } = await supabase
          .from('results')
          .select('id, answers_json, total_items, time_taken_seconds, created_at')
          .eq('student_id', student.id)
          .eq('exam_id', examId)
          .limit(1);

        const result = rows?.[0];
        if (!result) continue;

        const alreadyScored = result.answers_json && Object.keys(result.answers_json).length > 0;
        if (alreadyScored) { localStorage.removeItem(key); continue; }

        // Re-score through the server. This used to fetch every correct_answer
        // and mark in the browser; sql/003 revokes that access, so after it
        // runs this path would mark everyone zero and quietly overwrite a
        // recovered paper with a wrong score.
        const { error: rpcErr } = await supabase.rpc('submit_assessment', {
          p_student_id: student.id,
          p_assessment_id: examId,
          p_answers: Object.fromEntries(
            Object.entries(saved.answers || {})
              .filter(([, v]) => v !== undefined && v !== null)
              .map(([k, v]) => [String(k), Number(v)])
          ),
          p_time_taken_seconds: null,
        });
        if (rpcErr) { console.error('Recovery re-score failed:', rpcErr.message); continue; }

        // submit_assessment writes the row itself, so only the fields it does
        // not own are patched here.
        let timeTaken = result.time_taken_seconds;
        if ((!timeTaken || timeTaken === 0) && saved.endTime && result.created_at) {
          const elapsed = Math.round((saved.endTime - new Date(result.created_at).getTime()) / 1000);
          if (elapsed > 0) timeTaken = elapsed;
        }
        const updatePayload = {};
        if (timeTaken && timeTaken > 0) updatePayload.time_taken_seconds = timeTaken;

        // Essays cannot be machine-marked, so merge them in alongside.
        const essays = {};
        Object.entries(saved.essayAnswers || {}).forEach(([qId, text]) => {
          if (text?.trim()) essays[String(qId)] = { type: 'essay', text: text.trim() };
        });
        if (Object.keys(essays).length > 0) {
          const { data: fresh } = await supabase.from('results')
            .select('answers_json').eq('id', result.id).maybeSingle();
          updatePayload.answers_json = { ...(fresh?.answers_json || {}), ...essays };
        }

        if (Object.keys(updatePayload).length === 0) {
          localStorage.removeItem(key);
          recovered++;
          continue;
        }

        const { error } = await supabase
          .from('results')
          .update(updatePayload)
          .eq('id', result.id);

        if (!error) {
          localStorage.removeItem(key);
          recovered++;
        }
      }

      if (recovered > 0) {
        setRecoveryMsg(`${recovered} exam result${recovered > 1 ? 's' : ''} recovered from your device.`);
        setTimeout(() => setRecoveryMsg(''), 9000);
      }
    };

    recover();
  }, [student?.id]);

  useEffect(() => {
    fetchExams(false);

    // Silent refresh — no spinner so students aren't disrupted when instructor opens/closes an exam.
    // Filter by is_open changes only — avoids re-fetching on unrelated exam edits.
    // Watch BOTH tables during the transition. The dashboard now writes new
    // exams and seatworks to `assessments`, and the exams -> assessments sync
    // trigger only runs the other way — so listening to `exams` alone would
    // mean a freshly opened seatwork never reaches a student's screen until
    // they reloaded. Drop the `exams` half at cutover.
    const channel = supabase.channel('examlist-realtime')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'exams', filter: 'is_open=eq.true' }, () => fetchExams(true))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'exams' }, () => fetchExams(true))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'assessments', filter: 'is_open=eq.true' }, () => fetchExams(true))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assessments' }, () => fetchExams(true))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedSection, kind]);

  const fetchExams = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setFetchError(false);
    try {
      // Fetch exams + completed results + active live sessions in parallel
      const [examsRes, resultsRes, liveRes, attemptsRes] = await Promise.all([
        // Reads assessments (exams + seatworks + schedule) and transparently
        // falls back to exams if the migration has not been run yet.
        selectAssessments(q => q.eq('is_open', true).order('created_at', { ascending: false }))
          .then(data => ({ data, error: null }), error => ({ data: null, error })),
        supabase
          .from('results')
          .select('exam_id')
          .eq('student_id', student.id),
        supabase
          .from('live_sessions')
          .select('exam_id, exam_set, answers_count, status, created_at')
          .eq('student_id', student.id)
          .in('status', ['active', 'locked']),
        // Retakes live here, not in results — without this a student saw no
        // trace of the mock exams they had already sat.
        supabase
          .from('review_attempts')
          .select('assessment_id, attempt_no, score, total_items, submitted_at')
          .eq('student_id', student.id)
          .order('attempt_no', { ascending: false }),
      ]);

      if (examsRes.error) throw examsRes.error;

      if (examsRes.data) {
        const filtered = examsRes.data.filter(exam => {
          if (!exam.target_section) return false;
          const sections = exam.target_section.split(',').map(s => s.trim());
          if (!sections.includes(selectedSection)) return false;
          // When the shell mounts this per-tab, show only that kind. Rows from
          // the pre-migration exams fallback are all 'exam', so a Seatwork tab
          // is simply empty until the migration lands.
          if (kind && (exam.kind || 'exam') !== kind) return false;
          // Hide anything outside its scheduled window. Rows coming from the
          // exams fallback have no window, so this is a no-op for them.
          return isAvailableNow(exam) || availabilityState(exam) === 'scheduled';
        });
        setExams(filtered);
      }

      if (resultsRes.data) {
        setCompletedExams(resultsRes.data.map(r => r.exam_id));
      }

      if (attemptsRes.data) {
        const byAssessment = {};
        attemptsRes.data.forEach(a => {
          (byAssessment[a.assessment_id] = byAssessment[a.assessment_id] || []).push(a);
        });
        setAttempts(byAssessment);
      }

      if (liveRes.data) {
        const sessionMap = {};
        liveRes.data.forEach(s => { sessionMap[s.exam_id] = s; });
        setActiveSessions(sessionMap);
      }
    } catch (err) {
      console.error('Failed to load exams:', err);
      setFetchError(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartClick = async (exam, setChoice) => {
    setIsCheckingSession(true);
    try {
      // Re-fetch exam metadata (no password — confirms exam is still open and gets latest has_password)
      // Via assessments, with a legacy fallback: a mock exam has no `exams`
      // row, so the old query returned nothing and the stale copy was used.
      const freshExam = await fetchAssessmentById(exam.id);

      // If student already has an active live session, skip the password gate (resuming after refresh)
      const { data: sessions } = await supabase
        .from('live_sessions')
        .select('id')
        .eq('student_id', student.id)
        .eq('exam_id', exam.id)
        .neq('status', 'finished')
        .limit(1);

      const examData = freshExam || exam;

      if (sessions?.length > 0) {
        onStartExam(examData, setChoice);
        return;
      }

      // Check sessionStorage to skip re-entry within the same browser session
      const sessionKey = `exam_pass_ok_${exam.id}`;
      if (sessionStorage.getItem(sessionKey)) {
        onStartExam(examData, setChoice);
        return;
      }

      if (examData.has_password) {
        setPendingExam({ ...examData, _chosenSet: setChoice });
        setEnteredPassword('');
        setPasswordError('');
      } else {
        onStartExam(examData, setChoice);
      }
    } catch (err) {
      console.error('Session check failed:', err);
      // Network error — fall back gracefully using cached exam data
      if (exam.has_password) {
        setPendingExam({ ...exam, _chosenSet: setChoice });
        setEnteredPassword('');
        setPasswordError('');
      } else {
        onStartExam(exam, setChoice);
      }
    } finally {
      setIsCheckingSession(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setIsVerifyingPassword(true);
    setPasswordError('');

    try {
      // Password verified server-side — the actual password never reaches the client
      const { data: isValid, error } = await supabase.rpc('verify_exam_password', {
        p_exam_id: pendingExam.id,
        p_password: enteredPassword,
      });

      if (error) throw error;

      if (isValid) {
        sessionStorage.setItem(`exam_pass_ok_${pendingExam.id}`, '1');
        onStartExam(pendingExam, pendingExam._chosenSet);
        setPendingExam(null);
      } else {
        setPasswordError('Incorrect password. Please try again.');
        setEnteredPassword('');
      }
    } catch (err) {
      console.error('Password verification failed:', err);
      setPasswordError('Could not verify password. Check your connection and try again.');
    } finally {
      setIsVerifyingPassword(false);
    }
  };

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--paper)' }}>
      <div style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
        <div style={{ width: 40, height: 40, border: '3px solid var(--line)', borderTopColor: 'var(--navy)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 14px' }} />
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--ink-2)' }}>Loading Exams…</p>
      </div>
    </div>
  );

  return (
    <div style={embedded ? undefined : { minHeight: '100vh', background: 'var(--bg)' }}>

      {/* PASSWORD GATE MODAL */}
      {pendingExam && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <form
            onSubmit={handlePasswordSubmit}
            style={{ background: 'var(--white)', borderRadius: 'var(--r-xl)', maxWidth: '400px', width: '100%', overflow: 'hidden', boxShadow: 'var(--s-xl)' }}
          >
            <div style={{ background: 'linear-gradient(110deg, var(--navy-dark), var(--navy))', padding: '28px', textAlign: 'center', borderBottom: '3px solid var(--gold)' }}>
              <div style={{ fontSize: '36px', marginBottom: '8px' }}>🔒</div>
              <h2 style={{ color: 'white', margin: 0, fontSize: '18px', fontWeight: 700 }}>Password Required</h2>
              <p style={{ color: 'rgba(244,208,63,.85)', margin: '6px 0 0', fontSize: '13px', fontWeight: 500 }}>{pendingExam.title}</p>
            </div>
            <div style={{ padding: '28px' }}>
              <p style={{ color: 'var(--text-3)', fontSize: '14px', textAlign: 'center', margin: '0 0 20px' }}>
                Ask your instructor for today's exam password.
              </p>
              <input
                type="password"
                value={enteredPassword}
                onChange={e => setEnteredPassword(e.target.value)}
                placeholder="Enter password"
                autoFocus
                disabled={isVerifyingPassword}
                style={{ textAlign: 'center', fontSize: '20px', letterSpacing: '4px', padding: '14px', borderColor: passwordError ? 'var(--danger)' : 'var(--border)' }}
              />
              {passwordError && (
                <p style={{ color: 'var(--danger)', fontWeight: 600, margin: '10px 0 0', fontSize: '13px', textAlign: 'center' }}>{passwordError}</p>
              )}
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button type="button" onClick={() => setPendingExam(null)} disabled={isVerifyingPassword}
                  style={{ flex: 1, background: 'var(--surface-2)', color: 'var(--text-2)', border: '1.5px solid var(--border)' }}>
                  Cancel
                </button>
                <button type="submit" disabled={!enteredPassword || isVerifyingPassword}
                  style={{ flex: 1, background: enteredPassword && !isVerifyingPassword ? 'var(--navy)' : 'var(--text-4)' }}>
                  {isVerifyingPassword ? 'Verifying…' : 'Enter Exam'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Header — skipped when embedded in StudentShell, which renders its
          own header plus the Lessons/Assessments tabs. */}
      {!embedded && (
      <header className="header" style={{ borderRadius: 0, marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <img src="/patts-logo.png" alt="PATTS" style={{ height: '40px', width: 'auto', objectFit: 'contain' }} />
          <p style={{ margin: 0, color: 'rgba(255,255,255,.8)', fontSize: '13.5px' }}>
            Welcome, <strong style={{ color: 'white' }}>{student.full_name}</strong>
          </p>
        </div>
        <button onClick={onLogout} style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.25)', color: 'white', padding: '9px 20px', width: 'auto', fontSize: '13px', fontWeight: 600, borderRadius: 'var(--r-sm)' }}>
          Log Out
        </button>
      </header>
      )}

      {/* Recovery toast */}
      {recoveryMsg && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-bd)', color: 'var(--success)', padding: '12px 20px', textAlign: 'center', fontSize: '14px', fontWeight: 600 }}>
          ✅ {recoveryMsg}
        </div>
      )}

      {/* Content */}
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '36px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
          <h2 style={{ margin: 0, color: 'var(--navy)', fontSize: '20px', fontWeight: 700 }}>Available Examinations</h2>
          <span style={{ background: 'var(--navy-tint)', color: 'var(--navy)', padding: '3px 12px', borderRadius: 'var(--r-full)', fontSize: '13px', fontWeight: 600, border: '1px solid var(--border)' }}>
            {exams.length} open
          </span>
        </div>

        {fetchError ? (
          <div style={{ background: 'var(--danger-bg)', padding: '32px', borderRadius: 'var(--r-lg)', textAlign: 'center', border: '1px solid var(--danger-bd)' }}>
            <p style={{ color: 'var(--danger)', fontSize: '16px', fontWeight: 600, margin: '0 0 16px' }}>⚠️ Could not load exams. Please check your internet connection.</p>
            <button onClick={fetchExams} style={{ background: 'var(--danger)', color: 'white', width: 'auto', padding: '10px 24px' }}>Retry</button>
          </div>
        ) : exams.length === 0 ? (
          <div style={{ background: 'var(--white)', padding: '52px 32px', borderRadius: 'var(--r-xl)', textAlign: 'center', boxShadow: 'var(--s-sm)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
            <p style={{ color: 'var(--text-2)', fontSize: '17px', fontWeight: 600, margin: 0 }}>No open exams at the moment.</p>
            <p style={{ color: 'var(--text-3)', fontSize: '14px', margin: '8px 0 0' }}>Please wait for your instructor to open an exam.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '16px' }}>
            {exams.map(exam => {
              const isAlreadyDone = completedExams.includes(exam.id);

              // Use server-side live session — works across devices, not just same browser
              const serverSession = activeSessions[exam.id];
              const isResumable = !isAlreadyDone && !!serverSession;
              const resumeSet = serverSession?.exam_set || 'A';
              const answeredCount = serverSession?.answers_count || 0;
              const minutesLeft = serverSession?.created_at
                ? Math.max(0, Math.floor((new Date(serverSession.created_at).getTime() + exam.duration_minutes * 60000 - Date.now()) / 60000))
                : null;

              // Scheduling. A seatwork keeps the full exam machinery — password
              // gate, tab tracking, violation logging — so the only difference
              // here is the label and the window.
              const state = availabilityState(exam);
              const notYetOpen = state === 'scheduled';
              const windowLabel = formatWindow(exam);
              const isSeatwork = exam.kind === 'seatwork';

              // Practice history for this paper, newest first.
              const myAttempts = attempts[exam.id] || [];
              const bestAttempt = myAttempts.reduce(
                (b, a) => (!b || a.score > b.score ? a : b), null);
              const lastAttempt = myAttempts[0] || null;

              return (
                <div key={exam.id} className="exam-card" style={{
                  background: 'var(--white)',
                  borderRadius: 'var(--r-lg)',
                  boxShadow: isResumable ? 'var(--s-md)' : 'var(--s-sm)',
                  border: `1px solid ${isResumable ? 'var(--gold)' : 'var(--border)'}`,
                  borderLeft: `5px solid ${isAlreadyDone ? 'var(--success)' : isResumable ? 'var(--gold)' : 'var(--navy)'}`,
                  padding: '22px 28px',
                  transition: 'box-shadow var(--t-fast)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ margin: '0 0 6px', color: 'var(--navy)', fontSize: '18px', fontWeight: 700 }}>{exam.title}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <span style={{
                        background: isSeatwork ? 'var(--navy-tint)' : 'var(--gold-pale)',
                        color: isSeatwork ? 'var(--navy)' : 'var(--gold-700)',
                        border: `1px solid ${isSeatwork ? 'var(--navy-100)' : 'var(--gold-100)'}`,
                        padding: '2px 10px', borderRadius: 'var(--r-full)',
                        fontSize: '11.5px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
                      }}>
                        {KIND_LABEL[exam.kind] || 'Exam'}
                      </span>
                      <span style={{ color: 'var(--text-3)', fontSize: '13.5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        ⏱ <strong style={{ color: 'var(--text-2)' }}>{exam.duration_minutes} min</strong> time limit
                      </span>
                      {windowLabel && (
                        <span style={{ color: 'var(--text-3)', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: 5 }}>
                          🗓 {windowLabel}
                        </span>
                      )}
                      {exam.allow_retakes && (
                        <span style={{ background: 'var(--ok-bg)', color: 'var(--ok)', border: '1px solid var(--ok-bd)', padding: '2px 10px', borderRadius: 'var(--r-full)', fontSize: 12, fontWeight: 600 }}>
                          Unlimited retakes
                        </span>
                      )}
                      {exam.has_password && !isAlreadyDone && !isResumable && (
                        <span style={{ background: 'var(--warning-bg)', color: 'var(--warning)', border: '1px solid var(--warning-bd)', padding: '2px 10px', borderRadius: 'var(--r-full)', fontSize: '12px', fontWeight: 600 }}>
                          🔒 Password required
                        </span>
                      )}
                      {isResumable && (
                        <span style={{ background: '#FFF8E1', color: '#A56B0A', border: '1px solid #F0CA80', padding: '2px 10px', borderRadius: 'var(--r-full)', fontSize: '12px', fontWeight: 600 }}>
                          Set {resumeSet} · {answeredCount} answered{minutesLeft !== null ? ` · ${minutesLeft}m left` : ''}
                        </span>
                      )}
                    </div>

                    {myAttempts.length > 0 && (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-lt, var(--border))' }}>
                        <div style={{ fontSize: 11, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-4)', fontWeight: 700, marginBottom: 6 }}>
                          Your attempts ({myAttempts.length})
                          {bestAttempt && bestAttempt.total_items > 0 && (
                            <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ok)', marginLeft: 8 }}>
                              best {bestAttempt.score}/{bestAttempt.total_items}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {/* Newest first, capped — a student with 30 retakes
                              should not get a wall of pills. */}
                          {myAttempts.slice(0, 6).map(a => {
                            const pct = a.total_items > 0 ? Math.round((a.score / a.total_items) * 100) : null;
                            const tone = pct === null ? 'var(--text-3)'
                              : pct >= 75 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)';
                            return (
                              <span key={a.attempt_no} title={new Date(a.submitted_at).toLocaleString()}
                                style={{ fontSize: 12, padding: '3px 9px', borderRadius: 'var(--r-full)', background: 'var(--surface-2)', border: '1px solid var(--line)', color: tone, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                                #{a.attempt_no} · {a.score}/{a.total_items}
                                {pct !== null && <span style={{ opacity: .7 }}> · {pct}%</span>}
                              </span>
                            );
                          })}
                          {myAttempts.length > 6 && (
                            <span style={{ fontSize: 12, color: 'var(--text-4)', alignSelf: 'center' }}>
                              +{myAttempts.length - 6} earlier
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="exam-card-actions">
                    {notYetOpen ? (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ background: 'var(--surface-2)', color: 'var(--text-3)', padding: '10px 20px', borderRadius: 'var(--r-full)', fontWeight: 700, display: 'inline-block', fontSize: '13px', border: '1px solid var(--border)' }}>
                          Opens {new Date(exam.opens_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </span>
                        <p style={{ fontSize: '11.5px', color: 'var(--text-4)', marginTop: 6, marginBottom: 0 }}>Not open yet.</p>
                      </div>
                    ) : isAlreadyDone ? (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ background: 'var(--success-bg)', color: 'var(--success)', padding: '10px 20px', borderRadius: 'var(--r-full)', fontWeight: 700, display: 'inline-block', fontSize: '13px', border: '1px solid var(--success-bd)' }}>
                          ✅ Submitted
                        </span>
                        <p style={{ fontSize: '11.5px', color: 'var(--text-4)', marginTop: '6px', marginBottom: 0 }}>Responses recorded.</p>
                      </div>
                    ) : isResumable ? (
                      <button disabled={isCheckingSession} onClick={() => handleStartClick(exam, resumeSet)}
                        style={{ width: 'auto', padding: '11px 26px', background: isCheckingSession ? 'var(--text-4)' : 'var(--gold)', color: 'var(--navy-dark)', fontSize: '14px', fontWeight: 700, borderRadius: 'var(--r-sm)', border: 'none' }}>
                        {isCheckingSession ? 'Checking…' : '↩ Resume Exam'}
                      </button>
                    ) : (
                      <div className="exam-card-btns">
                        <button disabled={isCheckingSession} onClick={() => handleStartClick(exam, 'A')}
                          data-retake={lastAttempt ? 'true' : undefined}
                          style={{ width: 'auto', padding: '11px 22px', background: isCheckingSession ? 'var(--text-4)' : 'var(--navy)', color: 'white', fontSize: '14px', fontWeight: 600, borderRadius: 'var(--r-sm)' }}>
                          {isCheckingSession ? 'Checking…' : 'Set A'}
                        </button>
                        <button disabled={isCheckingSession} onClick={() => handleStartClick(exam, 'B')}
                          style={{ width: 'auto', padding: '11px 22px', background: isCheckingSession ? 'var(--text-4)' : 'var(--navy-mid)', color: 'white', fontSize: '14px', fontWeight: 600, borderRadius: 'var(--r-sm)' }}>
                          {isCheckingSession ? 'Checking…' : 'Set B'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p style={{ textAlign: 'center', margin: '0 0 14px', fontSize: '10.5px', color: 'var(--text-4)', letterSpacing: '.14em', fontWeight: 700 }}>KMR</p>
    </div>
  );
}
