import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabase';

export default function ExamBoard({ student, exam, examSet }) {
  const storageKey = `exam_progress_${student?.id}_${exam?.id}`;
  const startingSeconds = exam?.duration_minutes ? (exam.duration_minutes * 60) : 14400;

  // --- 1. INITIAL STATE ---
  const [initialState] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) return JSON.parse(saved);
    const newProgress = { answers: {}, tabSwitchCount: 0, violationLogs: [], examStatus: 'active', endTime: Date.now() + (startingSeconds * 1000) };
    localStorage.setItem(storageKey, JSON.stringify(newProgress));
    return newProgress;
  });

  const [answers, setAnswers] = useState(initialState.answers);
  const [tabSwitchCount, setTabSwitchCount] = useState(initialState.tabSwitchCount);
  // Bug fix: restore violation logs from localStorage so they survive page refreshes
  const [violationLogs, setViolationLogs] = useState(initialState.violationLogs || []);
  const endTime = initialState.endTime; 
  const [timeLeft, setTimeLeft] = useState(startingSeconds);
  const [localTime, setLocalTime] = useState(new Date().toLocaleTimeString()); 
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [questions, setQuestions] = useState([]); 
  const [isLoading, setIsLoading] = useState(true); 
  const [scoreDisplay, setScoreDisplay] = useState(null); 

  // --- LIVE PROCTORING STATES ---
  // Restored from localStorage so a locked student sees the lock screen immediately on
  // page refresh — no bypass window while waiting for initLiveSession to complete.
  const [examStatus, setExamStatus] = useState(initialState.examStatus || 'active');
  const [liveSessionId, setLiveSessionId] = useState(null);

  // Refs for anti-cheat deduplication (prevent blur+visibilitychange double-counting)
  const pendingBlurRef = useRef(null);
  const alertActiveRef = useRef(false);
  // Tracks the count at mount so the lock only fires on NEW violations, not restored ones
  const prevViolationCountRef = useRef(initialState.tabSwitchCount);
  // Prevents double-submission when two rapid clicks hit before React re-renders
  const isSubmittingRef = useRef(false);
  // Debounce handle for live data pusher
  const livePushDebounceRef = useRef(null);

  // --- CLONE GUARD: Check for multiple logins (30s interval reduces DB load for 121 students) ---
  useEffect(() => {
    const checkSession = setInterval(async () => {
      const localToken = localStorage.getItem('local_session_token');
      if (!localToken || !student?.id) return;

      const { data } = await supabase.from('users').select('session_token').eq('id', student.id).single();

      if (data && data.session_token && data.session_token !== localToken) {
        clearInterval(checkSession);
        alert("⚠️ SECURITY ALERT: Your account was logged in from another device or tab. You have been disconnected.");
        window.location.reload();
      }
    }, 30000);

    return () => clearInterval(checkSession);
  }, [student?.id]);

  // SUBMISSION CONTROLS
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false); 

  // --- FIX 1: LIVE SESSION INITIALIZATION & LISTENER ---
  useEffect(() => {
    if (!student?.id || !exam?.id) return;
    let channel;

    const initLiveSession = async () => {
      // .limit(1) without .order() — safe even if live_sessions has no created_at column.
      // .order('created_at') was silently failing on some DB setups, returning null rows,
      // causing the INSERT branch to run and fail (duplicate), leaving liveSessionId null
      // and making the data + lock pushers no-ops for the entire exam session.
      const { data: rows } = await supabase.from('live_sessions')
        .select('*')
        .eq('student_id', student.id)
        .eq('exam_id', exam.id)
        .limit(1);
      let existing = rows?.[0] || null;

      let currentSessionId;

      if (existing) {
        currentSessionId = existing.id;

        if (existing.status === 'finished') {
          // Check if they already submitted — if so, block re-entry (lock bypass fix)
          const { data: existingResult } = await supabase.from('results')
            .select('student_id')
            .eq('student_id', student.id)
            .eq('exam_id', exam.id)
            .limit(1);

          if (existingResult?.length > 0) {
            setScoreDisplay({ score: 0, total: 0 });
            return; // liveSessionId intentionally stays null — exam is done
          }

          // No result — was dismissed by instructor, restore as active
          await supabase.from('live_sessions').update({
            status: 'active',
            answers_count: Object.keys(answers).length,
            violation_count: tabSwitchCount,
            updated_at: new Date()
          }).eq('id', existing.id);
          setExamStatus('active');
        } else {
          setExamStatus(existing.status);
        }
      } else {
        // No existing session — insert. If it fails (race/duplicate), re-fetch instead.
        const { data: newSession, error: insertError } = await supabase
          .from('live_sessions')
          .insert([{
            student_id: student.id,
            exam_id: exam.id,
            student_name: student.full_name,
            status: 'active',
            violation_count: tabSwitchCount,
            answers_count: Object.keys(answers).length
          }])
          .select()
          .single();

        if (insertError) {
          // Duplicate row — race condition. Re-fetch the real row.
          const { data: refetch } = await supabase.from('live_sessions')
            .select('*')
            .eq('student_id', student.id)
            .eq('exam_id', exam.id)
            .limit(1);
          if (refetch?.[0]) {
            existing = refetch[0];
            currentSessionId = existing.id;
            setExamStatus(existing.status === 'finished' ? 'active' : existing.status);
          }
        } else if (newSession) {
          currentSessionId = newSession.id;
        }
      }

      setLiveSessionId(currentSessionId);

      // Listen for instructor lock/unlock commands via postgres_changes.
      // Safe now because the data pusher no longer writes status — only the
      // auto-lock effect and the instructor's toggleStudentLock write to that field.
      if (currentSessionId) {
        channel = supabase.channel(`session-${currentSessionId}`)
          .on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'live_sessions',
            filter: `id=eq.${currentSessionId}`
          }, payload => {
            if (payload.new.status === 'locked') setExamStatus('locked');
            else if (payload.new.status === 'active') setExamStatus('active');
          })
          .subscribe();
      }
    };

    initLiveSession();

    return () => { if (channel) supabase.removeChannel(channel); };
  }, [student?.id, exam?.id]);

  // --- LIVE DATA PUSHER (debounced 5s — prevents ~6000 DB writes for 121 students) ---
  useEffect(() => {
    if (!liveSessionId) return;
    if (livePushDebounceRef.current) clearTimeout(livePushDebounceRef.current);
    livePushDebounceRef.current = setTimeout(() => {
      livePushDebounceRef.current = null;
      supabase.from('live_sessions').update({
        answers_count: Object.keys(answers).length,
        violation_count: tabSwitchCount,
        updated_at: new Date()
      }).eq('id', liveSessionId).then(({ error }) => {
        if (error) console.error('Live data push failed:', error.message);
      });
    }, 5000);
    return () => {
      if (livePushDebounceRef.current) clearTimeout(livePushDebounceRef.current);
    };
  }, [answers, tabSwitchCount, liveSessionId]);

  // --- LOCK STATUS PUSHER (only writes when student auto-locks, never overrides instructor) ---
  useEffect(() => {
    if (!liveSessionId || examStatus !== 'locked') return;
    supabase.from('live_sessions').update({
      status: 'locked', updated_at: new Date()
    }).eq('id', liveSessionId).then(({ error }) => {
      if (error) console.error('Lock status push failed:', error.message);
    });
  }, [examStatus, liveSessionId]);

  // --- AUTO-SAVER ---
  useEffect(() => {
    if (scoreDisplay || isSubmitting) return;
    const progressData = { answers, tabSwitchCount, violationLogs, examStatus, endTime };
    localStorage.setItem(storageKey, JSON.stringify(progressData));
  }, [answers, tabSwitchCount, violationLogs, examStatus, endTime, storageKey, scoreDisplay, isSubmitting]);

  // --- TIMER & CLOCK ---
  useEffect(() => {
    if (scoreDisplay || isSubmitting) return; 
    const timer = setInterval(() => {
      const now = Date.now();
      setLocalTime(new Date(now).toLocaleTimeString());
      const secondsRemaining = Math.max(0, Math.floor((endTime - now) / 1000));
      setTimeLeft(secondsRemaining);
    }, 1000);
    return () => clearInterval(timer);
  }, [scoreDisplay, endTime, isSubmitting]);

  // --- SAFE AUTO-SUBMIT TRIGGER ---
  useEffect(() => {
    if (timeLeft === 0 && !scoreDisplay && !isSubmitting && !isLoading) {
      executeSubmission();
    }
  }, [timeLeft, scoreDisplay, isSubmitting, isLoading]);

  // --- ANTI-CHEAT ---
  useEffect(() => {
    if (scoreDisplay || isSubmitting || examStatus === 'locked') return;

    const logViolation = (reason) => {
      const timeStr = new Date().toLocaleTimeString();
      setViolationLogs(prev => [...prev, `[${timeStr}] ${reason}`]);
      setTabSwitchCount(prev => prev + 1); // Lock logic is in its own useEffect below
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) return;
      // Cancel any pending blur log — visibilitychange is the authoritative tab-switch event
      if (pendingBlurRef.current) {
        clearTimeout(pendingBlurRef.current);
        pendingBlurRef.current = null;
      }
      logViolation("Tab hidden or switched to another app");
      alertActiveRef.current = true;
      alert("⚠️ SYSTEM WARNING: Tab switch detected.");
      alertActiveRef.current = false;
    };

    const handleBlur = () => {
      // Ignore blur caused by our own alert dialogs
      if (alertActiveRef.current) return;
      // Wait 250ms — if visibilitychange fires first it cancels this, preventing double-count
      if (pendingBlurRef.current) clearTimeout(pendingBlurRef.current);
      pendingBlurRef.current = setTimeout(() => {
        pendingBlurRef.current = null;
        // Only log if tab is still visible (genuine split-screen / notification focus loss)
        if (!document.hidden) {
          logViolation("Screen lost focus (Split-screen or notifications opened)");
        }
      }, 250);
    };

    const handleKeyDown = (e) => {
      const forbidden = e.key === 'PrintScreen'
        || ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 's'))
        || (e.metaKey && e.shiftKey);
      if (forbidden) {
        e.preventDefault();
        logViolation("Screenshot or Print shortcut attempted");
        alert("⚠️ SECURITY VIOLATION: Screenshot/Print disabled.");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("keydown", handleKeyDown);
      if (pendingBlurRef.current) {
        clearTimeout(pendingBlurRef.current);
        pendingBlurRef.current = null;
      }
    };
  }, [scoreDisplay, isSubmitting, examStatus]);

  // Dedicated lock trigger — only fires when count actually increases (not on page restore).
  // Locks at every 4th NEW violation: 4, 8, 12, ...
  // Instructor unlocks give students another 4-violation window before the next lock.
  useEffect(() => {
    if (
      tabSwitchCount > prevViolationCountRef.current &&
      tabSwitchCount % 4 === 0 &&
      !scoreDisplay &&
      !isSubmitting
    ) {
      setExamStatus('locked');
    }
    prevViolationCountRef.current = tabSwitchCount;
  }, [tabSwitchCount, scoreDisplay, isSubmitting]);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  useEffect(() => {
    async function loadQuestions() {
      if (!exam?.id) return;
      const { data, error } = await supabase.from('questions').select('*').eq('exam_id', exam.id).order('id', { ascending: true });

      if (error || !data || data.length === 0) {
        console.error("Error loading questions:", error);
        alert("⚠️ Could not load exam questions. Please refresh the page or contact your instructor.");
        setIsLoading(false);
        return;
      }

      if (data) {
        let seed = 0;
        if (student?.id) {
          for (let i = 0; i < student.id.length; i++) {
            seed = (seed * 31 + student.id.charCodeAt(i)) >>> 0;
          }
        } else {
          seed = 123;
        }
        const seededRandom = () => {
          let x = Math.sin(seed++) * 10000;
          return x - Math.floor(x);
        };

        let shuffled = [...data];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(seededRandom() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        shuffled = shuffled.map(q => {
          let letters = ['a', 'b', 'c', 'd'];
          for (let i = letters.length - 1; i > 0; i--) {
             const j = Math.floor(seededRandom() * (i + 1));
             [letters[i], letters[j]] = [letters[j], letters[i]];
          }
          return { ...q, shuffled_letters: letters };
        });
        
        setQuestions(shuffled);
      }
      setIsLoading(false);
    }
    loadQuestions();
  }, [exam?.id, student?.id]);

  const executeSubmission = useCallback(async () => {
    // Ref-based guard catches rapid double-clicks before React state re-renders
    if (isSubmittingRef.current || isSubmitting) return;
    isSubmittingRef.current = true;

    setIsSubmitting(true);
    setIsLoading(true);

    try {
      const { data: answerKey } = await supabase.from('questions').select('id, correct_answer').eq('exam_id', exam.id);
      let correctCount = 0;
      const formattedAnswers = {};

      Object.keys(answers).forEach(qId => {
        const questionData = answerKey.find(item => String(item.id) === String(qId));
        if (questionData) {
          const correctValue = Number(questionData.correct_answer);
          const studentValue = Number(answers[qId]);
          const isCorrect = studentValue === correctValue;
          if (isCorrect) correctCount++;
          formattedAnswers[qId] = { chosen: studentValue, is_correct: isCorrect };
        }
      });

      const { error: saveError } = await supabase.from('results').insert([{
        student_id: student?.id,
        exam_id: exam.id,
        answers_json: formattedAnswers,
        score: correctCount,
        total_items: questions.length,
        time_taken_seconds: startingSeconds - timeLeft,
        tab_switches: tabSwitchCount,
        violation_logs: violationLogs
      }]);

      // 23505 = duplicate key (already submitted) — treat as success, not a hard error
      if (saveError && saveError.code !== '23505') throw saveError;

      // Always mark the live session as finished, even on duplicate submissions
      if (liveSessionId) {
        await supabase.from('live_sessions').update({ status: 'finished' }).eq('id', liveSessionId);
      } else {
        // Fallback: liveSessionId not yet set (e.g. very fast auto-submit), find by student + exam
        await supabase.from('live_sessions').update({ status: 'finished' })
          .eq('student_id', student?.id).eq('exam_id', exam.id);
      }

      localStorage.removeItem(storageKey);
      setScoreDisplay({ score: saveError?.code === '23505' ? 0 : correctCount, total: questions.length });

    } catch (err) {
      alert("There was an error saving your exam. Please contact your instructor.");
    } finally {
      isSubmittingRef.current = false;
      setIsLoading(false);
      setIsSubmitting(false);
      setShowSubmitModal(false);
    }
  }, [answers, questions, tabSwitchCount, violationLogs, timeLeft, startingSeconds, liveSessionId, student, exam, isSubmitting]);

  if (isLoading && !isSubmitting) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center', color: 'var(--text-3)' }}>
        <div style={{ fontSize: '36px', marginBottom: '12px' }}>⏳</div>
        <p style={{ margin: 0, fontWeight: 600 }}>Loading Exam…</p>
      </div>
    </div>
  );

  if (scoreDisplay) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
        <header className="header" style={{ borderRadius: 0, marginBottom: 0, padding: '14px 28px' }}>
          <img src="/patts-logo.png" alt="PATTS College of Aeronautics" style={{ height: '38px', width: 'auto', objectFit: 'contain' }} />
        </header>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--r-xl)', boxShadow: 'var(--s-xl)', overflow: 'hidden', maxWidth: '480px', width: '100%', border: '1px solid var(--border)' }}>
            <div style={{ background: 'linear-gradient(135deg, var(--success) 0%, #2E9E5A 100%)', padding: '40px 36px', textAlign: 'center' }}>
              <div style={{ fontSize: '52px', marginBottom: '12px' }}>✅</div>
              <h2 style={{ margin: 0, color: 'white', fontSize: '22px', fontWeight: 800 }}>Exam Complete!</h2>
              <p style={{ margin: '8px 0 0', color: 'rgba(255,255,255,.8)', fontSize: '14px' }}>Your answers have been saved successfully.</p>
            </div>
            <div style={{ padding: '32px 36px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 24px', color: 'var(--text-3)', fontSize: '14px' }}>You may now close this window or log out.</p>
              <button onClick={() => window.location.reload()} style={{ background: 'var(--navy)', padding: '13px', fontSize: '15px' }}>
                Log Out
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (examStatus === 'locked') {
    return (
      <div className="prevent-select" style={{ background: '#000', color: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '24px' }}>
        <div style={{ maxWidth: '680px', width: '100%' }}>
          <div style={{ border: '4px solid #E74C3C', borderRadius: '16px', padding: '32px 24px', marginBottom: '24px', background: 'rgba(231,76,60,.08)' }}>
            <div style={{ fontSize: '56px', marginBottom: '12px' }}>🚨</div>
            <h1 style={{ fontSize: '32px', color: '#E74C3C', margin: '0 0 8px', fontWeight: 800, letterSpacing: '-.01em' }}>EXAM SUSPENDED</h1>
            <p style={{ fontSize: '16px', color: 'rgba(255,255,255,.85)', margin: 0 }}>Your exam has been paused by the system.</p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
            <span style={{ background: 'rgba(231,76,60,.15)', border: '1px solid rgba(231,76,60,.4)', color: '#E74C3C', padding: '8px 20px', borderRadius: '9999px', fontSize: '15px', fontWeight: 700 }}>
              ⚠️ {tabSwitchCount} Violation{tabSwitchCount !== 1 ? 's' : ''} Recorded
            </span>
          </div>
          <div style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(231,76,60,.3)', borderRadius: '12px', padding: '24px 28px' }}>
            <p style={{ fontSize: '15px', color: 'rgba(255,255,255,.75)', margin: 0, lineHeight: '1.7' }}>
              This system has recorded multiple attempts to bypass security protocols. You are now locked out of the exam.
              <br /><br />
              In accordance with the <strong style={{ color: 'white' }}>Student Handbook</strong>, academic dishonesty will be sanctioned accordingly.
              Your instructor has been notified. Please <strong style={{ color: 'white' }}>raise your hand</strong> and wait for further instructions.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentQuestion - 1] || {};

  return (
    <div className="prevent-select" style={{ minHeight: '100vh', background: 'var(--bg)' }} onContextMenu={e => e.preventDefault()}>

      {showSubmitModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--r-xl)', maxWidth: '440px', width: '100%', overflow: 'hidden', boxShadow: 'var(--s-xl)' }}>
            <div style={{ background: 'linear-gradient(110deg, var(--navy-dark), var(--navy))', padding: '24px 28px', borderBottom: '3px solid var(--gold)' }}>
              <h2 style={{ margin: 0, color: 'white', fontSize: '18px', fontWeight: 700 }}>Final Submission</h2>
              <p style={{ margin: '5px 0 0', color: 'rgba(255,255,255,.7)', fontSize: '13px' }}>
                {Object.keys(answers).length} of {questions.length} questions answered
              </p>
            </div>
            <div style={{ padding: '28px' }}>
              {Object.keys(answers).length < questions.length && (
                <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-bd)', borderRadius: 'var(--r-sm)', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: 'var(--warning)', fontWeight: 500 }}>
                  ⚠️ {questions.length - Object.keys(answers).length} question{questions.length - Object.keys(answers).length !== 1 ? 's' : ''} left unanswered.
                </div>
              )}
              <p style={{ margin: '0 0 14px', color: 'var(--text-3)', fontSize: '14px', textAlign: 'center' }}>
                Type <strong style={{ color: 'var(--navy)' }}>submit now</strong> to confirm:
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="type here…"
                style={{ textAlign: 'center', fontSize: '16px', borderColor: confirmText.toLowerCase() === 'submit now' ? 'var(--success)' : 'var(--border)' }}
              />
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1.5px solid var(--border)', flex: 1 }}
                  onClick={() => { setShowSubmitModal(false); setConfirmText(''); }}>
                  Cancel
                </button>
                <button
                  style={{ background: confirmText.toLowerCase() === 'submit now' ? 'var(--success)' : 'var(--text-4)', flex: 1 }}
                  disabled={confirmText.toLowerCase() !== 'submit now' || isSubmitting}
                  onClick={executeSubmission}
                >
                  {isSubmitting ? 'Saving…' : 'Submit Exam'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <header className="header" style={{ borderRadius: 0, marginBottom: 0, padding: '12px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <img src="/patts-logo.png" alt="PATTS" style={{ height: '36px', width: 'auto', objectFit: 'contain' }} />
          <p className="exam-student-name" style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,.75)' }}>{student?.full_name} &nbsp;·&nbsp; Set {examSet}</p>
        </div>
        <div className="exam-header-right" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="exam-header-meta" style={{ fontSize: '11px', textAlign: 'right', color: 'rgba(255,255,255,.65)', lineHeight: '1.5' }}>
            Local Time<br /><strong style={{ color: 'white', fontSize: '13px' }}>{localTime}</strong>
          </div>
          <div style={{
            background: tabSwitchCount > 0 ? 'rgba(231,76,60,.25)' : 'rgba(255,255,255,.12)',
            border: `1px solid ${tabSwitchCount > 0 ? 'rgba(231,76,60,.5)' : 'rgba(255,255,255,.2)'}`,
            color: tabSwitchCount > 0 ? '#FF8F85' : 'rgba(255,255,255,.8)',
            padding: '5px 14px', borderRadius: 'var(--r-full)', fontWeight: 700, fontSize: '13px',
          }}>
            ⚠️ {tabSwitchCount}
          </div>
          <div className="exam-timer" style={{
            fontSize: '22px', fontWeight: 800, letterSpacing: '-.01em',
            color: timeLeft <= 300 ? '#FF8F85' : 'white',
            background: timeLeft <= 300 ? 'rgba(231,76,60,.2)' : 'rgba(255,255,255,.1)',
            padding: '6px 16px', borderRadius: 'var(--r-sm)',
            border: timeLeft <= 300 ? '1px solid rgba(231,76,60,.4)' : '1px solid rgba(255,255,255,.15)',
          }}>
            {formatTime(timeLeft)}
          </div>
        </div>
      </header>

      <div className="exam-layout" style={{ padding: '20px 24px' }}>
        <main className="main-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
            <span style={{ background: 'var(--navy)', color: 'white', borderRadius: 'var(--r-sm)', padding: '4px 12px', fontSize: '13px', fontWeight: 700 }}>
              Question {currentQuestion}
            </span>
            <span style={{ color: 'var(--text-4)', fontSize: '13px' }}>of {questions.length}</span>
          </div>
          <p style={{ fontSize: '17px', lineHeight: '1.65', color: 'var(--text-1)', minHeight: '72px', margin: '0 0 20px' }}>{currentQ?.question_text}</p>
          <div className="choices">
            {(currentQ?.shuffled_letters || ['a','b','c','d']).map((letter) => {
              const originalIndex = ['a', 'b', 'c', 'd'].indexOf(letter);
              return (
                <button
                  key={letter}
                  className={`choice-btn ${answers[currentQ?.id] === originalIndex ? 'selected' : ''}`}
                  onClick={() => setAnswers({...answers, [currentQ.id]: originalIndex})}
                >
                  {currentQ[`choice_${letter}`]}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '28px', gap: '12px' }}>
            <button style={{ width: 'auto', flex: 1, background: 'var(--surface-2)', color: 'var(--text-2)', border: '1.5px solid var(--border)' }}
              onClick={() => setCurrentQuestion(q => Math.max(1, q-1))} disabled={currentQuestion === 1}>
              ← Previous
            </button>
            <button style={{ width: 'auto', flex: 1 }}
              onClick={() => setCurrentQuestion(q => Math.min(questions.length, q+1))} disabled={currentQuestion === questions.length}>
              Next →
            </button>
          </div>
        </main>

        <aside className="side-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--navy)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Navigator</h3>
            <span style={{ fontSize: '12px', color: 'var(--text-4)' }}>
              {Object.keys(answers).length}/{questions.length}
            </span>
          </div>
          <div className="grid-container">
            {questions.map((q, i) => (
              <div key={q.id} onClick={() => setCurrentQuestion(i+1)} className={`grid-item ${currentQuestion === i+1 ? 'active' : ''} ${answers[q.id] !== undefined ? 'answered' : ''}`}>
                {i+1}
              </div>
            ))}
          </div>
          <div style={{ marginTop: '16px', padding: '12px', background: 'var(--navy-tint)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-3)', marginBottom: '6px' }}>
              <span>Answered</span>
              <span style={{ fontWeight: 700, color: Object.keys(answers).length === questions.length ? 'var(--success)' : 'var(--navy)' }}>
                {Object.keys(answers).length} / {questions.length}
              </span>
            </div>
            <div style={{ background: 'var(--border)', borderRadius: 'var(--r-full)', height: '5px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 'var(--r-full)',
                background: Object.keys(answers).length === questions.length ? 'var(--success)' : 'var(--gold)',
                width: `${questions.length > 0 ? (Object.keys(answers).length / questions.length) * 100 : 0}%`,
                transition: 'width var(--t)',
              }} />
            </div>
          </div>
          <button
            style={{ marginTop: '14px', background: 'linear-gradient(135deg, var(--success), #25A55A)', boxShadow: 'var(--s-sm)' }}
            onClick={() => setShowSubmitModal(true)}
          >
            Submit Final Exam
          </button>
        </aside>
      </div>
    </div>
  );
}