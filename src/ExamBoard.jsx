import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export default function ExamBoard({ student, exam, examSet }) {
  const storageKey = `exam_progress_${student?.id}_${exam?.id}`;
  const startingSeconds = exam?.duration_minutes ? (exam.duration_minutes * 60) : 14400;

  // --- 1. INITIAL STATE ---
  const [initialState] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) return JSON.parse(saved); 
    const newProgress = { answers: {}, tabSwitchCount: 0, endTime: Date.now() + (startingSeconds * 1000) };
    localStorage.setItem(storageKey, JSON.stringify(newProgress));
    return newProgress;
  });

  const [answers, setAnswers] = useState(initialState.answers);
  const [tabSwitchCount, setTabSwitchCount] = useState(initialState.tabSwitchCount);
  const [violationLogs, setViolationLogs] = useState([]);
  const endTime = initialState.endTime; 
  const [timeLeft, setTimeLeft] = useState(startingSeconds);
  const [localTime, setLocalTime] = useState(new Date().toLocaleTimeString()); 
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [questions, setQuestions] = useState([]); 
  const [isLoading, setIsLoading] = useState(true); 
  const [scoreDisplay, setScoreDisplay] = useState(null); 
// --- CLONE GUARD: Check for multiple logins ---
  useEffect(() => {
    const checkSession = setInterval(async () => {
      const localToken = localStorage.getItem('local_session_token');
      if (!localToken || !student?.id) return;

      const { data } = await supabase.from('users').select('session_token').eq('id', student.id).single();
      
      // THE FIX: We added "data.session_token" here so it ignores empty database results
      if (data && data.session_token && data.session_token !== localToken) {
        clearInterval(checkSession);
        alert("⚠️ SECURITY ALERT: Your account was logged in from another device or tab. You have been disconnected.");
        window.location.reload(); 
      }
    }, 5000); 

    return () => clearInterval(checkSession);
  }, [student?.id]);

  // SUBMISSION CONTROLS
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false); // THE GUARD

  // --- 2. AUTO-SAVER ---
  useEffect(() => {
    if (scoreDisplay || isSubmitting) return; 
    const progressData = { answers, tabSwitchCount, endTime };
    localStorage.setItem(storageKey, JSON.stringify(progressData));
  }, [answers, tabSwitchCount, endTime, storageKey, scoreDisplay, isSubmitting]);

  // --- 3. TIMER & CLOCK ---
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

  // --- 4. SAFE AUTO-SUBMIT TRIGGER ---
  useEffect(() => {
    // Only fire if time is 0 AND we aren't already in the middle of a submission
    if (timeLeft === 0 && !scoreDisplay && !isSubmitting && !isLoading) {
      console.log("⏱️ Time up! Triggering auto-submit...");
      executeSubmission();
    }
  }, [timeLeft, scoreDisplay, isSubmitting, isLoading]);

 // --- UPGRADED ANTI-CHEAT: Tracks Specific Violations with Timestamps ---
  useEffect(() => {
    if (scoreDisplay || isSubmitting) return; 

    // Helper function to record the exact time and reason
    const logViolation = (reason) => {
      const timeStr = new Date().toLocaleTimeString();
      const logEntry = `[${timeStr}] ${reason}`;
      
      setViolationLogs(prev => [...prev, logEntry]);
      setTabSwitchCount(prev => prev + 1);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        logViolation("Tab hidden or switched to another app");
        alert("⚠️ SYSTEM WARNING: Tab switch detected.");
      }
    };

    const handleBlur = () => {
      logViolation("Screen lost focus (Split-screen or notifications opened)");
    };

    const handleKeyDown = (e) => {
      const forbidden = e.key === 'PrintScreen' || ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 's')) || (e.metaKey && e.shiftKey);
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
    };
  }, [scoreDisplay, isSubmitting]);

  useEffect(() => {
    if (scoreDisplay || isSubmitting) return;
    const handleKeyDown = (e) => {
      const forbidden = e.key === 'PrintScreen' || ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 's')) || (e.metaKey && e.shiftKey);
      if (forbidden) {
        e.preventDefault();
        setTabSwitchCount(prev => prev + 1);
        alert("⚠️ SECURITY VIOLATION: Screenshot/Print disabled.");
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scoreDisplay, isSubmitting]);

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
      
      if (error) {
        console.error("Error loading questions:", error);
      } else if (data) {
        // --- SEEDED SHUFFLE LOGIC ---
        // Uses the student's unique ID to scramble the questions the exact same way every time
        let seed = student?.id ? student.id.charCodeAt(0) + student.id.charCodeAt(student.id.length - 1) : 123;
        
        const seededRandom = () => {
          let x = Math.sin(seed++) * 10000;
          return x - Math.floor(x);
        };

        let shuffled = [...data];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(seededRandom() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        
        setQuestions(shuffled);
      }
      setIsLoading(false);
    }
    loadQuestions();
  }, [exam?.id, student?.id]);

  // --- 6. THE FIXED SUBMISSION LOGIC ---
  const executeSubmission = async () => {
    if (isSubmitting) return; // DOOR IS LOCKED - no double submission!
    
    setIsSubmitting(true);
    setIsLoading(true);

    try {
      // 1. Calculate Score
      const { data: answerKey } = await supabase.from('questions').select('id, correct_answer').eq('exam_id', exam.id);
     let correctCount = 0;
      const formattedAnswers = {};

      Object.keys(answers).forEach(qId => {
        // FIX 1: Force both IDs to be strings so they match perfectly, even if they are UUIDs
        const questionData = answerKey.find(item => String(item.id) === String(qId));
        
        if (questionData) {
          // FIX 2: Force both answers to be Numbers (0, 1, 2, or 3) so strict equality doesn't fail
          const correctValue = Number(questionData.correct_answer);
          const studentValue = Number(answers[qId]);

          const isCorrect = studentValue === correctValue;
          if (isCorrect) correctCount++;

          formattedAnswers[qId] = { 
            chosen: studentValue, 
            is_correct: isCorrect 
          };
        }
      });

      // 2. Save to Supabase
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

      if (saveError) throw saveError;

      // 3. Clear Local Data
      localStorage.removeItem(storageKey);
      setScoreDisplay({ score: correctCount, total: questions.length });

    } catch (err) {
      console.error("Submission Error:", err);
      // If it's the 'already exists' error, just show the finish screen anyway
      if (err.code === '23505') {
        setScoreDisplay({ score: 0, total: questions.length });
      } else {
        alert("There was an error saving your exam. Please contact your instructor.");
      }
    } finally {
      setIsLoading(false);
      setIsSubmitting(false);
      setShowSubmitModal(false);
    }
  };

  if (isLoading && !isSubmitting) return <h2 style={{textAlign: 'center', marginTop: '100px'}}>Loading Exam...</h2>;

  if (scoreDisplay) {
    return (
      <div className="app-container">
        <header className="header"><h1>PATTS College of Aeronautics</h1></header>
        <div className="login-container" style={{ textAlign: 'center', marginTop: '50px' }}>
          <h2>Exam Complete!</h2>
          <div style={{ margin: '30px 0', padding: '30px', background: '#F8F9FA', borderRadius: '8px', border: '2px solid #0A2342' }}>
            <h3 style={{ color: '#27AE60' }}>Answers Saved Successfully.</h3>
            <p>You may now exit the portal.</p>
          </div>
          <button onClick={() => window.location.reload()}>Log Out</button>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentQuestion - 1] || {};

  return (
    <div className="app-container prevent-select" onContextMenu={(e) => e.preventDefault()}>
      
      {showSubmitModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', padding: '30px', borderRadius: '12px', maxWidth: '450px', width: '90%', textAlign: 'center', color: '#333' }}>
            <h2 style={{ color: '#E74C3C' }}>Final Submission</h2>
            <p>You have answered <strong>{Object.keys(answers).length} / {questions.length}</strong> questions.</p>
            <p style={{ fontSize: '14px', color: '#666' }}>To confirm, please type <strong>submit now</strong> below:</p>
            <input 
              type="text" 
              value={confirmText} 
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="type here..."
              style={{ width: '100%', padding: '12px', margin: '15px 0', borderRadius: '4px', border: '2px solid #ccc', textAlign: 'center', fontSize: '16px' }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button style={{ background: '#ccc', color: '#333' }} onClick={() => {setShowSubmitModal(false); setConfirmText('');}}>Cancel</button>
              <button 
                style={{ background: confirmText.toLowerCase() === 'submit now' ? '#27AE60' : '#aaa' }}
                disabled={confirmText.toLowerCase() !== 'submit now' || isSubmitting}
                onClick={executeSubmission}
              >
                {isSubmitting ? 'Saving...' : 'Submit Exam'}
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px' }}>PATTS College of Aeronautics</h1>
          <p style={{ margin: 0, fontSize: '14px' }}>{student?.full_name} | Set {examSet}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ fontSize: '12px', textAlign: 'right' }}>Local Time<br/><strong>{localTime}</strong></div>
          <div style={{ background: tabSwitchCount > 0 ? '#E74C3C' : 'rgba(255,255,255,0.2)', padding: '5px 12px', borderRadius: '6px', fontWeight: 'bold' }}>⚠️ {tabSwitchCount}</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: timeLeft <= 300 ? '#E74C3C' : 'white' }}>{formatTime(timeLeft)}</div>
        </div>
      </header>

      <div className="exam-layout">
        <main className="main-panel">
          <h2>Question {currentQuestion}</h2>
          <p style={{ fontSize: '18px', minHeight: '80px' }}>{currentQ?.question_text}</p>
          <div className="choices">
            {['a','b','c','d'].map((letter, idx) => (
              <button 
                key={letter}
                className={`choice-btn ${answers[currentQ?.id] === idx ? 'selected' : ''}`} 
                onClick={() => setAnswers({...answers, [currentQ.id]: idx})}
              >
                {letter.toUpperCase()}. {currentQ[`choice_${letter}`]}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '30px' }}>
            <button style={{ width: 'auto', background: '#ccc' }} onClick={() => setCurrentQuestion(q => Math.max(1, q-1))} disabled={currentQuestion === 1}>Previous</button>
            <button style={{ width: 'auto' }} onClick={() => setCurrentQuestion(q => Math.min(questions.length, q+1))} disabled={currentQuestion === questions.length}>Next</button>
          </div>
        </main>

        <aside className="side-panel">
          <h3>Navigator</h3>
          <div className="grid-container">
            {questions.map((q, i) => (
              <div key={q.id} onClick={() => setCurrentQuestion(i+1)} className={`grid-item ${currentQuestion === i+1 ? 'active' : ''} ${answers[q.id] !== undefined ? 'answered' : ''}`}>
                {i+1}
              </div>
            ))}
          </div>
          <button style={{ marginTop: '20px', background: '#27AE60' }} onClick={() => setShowSubmitModal(true)}>Submit Final Exam</button>
        </aside>
      </div>
    </div>
  );
}