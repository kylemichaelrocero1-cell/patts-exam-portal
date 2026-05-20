import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export default function ExamList({ student, selectedSection, onStartExam, onLogout }) {
  const [exams, setExams] = useState([]);
  const [completedExams, setCompletedExams] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(false);

  // Password gate state
  const [pendingExam, setPendingExam] = useState(null);
  const [enteredPassword, setEnteredPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    fetchExams();
  }, [selectedSection]);

  const fetchExams = async () => {
    setIsLoading(true);
    setFetchError(false);
    try {
      const { data: examsData, error: examsError } = await supabase
        .from('exams')
        .select('*')
        .eq('is_open', true)
        .order('created_at', { ascending: false });

      if (examsError) throw examsError;

      if (examsData) {
        const filtered = examsData.filter(exam => {
          if (!exam.target_section) return false;
          const sections = exam.target_section.split(',').map(s => s.trim());
          return sections.includes(selectedSection);
        });
        setExams(filtered);
      }

      const { data: resultsData } = await supabase
        .from('results')
        .select('exam_id')
        .eq('student_id', student.id);

      if (resultsData) {
        setCompletedExams(resultsData.map(r => r.exam_id));
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
      // Re-fetch the exam to get the latest password from DB (prevents stale-data bypass)
      const { data: freshExam } = await supabase
        .from('exams')
        .select('id, title, duration_minutes, target_section, exam_password, is_open')
        .eq('id', exam.id)
        .single();

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

      if (examData.exam_password) {
        setPendingExam({ ...examData, _chosenSet: setChoice });
        setEnteredPassword('');
        setPasswordError('');
      } else {
        onStartExam(examData, setChoice);
      }
    } catch (err) {
      console.error('Session check failed:', err);
      // Network error — fall back gracefully: use cached exam data, apply password check
      if (exam.exam_password) {
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

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (enteredPassword === pendingExam.exam_password) {
      sessionStorage.setItem(`exam_pass_ok_${pendingExam.id}`, '1');
      onStartExam(pendingExam, pendingExam._chosenSet);
      setPendingExam(null);
    } else {
      setPasswordError('Incorrect password. Please try again.');
      setEnteredPassword('');
    }
  };

  if (isLoading) return <h2 style={{ textAlign: 'center', marginTop: '100px', color: '#0A2342' }}>Loading Exams...</h2>;

  return (
    <div className="app-container" style={{ padding: '40px', backgroundColor: '#F4F7F9', minHeight: '100vh' }}>

      {/* PASSWORD GATE MODAL */}
      {pendingExam && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <form
            onSubmit={handlePasswordSubmit}
            style={{ background: 'white', padding: '40px', borderRadius: '12px', maxWidth: '420px', width: '90%', textAlign: 'center', color: '#333' }}
          >
            <div style={{ fontSize: '48px', marginBottom: '10px' }}>🔒</div>
            <h2 style={{ color: '#0A2342', marginTop: 0, marginBottom: '8px' }}>Exam Password Required</h2>
            <p style={{ color: '#555', marginBottom: '6px', fontSize: '15px' }}>
              <strong>{pendingExam.title}</strong>
            </p>
            <p style={{ color: '#777', fontSize: '14px', marginBottom: '24px' }}>
              Ask your instructor for today's exam password.
            </p>
            <input
              type="password"
              value={enteredPassword}
              onChange={(e) => setEnteredPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              style={{ width: '100%', padding: '14px', borderRadius: '6px', border: `2px solid ${passwordError ? '#E74C3C' : '#ccc'}`, fontSize: '18px', textAlign: 'center', letterSpacing: '3px', boxSizing: 'border-box', marginBottom: '10px' }}
            />
            {passwordError && (
              <p style={{ color: '#E74C3C', fontWeight: 'bold', margin: '0 0 16px 0', fontSize: '14px' }}>{passwordError}</p>
            )}
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => setPendingExam(null)}
                style={{ flex: 1, background: '#ccc', color: '#333', border: 'none', padding: '12px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!enteredPassword}
                style={{ flex: 1, background: enteredPassword ? '#0A2342' : '#aaa', color: 'white', border: 'none', padding: '12px', borderRadius: '6px', fontWeight: 'bold', cursor: enteredPassword ? 'pointer' : 'not-allowed', fontSize: '15px' }}
              >
                Enter Exam
              </button>
            </div>
          </form>
        </div>
      )}

      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0A2342', padding: '20px', borderRadius: '8px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#FFFFFF' }}>PATTS College of Aeronautics</h1>
          <p style={{ margin: 0, color: '#D1D1D1' }}>Welcome, <strong style={{ color: '#FFFFFF' }}>{student.full_name}</strong></p>
        </div>
        <button onClick={onLogout} style={{ width: 'auto', background: '#E74C3C', color: '#FFFFFF', fontWeight: 'bold', border: 'none', padding: '10px 20px', borderRadius: '5px', cursor: 'pointer' }}>Log Out</button>
      </header>

      <div style={{ marginTop: '40px' }}>
        <h2 style={{ color: '#0A2342', marginBottom: '25px', borderBottom: '2px solid #0A2342', paddingBottom: '10px' }}>Available Examinations</h2>

        {fetchError ? (
          <div style={{ background: '#FADBD8', padding: '40px', borderRadius: '12px', textAlign: 'center', border: '2px solid #E74C3C' }}>
            <p style={{ color: '#C0392B', fontSize: '18px', fontWeight: 'bold' }}>⚠️ Could not load exams. Please check your internet connection and refresh the page.</p>
            <button onClick={fetchExams} style={{ marginTop: '15px', background: '#E74C3C', color: 'white', border: 'none', padding: '10px 24px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Retry</button>
          </div>
        ) : exams.length === 0 ? (
          <div style={{ background: 'white', padding: '40px', borderRadius: '12px', textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
            <p style={{ color: '#555', fontSize: '18px' }}>No exams are currently open. Please wait for your instructor.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '25px' }}>
            {exams.map(exam => {
              const isAlreadyDone = completedExams.includes(exam.id);

              return (
                <div key={exam.id} style={{
                  background: '#FFFFFF',
                  padding: '30px',
                  borderRadius: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
                  borderLeft: isAlreadyDone ? '10px solid #27AE60' : '10px solid #3498DB'
                }}>
                  <div>
                    <h3 style={{ margin: '0 0 8px 0', color: '#0A2342', fontSize: '22px' }}>{exam.title}</h3>
                    <p style={{ margin: 0, color: '#444', fontSize: '16px' }}>Time Limit: <strong style={{ color: '#0A2342' }}>{exam.duration_minutes} Minutes</strong></p>
                    {exam.exam_password && !isAlreadyDone && (
                      <p style={{ margin: '6px 0 0', color: '#E67E22', fontSize: '13px', fontWeight: 'bold' }}>🔒 Password required</p>
                    )}
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    {isAlreadyDone ? (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{
                          background: '#D5F5E3',
                          color: '#1E8449',
                          padding: '12px 24px',
                          borderRadius: '30px',
                          fontWeight: '900',
                          display: 'inline-block',
                          fontSize: '14px',
                          border: '1px solid #27AE60'
                        }}>
                          ✅ EXAM SUBMITTED
                        </span>
                        <p style={{ fontSize: '12px', color: '#777', marginTop: '8px' }}>Your responses have been recorded.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '15px' }}>
                        <button
                          disabled={isCheckingSession}
                          style={{
                            width: 'auto',
                            padding: '14px 28px',
                            background: isCheckingSession ? '#aaa' : '#0A2342',
                            color: '#FFFFFF',
                            fontWeight: 'bold',
                            fontSize: '15px',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: isCheckingSession ? 'not-allowed' : 'pointer'
                          }}
                          onClick={() => handleStartClick(exam, 'A')}
                        >
                          {isCheckingSession ? 'Checking...' : 'Start Set A'}
                        </button>

                        <button
                          disabled={isCheckingSession}
                          style={{
                            width: 'auto',
                            padding: '14px 28px',
                            background: isCheckingSession ? '#aaa' : '#34495E',
                            color: '#FFFFFF',
                            fontWeight: 'bold',
                            fontSize: '15px',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: isCheckingSession ? 'not-allowed' : 'pointer'
                          }}
                          onClick={() => handleStartClick(exam, 'B')}
                        >
                          {isCheckingSession ? 'Checking...' : 'Start Set B'}
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
    </div>
  );
}
