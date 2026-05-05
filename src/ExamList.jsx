import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export default function ExamList({ student, onSelectExam, onSelectSet, onLogout }) {
  const [exams, setExams] = useState([]);
  const [completedExams, setCompletedExams] = useState([]); 
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadPortalData() {
      setIsLoading(true);
      try {
        const { data: examsData } = await supabase.from('exams').select('*').eq('is_open', true);
        const { data: resultsData } = await supabase.from('results').select('exam_id').eq('student_id', student.id);

        if (examsData) setExams(examsData);
        if (resultsData) setCompletedExams(resultsData.map(r => r.exam_id));
      } catch (err) {
        console.error("Error loading portal:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadPortalData();
  }, [student.id]);

  if (isLoading) return <h2 style={{ textAlign: 'center', marginTop: '100px', color: '#0A2342' }}>Loading Exams...</h2>;

  return (
    // Background set to a light gray to make cards and text pop
    <div className="app-container" style={{ padding: '40px', backgroundColor: '#F4F7F9', minHeight: '100vh' }}>
      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0A2342', padding: '20px', borderRadius: '8px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#FFFFFF' }}>PATTS College of Aeronautics</h1>
          <p style={{ margin: 0, color: '#D1D1D1' }}>Welcome, <strong style={{ color: '#FFFFFF' }}>{student.full_name}</strong></p>
        </div>
        <button onClick={onLogout} style={{ width: 'auto', background: '#E74C3C', color: '#FFFFFF', fontWeight: 'bold', border: 'none', padding: '10px 20px', borderRadius: '5px', cursor: 'pointer' }}>Log Out</button>
      </header>

      <div style={{ marginTop: '40px' }}>
        {/* CHANGED: Header color is now Dark Navy for high contrast */}
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
                        {/* CHANGED: Set A Button - Explicit White Text on Navy */}
                        <button 
                          style={{ 
                            width: 'auto', 
                            padding: '14px 28px', 
                            background: '#0A2342', 
                            color: '#FFFFFF', 
                            fontWeight: 'bold',
                            fontSize: '15px',
                            border: 'none',
                            borderRadius: '6px'
                          }} 
                          onClick={() => { onSelectExam(exam); onSelectSet('A'); }}
                        >
                          Start Set A
                        </button>
                        {/* CHANGED: Set B Button - Explicit White Text on Gray-Blue */}
                        <button 
                          style={{ 
                            width: 'auto', 
                            padding: '14px 28px', 
                            background: '#34495E', 
                            color: '#FFFFFF', 
                            fontWeight: 'bold',
                            fontSize: '15px',
                            border: 'none',
                            borderRadius: '6px'
                          }} 
                          onClick={() => { onSelectExam(exam); onSelectSet('B'); }}
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