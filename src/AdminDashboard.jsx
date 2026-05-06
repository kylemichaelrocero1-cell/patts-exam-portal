import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export default function AdminDashboard({ onLogout }) {
  // Navigation State
  const [activeTab, setActiveTab] = useState('results'); // 'results' or 'manage'

  // Data States
  const [results, setResults] = useState([]);
  const [examsList, setExamsList] = useState([]); // Holds full exam data for the Manage tab
  const [examsDict, setExamsDict] = useState({}); // Holds just titles for the Results tab
  const [students, setStudents] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  // Filter States
  const [selectedSection, setSelectedSection] = useState('All');
  const [selectedExam, setSelectedExam] = useState('All');

  // Edit Time State
  const [editingTimes, setEditingTimes] = useState({});

  // --- NEW ANALYTICS STATES ---
  const [viewingStudent, setViewingStudent] = useState(null); 
  const [viewingStatsExam, setViewingStatsExam] = useState(null);
  const [examQuestionsCache, setExamQuestionsCache] = useState({});

  // Helper to load questions only when needed so the dashboard stays fast
  const loadExamQuestions = async (examId) => {
    if (examQuestionsCache[examId]) return examQuestionsCache[examId];
    setIsLoading(true);
    const { data } = await supabase.from('questions').select('*').eq('exam_id', examId).order('id', { ascending: true });
    setExamQuestionsCache(prev => ({ ...prev, [examId]: data }));
    setIsLoading(false);
    return data;
  };

  const openStudentDetails = async (row) => {
    await loadExamQuestions(row.exam_id);
    setViewingStudent(row);
  };

  const openExamStats = async (examId) => {
    await loadExamQuestions(examId);
    setViewingStatsExam(examId);
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  async function fetchDashboardData() {
    setIsLoading(true);
    try {
      const { data: resultsData } = await supabase.from('results').select('*');
      
      // NEW: We now fetch is_open and duration_minutes as well!
      const { data: examsData } = await supabase.from('exams').select('id, title, is_open, duration_minutes').order('created_at', { ascending: true });
      
      const { data: studentsData } = await supabase.from('users').select('id, full_name, section');

      const dict = {};
      const times = {};
      if (examsData) {
        examsData.forEach(e => {
          dict[e.id] = e.title;
          times[e.id] = e.duration_minutes; // Store initial times for the input boxes
        });
        setExamsList(examsData);
        setEditingTimes(times);
      }

      const studentDict = {};
      if (studentsData) {
        studentsData.forEach(s => {
          studentDict[s.id] = { 
            name: s.full_name || 'Unknown', 
            section: s.section || 'Unknown' 
          };
        });
      }

      setExamsDict(dict);
      setStudents(studentDict);
      setResults(resultsData || []);
    } catch (error) {
      console.error("Error loading dashboard:", error);
    } finally {
      setIsLoading(false);
    }
  }
const deleteResult = async (studentId, examId) => {
    if (window.confirm("🚨 Are you sure you want to permanently delete this score?")) {
      const { error } = await supabase
        .from('results')
        .delete()
        .eq('student_id', studentId)
        .eq('exam_id', examId);

      if (error) {
        alert("Failed to delete: " + error.message);
      } else {
        setResults(prev => prev.filter(r => !(r.student_id === studentId && r.exam_id === examId)));
      }
    }
  };
  // --- NEW: Toggle Exam Open/Close ---
  const toggleExamStatus = async (examId, currentStatus) => {
    const newStatus = !currentStatus;
    
    // Update Supabase
    const { error } = await supabase.from('exams').update({ is_open: newStatus }).eq('id', examId);
    
    if (error) {
      alert("Error updating exam status. Please try again.");
      console.error(error);
      return;
    }

    // Update local screen immediately
    setExamsList(prev => prev.map(e => e.id === examId ? { ...e, is_open: newStatus } : e));
  };

  // --- NEW: Save New Time Limit ---
  const saveTimeLimit = async (examId) => {
    const newTime = editingTimes[examId];
    
    if (!newTime || newTime <= 0) {
      alert("Please enter a valid number of minutes.");
      return;
    }

    // Update Supabase
    const { error } = await supabase.from('exams').update({ duration_minutes: parseInt(newTime) }).eq('id', examId);
    
    if (error) {
      alert("Error saving time limit. Please try again.");
      console.error(error);
      return;
    }

    alert("Time limit updated successfully!");
    setExamsList(prev => prev.map(e => e.id === examId ? { ...e, duration_minutes: parseInt(newTime) } : e));
  };

  const handleTimeChange = (examId, value) => {
    setEditingTimes(prev => ({ ...prev, [examId]: value }));
  };

  const formatTime = (totalSeconds) => {
    if (!totalSeconds && totalSeconds !== 0) return "N/A";
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}m ${s}s`;
  };

  const filteredAndSortedResults = results
    .filter(row => {
      const studentInfo = students[row.student_id] || {};
      const matchesSection = selectedSection === 'All' || studentInfo.section === selectedSection;
      const matchesExam = selectedExam === 'All' || row.exam_id === selectedExam;
      return matchesSection && matchesExam;
    })
    .sort((a, b) => {
      const secA = students[a.student_id]?.section || 'Z'; 
      const secB = students[b.student_id]?.section || 'Z';
      return secA.localeCompare(secB);
    });

  const uniqueSections = ['All', ...new Set(Object.values(students).map(s => s.section).filter(Boolean))];

  if (isLoading) return <h2 style={{textAlign: 'center', marginTop: '100px', color: '#0A2342'}}>Loading Dashboard...</h2>;

  return (
    <div className="app-container" style={{ padding: '40px', minHeight: '100vh', background: '#f4f6f8' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', background: '#0A2342', padding: '20px', borderRadius: '8px' }}>
        <h1 style={{ margin: 0, color: 'white' }}>Instructor Dashboard</h1>
        <button style={{ background: '#E74C3C', width: 'auto' }} onClick={onLogout}>Close Portal</button>
      </header>

      {/* TABS NAVIGATION */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <button 
          style={{ background: activeTab === 'results' ? '#27AE60' : '#ccc', color: activeTab === 'results' ? 'white' : '#333', flex: 1 }}
          onClick={() => setActiveTab('results')}
        >
          📊 Student Results
        </button>
        <button 
          style={{ background: activeTab === 'manage' ? '#27AE60' : '#ccc', color: activeTab === 'manage' ? 'white' : '#333', flex: 1 }}
          onClick={() => setActiveTab('manage')}
        >
          ⚙️ Manage Exams
        </button>
      </div>

      <div style={{ background: 'white', borderRadius: '8px', padding: '20px', color: '#333', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
        
        {/* --- TAB 1: STUDENT RESULTS --- */}
        {activeTab === 'results' && (
          <>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', padding: '15px', background: '#F8F9FA', borderRadius: '8px', border: '1px solid #ddd' }}>
              <div>
                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Filter by Exam:</label>
                <select style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} value={selectedExam} onChange={e => setSelectedExam(e.target.value)}>
                  <option value="All">All Exams</option>
                  {Object.entries(examsDict).map(([id, title]) => (
                    <option key={id} value={id}>{title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Filter by Section:</label>
                <select style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} value={selectedSection} onChange={e => setSelectedSection(e.target.value)}>
                  {uniqueSections.map(sec => (
                    <option key={sec} value={sec}>{sec}</option>
                  ))}
                </select>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#0A2342', color: 'white' }}>
                  <th style={{ padding: '12px' }}>Student Name</th>
                  <th style={{ padding: '12px' }}>Section</th>
                  <th style={{ padding: '12px' }}>Exam Title</th>
                  <th style={{ padding: '12px' }}>Score</th>
                  <th style={{ padding: '12px' }}>Time Taken</th>
                  <th style={{ padding: '12px' }}>Cheating Strikes</th>
                  <th style={{ padding: '15px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedResults.length === 0 ? (
                  <tr><td colSpan="6" style={{ padding: '20px', textAlign: 'center' }}>No results found.</td></tr>
                ) : (
                  filteredAndSortedResults.map((row, index) => {
                    const student = students[row.student_id] || { name: 'Unknown', section: 'Unknown' };
                    const examTitle = examsDict[row.exam_id] || 'Unknown Exam';
                    const percentage = Math.round((row.score / row.total_items) * 100);
                    return (
                      <tr key={index} style={{ borderBottom: '1px solid #ddd', background: index % 2 === 0 ? '#fdfdfd' : 'white' }}>
                        <td style={{ padding: '12px', fontWeight: 'bold' }}>{student.name}</td>
                        <td style={{ padding: '12px' }}>{student.section}</td>
                        <td style={{ padding: '12px' }}>{examTitle}</td>
                        <td style={{ padding: '12px', fontWeight: 'bold', color: percentage >= 75 ? '#27AE60' : '#E74C3C' }}>
                          {row.score} / {row.total_items} ({percentage}%)
                        </td>
                        <td style={{ padding: '12px' }}>{formatTime(row.time_taken_seconds)}</td>
                        <td style={{ padding: '12px', color: row.tab_switches > 0 ? '#E74C3C' : '#27AE60', fontWeight: 'bold' }}>
                          {row.tab_switches > 0 ? `⚠️ ${row.tab_switches} Violations` : '✅ Clean'}
                        </td>
                        <td style={{ padding: '15px', display: 'flex', gap: '8px' }}>
  <button 
    onClick={() => openStudentDetails(row)} 
    style={{ background: '#3498DB', padding: '6px 12px', fontSize: '12px', width: 'auto', border: 'none', borderRadius: '4px', color: 'white', fontWeight: 'bold' }}
  >
    📄 View Answers
  </button>
  <button 
    onClick={() => deleteResult(row.student_id, row.exam_id)} 
    style={{ background: '#E74C3C', padding: '6px 12px', fontSize: '12px', width: 'auto', border: 'none', borderRadius: '4px', color: 'white', fontWeight: 'bold' }}
  >
    🗑️ Delete
  </button>
</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </>
        )}

        {/* --- TAB 2: MANAGE EXAMS --- */}
        {activeTab === 'manage' && (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#0A2342', color: 'white' }}>
                <th style={{ padding: '12px' }}>Exam Title</th>
                <th style={{ padding: '12px' }}>Status (Switch)</th>
                <th style={{ padding: '12px' }}>Time Limit (Minutes)</th>
              </tr>
            </thead>
            <tbody>
              {examsList.map((exam) => (
                <tr key={exam.id} style={{ borderBottom: '1px solid #ddd' }}>
                  <td style={{ padding: '12px', fontWeight: 'bold' }}>{exam.title}</td>
                  
                  {/* Neat Toggle Switch */}
                  <td style={{ padding: '12px' }}>
                    <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '60px', height: '34px' }}>
                      <input 
                        type="checkbox" 
                        checked={exam.is_open} 
                        onChange={() => toggleExamStatus(exam.id, exam.is_open)}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span className="slider" style={{ position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: exam.is_open ? '#27AE60' : '#ccc', transition: '.4s', borderRadius: '34px' }}></span>
                    </label>
                    <span style={{ marginLeft: '10px', fontWeight: 'bold', color: exam.is_open ? '#27AE60' : '#666' }}>
                      {exam.is_open ? 'OPEN' : 'CLOSED'}
                    </span>
                  </td>

                  {/* Smart Time Input with Save Indicator */}
                  <td style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <input 
                        type="number" 
                        value={editingTimes[exam.id]} 
                        onChange={(e) => handleTimeChange(exam.id, e.target.value)}
                        style={{ width: '80px', padding: '8px', border: '1px solid #ccc' }}
                      />
                      <span>mins</span>
                      
                      {/* Only shows SAVE button if the value is different from initial */}
                      <button 
  onClick={() => openExamStats(exam.id)}
  style={{
    width: 'auto', 
    padding: '12px 20px', 
    background: '#8E44AD', 
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  }}
>
  📊 CLASS STATS
</button>
                      
                      <button 
                        onClick={() => saveTimeLimit(exam.id)}
                        style={{ 
                          background: '#0A2342', color: 'white', opacity: editingTimes[exam.id] != examsList.find(e => e.id === exam.id).duration_minutes ? 1 : 0.5 
                        }}
                      >
                        {editingTimes[exam.id] != examsList.find(e => e.id === exam.id).duration_minutes ? '💾 Save Changes' : '✅ Saved'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      </div>
{/* ========================================= */}
      {/* MODAL 1: INDIVIDUAL STUDENT ANSWER SHEET  */}
      {/* ========================================= */}
      {viewingStudent && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: '#F4F7F9', padding: '30px', borderRadius: '12px', width: '90%', maxWidth: '800px', maxHeight: '85vh', overflowY: 'auto', position: 'relative' }}>
            <button onClick={() => setViewingStudent(null)} style={{ position: 'absolute', top: '20px', right: '20px', background: '#E74C3C', width: 'auto', padding: '8px 15px', borderRadius: '6px' }}>Close</button>
            
            <h2 style={{ color: '#0A2342', marginTop: 0 }}>{students[viewingStudent.student_id]?.name}'s Exam Paper</h2>
            <div style={{ background: 'white', padding: '15px', borderRadius: '8px', marginBottom: '20px', display: 'inline-block', fontWeight: 'bold', border: '2px solid #0A2342' }}>
              Final Score: <span style={{ color: viewingStudent.score === 0 ? '#E74C3C' : '#27AE60' }}>{viewingStudent.score} / {viewingStudent.total_items}</span>
            </div>
{/* ---> NEW: SECURITY INCIDENT LOG <--- */}
            {viewingStudent.violation_logs && viewingStudent.violation_logs.length > 0 && (
              <div style={{ background: '#FADBD8', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '2px solid #E74C3C' }}>
                <h3 style={{ color: '#C0392B', margin: '0 0 10px 0', fontSize: '18px' }}>🚨 Security Incident Log</h3>
                <ul style={{ margin: 0, paddingLeft: '20px', color: '#C0392B', fontSize: '15px', lineHeight: '1.6' }}>
                  {viewingStudent.violation_logs.map((log, i) => (
                    <li key={i}><strong>{log.substring(0, 11)}</strong> {log.substring(12)}</li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ display: 'grid', gap: '15px' }}>
              {(examQuestionsCache[viewingStudent.exam_id] || []).map((q, idx) => {
                const sAnswer = viewingStudent.answers_json[q.id];
                const studentChoice = sAnswer !== undefined ? Number(sAnswer.chosen) : -1;
                const correctChoice = Number(q.correct_answer);
                
                return (
                  <div key={q.id} style={{ background: 'white', padding: '20px', borderRadius: '8px', borderLeft: studentChoice === correctChoice ? '6px solid #27AE60' : '6px solid #E74C3C', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                    <p style={{ margin: '0 0 15px 0', fontWeight: 'bold' }}>{idx + 1}. {q.question_text}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      {['a', 'b', 'c', 'd'].map((letter, i) => {
                        let bgColor = '#F8F9FA';
                        let borderColor = '#DDD';
                        let textColor = '#555';
                        let tag = '';

                        if (i === correctChoice) {
                          bgColor = '#D5F5E3'; borderColor = '#27AE60'; textColor = '#1E8449'; tag = ' ✅ Correct Answer';
                        } else if (i === studentChoice && studentChoice !== correctChoice) {
                          bgColor = '#FADBD8'; borderColor = '#E74C3C'; textColor = '#C0392B'; tag = ' ❌ Student Picked';
                        }

                        return (
                          <div key={letter} style={{ padding: '10px', background: bgColor, border: `2px solid ${borderColor}`, borderRadius: '6px', color: textColor, fontSize: '14px' }}>
                            <strong>{letter.toUpperCase()}.</strong> {q[`choice_${letter}`]} {tag}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* MODAL 2: CLASS ITEM ANALYSIS (STATS)      */}
      {/* ========================================= */}
      {viewingStatsExam && (
        <div className="print-modal-overlay" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          
          <div className="print-zone" style={{ background: '#F4F7F9', padding: '30px', borderRadius: '12px', width: '90%', maxWidth: '900px', maxHeight: '85vh', overflowY: 'auto', position: 'relative' }}>
            
            <button onClick={() => setViewingStatsExam(null)} style={{ position: 'absolute', top: '20px', right: '20px', background: '#E74C3C', width: 'auto', padding: '8px 15px', borderRadius: '6px', color: 'white', border: 'none', cursor: 'pointer' }}>Close</button>
            
            {/* 2. We added the Print Button right next to it: */}
            <button onClick={() => window.print()} style={{ position: 'absolute', top: '20px', right: '100px', background: '#27AE60', width: 'auto', padding: '8px 15px', borderRadius: '6px', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
              🖨️ Save as PDF
            </button>
            
            <h2 style={{ color: '#0A2342', marginTop: 0 }}>Item Analysis & Statistics</h2>
            <p style={{ color: '#666', marginBottom: '25px' }}>See exactly how many students chose each option.</p>

            <div style={{ display: 'grid', gap: '20px' }}>
              {(examQuestionsCache[viewingStatsExam] || []).map((q, idx) => {
                // Calculate Stats for this specific question
                const examResults = results.filter(r => r.exam_id === viewingStatsExam);
                const totalAnswers = examResults.length;
                
                const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
                let unassignedCount = 0;

                examResults.forEach(r => {
                  const sAnswer = r.answers_json[q.id];
                  if (sAnswer !== undefined) counts[sAnswer.chosen]++;
                  else unassignedCount++;
                });

                return (
                  <div key={q.id} style={{ background: 'white', padding: '25px', borderRadius: '10px', borderTop: '4px solid #0A2342', boxShadow: '0 4px 10px rgba(0,0,0,0.05)' }}>
                    <p style={{ margin: '0 0 20px 0', fontSize: '16px', fontWeight: 'bold', color: '#333' }}>{idx + 1}. {q.question_text}</p>
                    
                    <div style={{ display: 'grid', gap: '12px' }}>
                      {['a', 'b', 'c', 'd'].map((letter, i) => {
                        const count = counts[i];
                        const percentage = totalAnswers > 0 ? Math.round((count / totalAnswers) * 100) : 0;
                        const isCorrect = i === Number(q.correct_answer);

                        return (
                          <div key={letter} style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                            <div style={{ width: '40px', fontWeight: 'bold', color: isCorrect ? '#27AE60' : '#555' }}>
                              {letter.toUpperCase()}.
                            </div>
                            
                            {/* The Visual Bar */}
                            <div style={{ flex: 1, background: '#F0F0F0', height: '24px', borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
                              <div style={{ width: `${percentage}%`, height: '100%', background: isCorrect ? '#27AE60' : '#3498DB', transition: 'width 0.5s ease' }}></div>
                            </div>
                            
                            {/* The Numbers */}
                            <div style={{ width: '80px', textAlign: 'right', fontSize: '14px', fontWeight: 'bold', color: '#555' }}>
                              {count} ({percentage}%)
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}