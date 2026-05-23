import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabase';
import Icon from './components/Icon';

export default function ExamBoard({ student, exam, examSet }) {
  const storageKey = `exam_progress_${student?.id}_${exam?.id}`;
  const startingSeconds = exam?.duration_minutes ? (exam.duration_minutes * 60) : 14400;

  // --- 1. INITIAL STATE ---
  const [initialState] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      localStorage.removeItem(storageKey);
    }
    const newProgress = { answers: {}, essayAnswers: {}, tabSwitchCount: 0, violationLogs: [], examStatus: 'active', endTime: Date.now() + (startingSeconds * 1000) };
    localStorage.setItem(storageKey, JSON.stringify(newProgress));
    return newProgress;
  });

  const [answers, setAnswers] = useState(initialState.answers);
  const [essayAnswers, setEssayAnswers] = useState(initialState.essayAnswers || {});
  const [flaggedQuestions, setFlaggedQuestions] = useState(initialState.flaggedQuestions || {});
  const [tabSwitchCount, setTabSwitchCount] = useState(initialState.tabSwitchCount);
  // Bug fix: restore violation logs from localStorage so they survive page refreshes
  const [violationLogs, setViolationLogs] = useState(initialState.violationLogs || []);
  const endTimeRef = useRef(initialState.endTime); // mutable so initLiveSession can clamp it
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
  // Snapshot of answers captured when submit modal opens — prevents last-second tampering
  const answersSnapshotRef = useRef(null);
  const essaySnapshotRef = useRef(null);
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
      const hasLocalAnswers =
        Object.keys(initialState.answers || {}).length > 0 ||
        Object.keys(initialState.essayAnswers || {}).length > 0;

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
          // Server violation count is authoritative — prevents localStorage manipulation
          const serverViolations = existing.violation_count || 0;
          const effectiveViolations = Math.max(tabSwitchCount, serverViolations);
          if (serverViolations > tabSwitchCount) setTabSwitchCount(serverViolations);
          // Clamp endTime to server-authoritative max — prevents localStorage inflation
          if (existing.created_at) {
            const serverMax = new Date(existing.created_at).getTime() + (exam.duration_minutes * 60 * 1000) + 30000;
            if (endTimeRef.current > serverMax) endTimeRef.current = serverMax;
          }
          await supabase.from('live_sessions').update({
            answers_count: Object.keys(answers).length,
            violation_count: effectiveViolations,
            updated_at: new Date()
          }).eq('id', existing.id);
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

      // New device: no local answers — restore from server so progress isn't lost
      if (existing && !hasLocalAnswers) {
        if (existing.answers_json && Object.keys(existing.answers_json).length > 0) {
          setAnswers(existing.answers_json);
        }
        if (existing.essay_answers_json && Object.keys(existing.essay_answers_json).length > 0) {
          setEssayAnswers(existing.essay_answers_json);
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
        violation_log: violationLogs,
        answers_json: answers,
        essay_answers_json: essayAnswers,
        exam_set: examSet,
        updated_at: new Date()
      }).eq('id', liveSessionId).then(({ error }) => {
        if (error) console.error('Live data push failed:', error.message);
      });
    }, 5000);
    return () => {
      if (livePushDebounceRef.current) clearTimeout(livePushDebounceRef.current);
    };
  }, [answers, tabSwitchCount, violationLogs, liveSessionId]);

  // --- LOCK STATUS PUSHER (only writes when student auto-locks, never overrides instructor) ---
  useEffect(() => {
    if (!liveSessionId || examStatus !== 'locked') return;
    supabase.from('live_sessions').update({
      status: 'locked', updated_at: new Date()
    }).eq('id', liveSessionId).then(({ error }) => {
      if (error) console.error('Lock status push failed:', error.message);
    });
  }, [examStatus, liveSessionId]);

  const toggleFlag = (questionId) => {
    setFlaggedQuestions(prev => {
      const next = { ...prev };
      if (next[questionId]) delete next[questionId];
      else next[questionId] = true;
      return next;
    });
  };

  // --- AUTO-SAVER ---
  useEffect(() => {
    if (scoreDisplay || isSubmitting) return;
    const progressData = { answers, essayAnswers, flaggedQuestions, tabSwitchCount, violationLogs, examStatus, endTime: endTimeRef.current, examSet };
    localStorage.setItem(storageKey, JSON.stringify(progressData));
  }, [answers, essayAnswers, flaggedQuestions, tabSwitchCount, violationLogs, examStatus, storageKey, scoreDisplay, isSubmitting]);

  // --- TIMER & CLOCK ---
  useEffect(() => {
    if (scoreDisplay || isSubmitting) return; 
    const timer = setInterval(() => {
      const now = Date.now();
      setLocalTime(new Date(now).toLocaleTimeString());
      const secondsRemaining = Math.max(0, Math.floor((endTimeRef.current - now) / 1000));
      setTimeLeft(secondsRemaining);
    }, 1000);
    return () => clearInterval(timer);
  }, [scoreDisplay, isSubmitting]);

  // --- SUBMIT HANDLER (declared before the auto-submit effect that depends on it) ---
  const executeSubmission = useCallback(async () => {
    if (isSubmittingRef.current || isSubmitting) return;
    isSubmittingRef.current = true;

    setIsSubmitting(true);
    setIsLoading(true);

    try {
      // Use snapshot captured at modal-open time; fall back to live state for auto-submit
      const submittedAnswers = answersSnapshotRef.current ?? answers;
      const submittedEssayAnswers = essaySnapshotRef.current ?? essayAnswers;
      const { data: answerKey } = await supabase.from('questions').select('id, correct_answer, question_type').eq('exam_id', exam.id);
      let correctCount = 0;
      let mcTotal = 0;
      const formattedAnswers = {};

      (answerKey || []).forEach(questionData => {
        const qId = String(questionData.id);
        if ((questionData.question_type || 'multiple_choice') === 'essay') {
          const essayText = submittedEssayAnswers[qId];
          if (essayText?.trim()) {
            formattedAnswers[qId] = { type: 'essay', text: essayText.trim() };
          }
        } else {
          mcTotal++;
          if (submittedAnswers[qId] !== undefined) {
            const correctValue = Number(questionData.correct_answer);
            const studentValue = Number(submittedAnswers[qId]);
            const isCorrect = studentValue === correctValue;
            if (isCorrect) correctCount++;
            formattedAnswers[qId] = { chosen: studentValue, is_correct: isCorrect };
          }
        }
      });

      const { error: saveError } = await supabase.from('results').insert([{
        student_id: student?.id,
        exam_id: exam.id,
        answers_json: formattedAnswers,
        score: correctCount,
        total_items: mcTotal,
        time_taken_seconds: startingSeconds - timeLeft,
        tab_switches: tabSwitchCount,
        violation_logs: violationLogs
      }]);

      if (saveError && saveError.code !== '23505') throw saveError;

      if (liveSessionId) {
        await supabase.from('live_sessions').update({ status: 'finished' }).eq('id', liveSessionId);
      } else {
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
  }, [answers, essayAnswers, questions, tabSwitchCount, violationLogs, timeLeft, startingSeconds, liveSessionId, student, exam, isSubmitting]);
  // answersSnapshotRef / essaySnapshotRef intentionally excluded — refs are stable

  // --- SAFE AUTO-SUBMIT TRIGGER ---
  useEffect(() => {
    if (timeLeft === 0 && !scoreDisplay && !isSubmitting && !isLoading) {
      executeSubmission();
    }
  }, [timeLeft, scoreDisplay, isSubmitting, isLoading, executeSubmission]);

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

  if (isLoading && !isSubmitting) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper)' }}>
      <div style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
        <Icon name="clipboard" size={38} color="var(--navy)" style={{ opacity: 0.22, marginBottom: 14 }} />
        <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: 'var(--ink-2)' }}>Loading Exam…</p>
      </div>
    </div>
  );

  if (scoreDisplay) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>

        {/* Hero band */}
        <div className="patts-header" style={{ padding: '36px 24px 80px', textAlign: 'center', position: 'relative' }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <img src="/patts-logo.png" alt="PATTS College of Aeronautics" style={{ height: 52, objectFit: 'contain' }} />
            <div className="eyebrow" style={{ color: 'var(--gold-bright)', marginTop: 14, fontSize: 11 }}>
              Online Examination Portal
            </div>
            <h1 className="display" style={{ color: 'white', marginTop: 8, fontSize: 24 }}>Exam Complete</h1>
          </div>
        </div>

        {/* Result card */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '0 20px 40px', marginTop: -56, position: 'relative', zIndex: 1 }}>
          <div className="card" style={{ width: '100%', maxWidth: 440, padding: 0, overflow: 'hidden', boxShadow: 'var(--s-lg)' }}>
            <div style={{ background: 'linear-gradient(135deg, #27AE60 0%, #1E8449 100%)', padding: '36px 32px', textAlign: 'center' }}>
              <Icon name="check-circle" size={48} color="white" style={{ marginBottom: 14, opacity: .92 }} />
              <h2 style={{ margin: 0, color: 'white', fontSize: 20, fontWeight: 800 }}>Your answers have been saved.</h2>
              <p style={{ margin: '8px 0 0', color: 'rgba(255,255,255,.78)', fontSize: 13.5 }}>
                {student?.full_name} · Set {examSet}
              </p>
            </div>
            <div style={{ padding: '28px 32px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 22px', color: 'var(--ink-3)', fontSize: 13.5, lineHeight: 1.65 }}>
                Your submission is recorded. You may now close this window or return to the login screen.
              </p>
              <button onClick={() => window.location.reload()} className="btn lg" style={{ width: '100%' }}>
                <Icon name="login" size={16} />
                Return to Login
              </button>
            </div>
          </div>
        </div>

        <p style={{ textAlign: 'center', margin: '20px 0 14px', fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.18em', fontWeight: 700 }}>
          KMR · PATTS COLLEGE OF AERONAUTICS
        </p>
      </div>
    );
  }

  if (examStatus === 'locked') {
    return (
      <div className="prevent-select" style={{ background: 'var(--navy-900)', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '24px' }}>
        <div style={{ maxWidth: 620, width: '100%' }}>
          <div style={{ border: '2px solid rgba(231,76,60,.45)', borderRadius: 'var(--r-lg)', padding: '36px 28px', marginBottom: 24, background: 'rgba(231,76,60,.07)' }}>
            <Icon name="alert" size={48} color="#E74C3C" style={{ marginBottom: 16 }} />
            <h1 style={{ fontSize: 28, color: '#E74C3C', margin: '0 0 10px', fontWeight: 800, letterSpacing: '-.01em' }}>EXAM SUSPENDED</h1>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,.72)', margin: 0 }}>Your exam has been paused by the system.</p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(231,76,60,.14)', border: '1px solid rgba(231,76,60,.38)', color: '#E74C3C', padding: '8px 20px', borderRadius: 9999, fontSize: 14, fontWeight: 700 }}>
              <Icon name="flag" size={14} color="#E74C3C" />
              {tabSwitchCount} Violation{tabSwitchCount !== 1 ? 's' : ''} Recorded
            </span>
          </div>
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 'var(--r-md)', padding: '24px 28px' }}>
            <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,.68)', margin: 0, lineHeight: 1.78 }}>
              This system has recorded multiple attempts to bypass security protocols. You are now locked out of the exam.
              <br /><br />
              In accordance with the <strong style={{ color: 'white' }}>Student Handbook</strong>, academic dishonesty will be sanctioned accordingly.
              Your instructor has been notified. Please <strong style={{ color: 'white' }}>raise your hand</strong> and wait for further instructions.
            </p>
          </div>
        </div>
        <p style={{ margin: '28px 0 0', fontSize: 10, color: 'rgba(255,255,255,.14)', letterSpacing: '.18em', fontWeight: 700 }}>
          KMR · PATTS COLLEGE OF AERONAUTICS
        </p>
      </div>
    );
  }

  const currentQ = questions[currentQuestion - 1] || {};

  return (
    <div className="prevent-select" style={{ minHeight: '100vh', background: 'var(--paper)' }} onContextMenu={e => e.preventDefault()}>

      {/* ── Submit confirmation modal ── */}
      {showSubmitModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <div className="card" style={{ maxWidth: 440, width: '100%', padding: 0, overflow: 'hidden', boxShadow: 'var(--s-xl)' }}>
            <div style={{ background: 'linear-gradient(110deg, var(--navy-dark), var(--navy))', padding: '22px 28px', borderBottom: '3px solid var(--gold)' }}>
              <h2 style={{ margin: 0, color: 'white', fontSize: 17, fontWeight: 700 }}>Final Submission</h2>
              <p style={{ margin: '5px 0 0', color: 'rgba(255,255,255,.62)', fontSize: 13 }}>
                {Object.keys(answers).length + Object.values(essayAnswers).filter(t => t?.trim().length > 0).length} of {questions.length} questions answered
              </p>
            </div>
            <div style={{ padding: '24px 28px' }}>
              {(() => {
                const totalAnswered = Object.keys(answers).length + Object.values(essayAnswers).filter(t => t?.trim().length > 0).length;
                const unanswered = questions.length - totalAnswered;
                return unanswered > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', borderRadius: 'var(--r-sm)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--warn)', fontWeight: 500 }}>
                    <Icon name="alert" size={15} />
                    {unanswered} question{unanswered !== 1 ? 's' : ''} left unanswered.
                  </div>
                ) : null;
              })()}
              <p style={{ margin: '0 0 14px', color: 'var(--ink-3)', fontSize: 13.5, textAlign: 'center' }}>
                Type <strong style={{ color: 'var(--navy)' }}>submit now</strong> to confirm:
              </p>
              <input
                className="input"
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="type here…"
                style={{ textAlign: 'center', fontSize: 16, borderColor: confirmText.toLowerCase() === 'submit now' ? 'var(--ok)' : undefined }}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button className="btn ghost" style={{ flex: 1 }}
                  onClick={() => { setShowSubmitModal(false); setConfirmText(''); }}>
                  Cancel
                </button>
                <button
                  className="btn"
                  style={{ flex: 1, background: confirmText.toLowerCase() === 'submit now' ? 'var(--ok)' : 'var(--ink-4)', border: 'none' }}
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

      {/* ── Sticky exam header ── */}
      <header className="patts-header" style={{ padding: '11px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative', zIndex: 1 }}>
          <img src="/patts-logo.png" alt="PATTS" style={{ height: 34, objectFit: 'contain', flexShrink: 0 }} />
          <p className="exam-student-name" style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,.68)', fontWeight: 500 }}>
            {student?.full_name} &nbsp;·&nbsp; Set {examSet}
          </p>
        </div>
        <div className="exam-header-right" style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1 }}>
          <div className="exam-header-meta" style={{ fontSize: 11, textAlign: 'right', color: 'rgba(255,255,255,.52)', lineHeight: 1.5 }}>
            Local Time<br /><strong style={{ color: 'white', fontSize: 13 }}>{localTime}</strong>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: tabSwitchCount > 0 ? 'rgba(231,76,60,.25)' : 'rgba(255,255,255,.1)',
            border: `1px solid ${tabSwitchCount > 0 ? 'rgba(231,76,60,.5)' : 'rgba(255,255,255,.15)'}`,
            color: tabSwitchCount > 0 ? '#FF8F85' : 'rgba(255,255,255,.75)',
            padding: '5px 12px', borderRadius: 'var(--r-full)', fontWeight: 700, fontSize: 13,
          }}>
            <Icon name="flag" size={13} />
            {tabSwitchCount}
          </div>
          <div className="exam-timer" style={{
            fontSize: 22, fontWeight: 800, letterSpacing: '-.02em',
            color: timeLeft <= 300 ? '#FF8F85' : 'white',
            background: timeLeft <= 300 ? 'rgba(231,76,60,.22)' : 'rgba(255,255,255,.1)',
            padding: '6px 16px', borderRadius: 'var(--r-sm)',
            border: timeLeft <= 300 ? '1px solid rgba(231,76,60,.4)' : '1px solid rgba(255,255,255,.14)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {formatTime(timeLeft)}
          </div>
        </div>
      </header>

      {/* ── Exam body ── */}
      <div className="exam-layout" style={{ padding: '20px 24px 8px' }}>

        {/* Main question panel */}
        <main className="main-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <span style={{ background: 'var(--navy)', color: 'white', borderRadius: 'var(--r-sm)', padding: '4px 12px', fontSize: 12.5, fontWeight: 700, letterSpacing: '.02em', flexShrink: 0 }}>
              Q {currentQuestion}
            </span>
            <span style={{ color: 'var(--ink-4)', fontSize: 13, flexShrink: 0 }}>of {questions.length}</span>
            {currentQ?.question_type === 'essay' && (
              <span style={{ background: '#EBF4FF', color: '#1565C0', padding: '3px 10px', borderRadius: 'var(--r-full)', fontSize: 11.5, fontWeight: 700, flexShrink: 0 }}>
                Essay
              </span>
            )}
            {flaggedQuestions[currentQ?.id] && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#FFF6E5', border: '1px solid #F0CA80', color: '#A56B0A', padding: '3px 9px', borderRadius: 'var(--r-full)', fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>
                <Icon name="flag" size={11} color="#E67E22" />
                Flagged
              </span>
            )}
            <button
              onClick={() => toggleFlag(currentQ?.id)}
              title={flaggedQuestions[currentQ?.id] ? 'Remove flag' : 'Flag for review'}
              style={{
                marginLeft: 'auto', flexShrink: 0,
                width: 30, height: 30,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: flaggedQuestions[currentQ?.id] ? '#FFF6E5' : 'transparent',
                border: `1.5px solid ${flaggedQuestions[currentQ?.id] ? '#F0CA80' : 'var(--line)'}`,
                color: flaggedQuestions[currentQ?.id] ? '#E67E22' : 'var(--ink-4)',
                borderRadius: 'var(--r-sm)', cursor: 'pointer', transition: 'all var(--t-1)',
              }}
            >
              <Icon name="flag" size={14} />
            </button>
          </div>

          <p style={{ fontSize: 17, lineHeight: 1.68, color: 'var(--ink-1)', minHeight: 72, margin: '0 0 22px' }}>
            {currentQ?.question_text}
          </p>

          {currentQ?.question_type === 'essay' ? (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--ink-3)' }}>Type your answer in the box below.</p>
              <textarea
                value={essayAnswers[currentQ.id] || ''}
                onChange={e => setEssayAnswers(prev => ({ ...prev, [currentQ.id]: e.target.value }))}
                placeholder="Write your answer here…"
                rows={8}
                maxLength={8000}
                style={{
                  width: '100%', padding: '14px 16px', border: '2px solid', boxSizing: 'border-box',
                  borderColor: essayAnswers[currentQ.id]?.trim() ? 'var(--navy)' : 'var(--line)',
                  borderRadius: 'var(--r-md)', fontSize: 15, lineHeight: 1.6,
                  resize: 'vertical', fontFamily: 'inherit', color: 'var(--ink-1)',
                  background: 'var(--white)', transition: 'border-color var(--t-fast)',
                  outline: 'none',
                }}
              />
              <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                {(essayAnswers[currentQ.id] || '').length} / 8,000
              </div>
            </div>
          ) : (
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
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28, gap: 12 }}>
            <button
              className="btn ghost" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onClick={() => setCurrentQuestion(q => Math.max(1, q - 1))}
              disabled={currentQuestion === 1}
            >
              <Icon name="arrow-left" size={15} /> Previous
            </button>
            <button
              className="btn" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onClick={() => setCurrentQuestion(q => Math.min(questions.length, q + 1))}
              disabled={currentQuestion === questions.length}
            >
              Next <Icon name="arrow-right" size={15} />
            </button>
          </div>
        </main>

        {/* Side panel — navigator + submit */}
        <aside className="side-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div className="eyebrow" style={{ fontSize: 10 }}>Navigator</div>
            <span style={{ fontSize: 12, color: 'var(--ink-4)', fontWeight: 600 }}>
              {Object.keys(answers).length + Object.values(essayAnswers).filter(t => t?.trim().length > 0).length}/{questions.length}
            </span>
          </div>

          <div className="grid-container">
            {questions.map((q, i) => {
              const isAnswered = q.question_type === 'essay'
                ? (essayAnswers[q.id]?.trim().length > 0)
                : (answers[q.id] !== undefined);
              const isFlagged = !!flaggedQuestions[q.id];
              return (
                <div
                  key={q.id}
                  onClick={() => setCurrentQuestion(i + 1)}
                  className={`grid-item ${currentQuestion === i + 1 ? 'active' : ''} ${isAnswered ? 'answered' : ''}`}
                  style={{ position: 'relative' }}
                >
                  {i + 1}
                  {isFlagged && (
                    <span style={{
                      position: 'absolute', top: 2, right: 2,
                      width: 5, height: 5, borderRadius: '50%',
                      background: currentQuestion === i + 1 ? 'var(--navy)' : '#E67E22',
                      display: 'block', flexShrink: 0,
                    }} />
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 16, padding: 12, background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }}>
            {(() => {
              const totalAnswered = Object.keys(answers).length + Object.values(essayAnswers).filter(t => t?.trim().length > 0).length;
              const flaggedCount = Object.keys(flaggedQuestions).length;
              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>
                    <span>Answered</span>
                    <span style={{ fontWeight: 700, color: totalAnswered === questions.length ? 'var(--ok)' : 'var(--navy)' }}>
                      {totalAnswered} / {questions.length}
                    </span>
                  </div>
                  <div style={{ background: 'var(--line)', borderRadius: 'var(--r-full)', height: 5, overflow: 'hidden', marginBottom: flaggedCount > 0 ? 10 : 0 }}>
                    <div style={{
                      height: '100%', borderRadius: 'var(--r-full)',
                      background: totalAnswered === questions.length ? 'var(--ok)' : 'var(--gold)',
                      width: `${questions.length > 0 ? (totalAnswered / questions.length) * 100 : 0}%`,
                      transition: 'width var(--t)',
                    }} />
                  </div>
                  {flaggedCount > 0 && (() => {
                    const flaggedIndices = questions
                      .map((q, i) => ({ i, id: q.id }))
                      .filter(({ id }) => flaggedQuestions[id]);
                    const nextFlagged = flaggedIndices.find(({ i }) => i >= currentQuestion) || flaggedIndices[0];
                    return (
                      <button
                        onClick={() => setCurrentQuestion(nextFlagged.i + 1)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                          background: '#FFF6E5', border: '1px solid #F0CA80',
                          borderRadius: 'var(--r-xs)', padding: '6px 10px',
                          color: '#A56B0A', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        <Icon name="flag" size={12} color="#E67E22" />
                        {flaggedCount} flagged — jump to next
                        <Icon name="chevron-right" size={12} style={{ marginLeft: 'auto' }} />
                      </button>
                    );
                  })()}
                </>
              );
            })()}
          </div>

          <button
            className="btn"
            style={{ marginTop: 14, width: '100%', background: 'linear-gradient(135deg, #27AE60, #1E8449)', border: 'none', boxShadow: 'var(--s-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onClick={() => { answersSnapshotRef.current = { ...answers }; essaySnapshotRef.current = { ...essayAnswers }; setShowSubmitModal(true); }}
          >
            <Icon name="check-circle" size={16} />
            Submit Final Exam
          </button>
        </aside>
      </div>

      <p style={{ textAlign: 'center', margin: '6px 0 10px', fontSize: 10, color: 'rgba(0,0,0,.15)', letterSpacing: '.18em', fontWeight: 700 }}>
        KMR · PATTS COLLEGE OF AERONAUTICS
      </p>
    </div>
  );
}