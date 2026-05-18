import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export default function ExamList({ student, selectedSection, onStartExam, onLogout }) {
  const [exams, setExams] = useState([]);
  const [completedExams, setCompletedExams] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Password gate state
  const [pendingExam, setPendingExam] = useState(null);
  const [enteredPassword, setEnteredPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    fetchExams();
  }, [selectedSection]);

  const fetchExams = async () => {
    setIsLoading(true);

    const { data: examsData } = await supabase
      .from('exams')
      .select('*')
      .eq('target_section', selectedSection)
      .eq('is_open', true)
      .order('created_at', { ascending: false });

    if (examsData) setExams(examsData);

    const { data: resultsData } = await supabase
      .from('results')
      .select('exam_id')
      .eq('student_id', student.id);

    if (resultsData) {
      setCompletedExams(resultsData.map(r => r.exam_id));
    }

    setIsLoading(false);
  };

  const handleStartClick = (exam) => {
    if (exam.exam_password) {
      setPendingExam(exam);
      setEnteredPassword('');
      setPasswordError('');
    } else {
      onStartExam(exam);
    }
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (enteredPassword === pendingExam.exam_password) {
      onStartExam(pendingExam);
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

        {exams.length === 0 ? (
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
                          style={{
                            width: 'auto',
                            padding: '14px 28px',
                            background: '#0A2342',
                            color: '#FFFFFF',
                            fontWeight: 'bold',
                            fontSize: '15px',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer'
                          }}
                          onClick={() => handleStartClick(exam)}
                        >
                          Start Set A
                        </button>

                        <button
                          style={{
                            width: 'auto',
                            padding: '14px 28px',
                            background: '#34495E',
                            color: '#FFFFFF',
                            fontWeight: 'bold',
                            fontSize: '15px',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer'
                          }}
                          onClick={() => handleStartClick(exam)}
                        >
                          Start Set B
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
