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
  const [studentsList, setStudentsList] = useState([]); // Holds the array for the table
  const [liveSessions, setLiveSessions] = useState([]); // NEW: Live Monitor Data
const [editingStudentSections, setEditingStudentSections] = useState({});
  const [selectedStudentIds, setSelectedStudentIds] = useState(new Set());
  const [batchSection, setBatchSection] = useState('');
  const [isBatchSaving, setIsBatchSaving] = useState(false);
  const [liveSort, setLiveSort] = useState('name');
  const [resultSort, setResultSort] = useState('section');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Filter States
  const [selectedSection, setSelectedSection] = useState('All');
  const [selectedExam, setSelectedExam] = useState('All');

  // Edit Time State
  const [editingTimes, setEditingTimes] = useState({});
  const [editingSections, setEditingSections] = useState({});
  const [editingPasswords, setEditingPasswords] = useState({});
  // --- NEW: Create Exam States ---
const [newTitle, setNewTitle] = useState('');
const [targetSection, setTargetSection] = useState('');

  // --- NEW ANALYTICS STATES ---
  const [viewingStudent, setViewingStudent] = useState(null);
  const [viewingStatsExam, setViewingStatsExam] = useState(null);
  const [examQuestionsCache, setExamQuestionsCache] = useState({});
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);

  // --- ATTENDANCE STATES ---
  const [attendanceExam, setAttendanceExam] = useState('');
  const [attendanceSection, setAttendanceSection] = useState('All');

  // --- QUESTION MANAGEMENT STATES ---
  const [qExamId, setQExamId] = useState('');
  const [qList, setQList] = useState([]);
  const [qLoading, setQLoading] = useState(false);
  const [qSaving, setQSaving] = useState(false);
  const [editingQ, setEditingQ] = useState(null); // null = add mode, object = edit mode
  const emptyQ = { question_text: '', choice_a: '', choice_b: '', choice_c: '', choice_d: '', correct_answer: 0 };
  const [qForm, setQForm] = useState(emptyQ);

  // Helper to load questions — uses a separate loading state so the dashboard never disappears
  const loadExamQuestions = async (examId) => {
    if (examQuestionsCache[examId]) return examQuestionsCache[examId];
    setIsLoadingQuestions(true);
    const { data } = await supabase.from('questions').select('*').eq('exam_id', examId).order('id', { ascending: true });
    setExamQuestionsCache(prev => ({ ...prev, [examId]: data || [] }));
    setIsLoadingQuestions(false);
    return data || [];
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
    fetchLiveSessions();

    const channel = supabase.channel('admin-realtime')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_sessions' }, payload => {
        if (payload.new.status === 'finished') {
          // Student submitted — remove from monitor
          setLiveSessions(prev => prev.filter(s => s.id !== payload.new.id));
          return;
        }
        setLiveSessions(prev => {
          const exists = prev.some(s => s.id === payload.new.id);
          if (exists) {
            // Normal in-place update — preserves row order
            return prev.map(s => s.id === payload.new.id ? { ...s, ...payload.new } : s);
          }
          // Session was dismissed but student is still active — restore it
          return [...prev, payload.new];
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_sessions' }, payload => {
        if (payload.new.status !== 'finished') {
          setLiveSessions(prev => {
            // Skip if we already have a session for this student+exam
            const isDuplicate = prev.some(s =>
              s.student_id === payload.new.student_id && s.exam_id === payload.new.exam_id
            );
            if (isDuplicate) return prev;
            return [...prev, payload.new];
          });
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'live_sessions' }, payload => {
        setLiveSessions(prev => prev.filter(s => s.id !== payload.old.id));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'results' }, payload => {
        setResults(prev => [...prev, payload.new]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'results' }, payload => {
        setResults(prev => prev.map(r =>
          r.student_id === payload.new.student_id && r.exam_id === payload.new.exam_id
            ? { ...r, ...payload.new }
            : r
        ));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'results' }, payload => {
        setResults(prev => prev.filter(r =>
          !(r.student_id === payload.old.student_id && r.exam_id === payload.old.exam_id)
        ));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchLiveSessions = async () => {
    const { data } = await supabase.from('live_sessions').select('*').neq('status', 'finished');
    if (data) {
      // Deduplicate by student+exam: prefer locked status, then most recently updated
      const sessionMap = new Map();
      data.forEach(s => {
        const key = `${s.student_id}_${s.exam_id}`;
        const existing = sessionMap.get(key);
        if (!existing) {
          sessionMap.set(key, s);
        } else if (s.status === 'locked' && existing.status !== 'locked') {
          sessionMap.set(key, s);
        } else if (existing.status !== 'locked') {
          const existTime = new Date(existing.updated_at || 0).getTime();
          const newTime = new Date(s.updated_at || 0).getTime();
          if (newTime > existTime) sessionMap.set(key, s);
        }
      });
      const deduped = [...sessionMap.values()];
      setLiveSessions(deduped.sort((a, b) => (a.student_name || '').localeCompare(b.student_name || '')));
    }
  };

  const toggleStudentLock = async (sessionId, currentStatus) => {
    const newStatus = currentStatus === 'locked' ? 'active' : 'locked';
    await supabase.from('live_sessions').update({ status: newStatus, updated_at: new Date() }).eq('id', sessionId);
  };

  const applyLiveSort = (sortBy) => {
    setLiveSort(sortBy);
    setLiveSessions(prev => [...prev].sort((a, b) => {
      if (sortBy === 'section') {
        const secA = students[a.student_id]?.section || '';
        const secB = students[b.student_id]?.section || '';
        const cmp = secA.localeCompare(secB);
        if (cmp !== 0) return cmp;
      }
      return (a.student_name || '').localeCompare(b.student_name || '');
    }));
  };

  const dismissSession = async (sessionId) => {
    await supabase.from('live_sessions').update({ status: 'finished' }).eq('id', sessionId);
    setLiveSessions(prev => prev.filter(s => s.id !== sessionId));
  };

  const clearStuckSessions = async () => {
    const stuckIds = liveSessions
      .filter(s => results.some(r => r.student_id === s.student_id && r.exam_id === s.exam_id))
      .map(s => s.id);
    if (stuckIds.length === 0) return alert("No stuck sessions found.");
    await supabase.from('live_sessions').update({ status: 'finished' }).in('id', stuckIds);
    setLiveSessions(prev => prev.filter(s => !stuckIds.includes(s.id)));
  };

  // --- QUESTION MANAGEMENT FUNCTIONS ---
  const loadQuestionList = async (examId) => {
    if (!examId) { setQList([]); return; }
    setQLoading(true);
    const { data } = await supabase.from('questions').select('*').eq('exam_id', examId).order('id', { ascending: true });
    setQList(data || []);
    setQLoading(false);
  };

  const handleQExamChange = (examId) => {
    setQExamId(examId);
    setEditingQ(null);
    setQForm(emptyQ);
    loadQuestionList(examId);
  };

  const saveQuestion = async () => {
    if (!qExamId) return;
    if (!qForm.question_text.trim()) return alert('Question text is required.');
    if (!qForm.choice_a.trim() || !qForm.choice_b.trim() || !qForm.choice_c.trim() || !qForm.choice_d.trim())
      return alert('All four choices are required.');

    setQSaving(true);
    const payload = {
      exam_id: qExamId,
      question_text: qForm.question_text.trim(),
      choice_a: qForm.choice_a.trim(),
      choice_b: qForm.choice_b.trim(),
      choice_c: qForm.choice_c.trim(),
      choice_d: qForm.choice_d.trim(),
      correct_answer: Number(qForm.correct_answer),
    };

    let error;
    if (editingQ) {
      ({ error } = await supabase.from('questions').update(payload).eq('id', editingQ.id));
    } else {
      ({ error } = await supabase.from('questions').insert([payload]));
    }

    if (error) {
      alert('Error saving question: ' + error.message);
    } else {
      setEditingQ(null);
      setQForm(emptyQ);
      loadQuestionList(qExamId);
    }
    setQSaving(false);
  };

  const deleteQuestion = async (questionId) => {
    if (!window.confirm('Delete this question permanently?')) return;
    const { error } = await supabase.from('questions').delete().eq('id', questionId);
    if (error) alert('Error deleting question: ' + error.message);
    else loadQuestionList(qExamId);
  };

  const startEditQuestion = (q) => {
    setEditingQ(q);
    setQForm({
      question_text: q.question_text,
      choice_a: q.choice_a,
      choice_b: q.choice_b,
      choice_c: q.choice_c,
      choice_d: q.choice_d,
      correct_answer: Number(q.correct_answer),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

async function fetchDashboardData() {
    setIsLoading(true);
    try {
      const { data: resultsData } = await supabase.from('results').select('*');
      const { data: examsData } = await supabase.from('exams').select('id, title, is_open, duration_minutes, target_section, exam_password').order('created_at', { ascending: true });
      
      const { data: studentsData, error: studentError } = await supabase.from('users').select('id, full_name, section');
      if (studentError) console.error("Supabase students error:", studentError);

      const dict = {};
      const times = {};
      const secs = {};
      const passwords = {};
      if (examsData) {
        examsData.forEach(e => {
          dict[e.id] = e.title;
          times[e.id] = e.duration_minutes;
          secs[e.id] = e.target_section || '';
          passwords[e.id] = e.exam_password || '';
        });
        setExamsList(examsData);
        setExamsDict(dict);
        setEditingTimes(times);
        setEditingSections(secs);
        setEditingPasswords(passwords);
      }

      const studentDict = {};
      const studentSecs = {}; 
      
      if (studentsData) {
        // FIX: We make a clean, unlocked copy of the list using [...array] before sorting
        const safeStudentsCopy = [...studentsData];
        safeStudentsCopy.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));

        safeStudentsCopy.forEach(s => {
          studentDict[s.id] = { 
            name: s.full_name || 'Unknown', 
            section: s.section || 'Unknown' 
          };
          studentSecs[s.id] = s.section || ''; 
        });

        setStudentsList(safeStudentsCopy); // Use the safe copy here
        setEditingStudentSections(studentSecs); 
      }
      
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

  // --- NEW: Create Exam Function ---
  const createExam = async () => {
    if (!newTitle || !targetSection) return alert("Title and Section are required!");
    setIsLoading(true);

    const { error } = await supabase.from('exams').insert([{ 
      title: newTitle, 
      target_section: targetSection,
      is_open: false, // Exams default to closed when created
      duration_minutes: 60 // Default 60 mins
    }]);

    if (error) {
      console.error(error);
      alert("Error creating exam.");
    } else {
      setNewTitle(''); // Clears the input box
      setTargetSection(''); // Clears the section box
      fetchDashboardData(); // Refreshes the list instantly
      alert("Exam created successfully!");
    }
    setIsLoading(false);
  };

  // --- NEW: Delete Exam ---
  const deleteExam = async (examId) => {
    if (window.confirm("🚨 Are you sure? This will delete the exam, its questions, and all student results associated with it forever!")) {
      // Delete dependents first so no orphaned rows remain regardless of DB cascade config
      await supabase.from('live_sessions').delete().eq('exam_id', examId);
      await supabase.from('results').delete().eq('exam_id', examId);
      await supabase.from('questions').delete().eq('exam_id', examId);
      const { error } = await supabase.from('exams').delete().eq('id', examId);
      if (error) {
        alert("Error deleting exam: " + error.message);
      } else {
        fetchDashboardData();
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

    const { error } = await supabase.from('exams').update({ duration_minutes: parseInt(newTime) }).eq('id', examId);
    
    if (error) {
      alert("Error saving time limit. Please try again.");
      console.error(error);
      return;
    }

    alert("Time limit updated successfully!");
    setExamsList(prev => prev.map(e => e.id === examId ? { ...e, duration_minutes: parseInt(newTime) } : e));
  };

  // --- NEW: Save Section Changes ---
  const saveSection = async (examId) => {
    const newSection = editingSections[examId] || '';
    
    const { error } = await supabase.from('exams').update({ target_section: newSection }).eq('id', examId);

    if (error) {
      alert("Error saving section. Please try again.");
      console.error(error);
      return;
    }

    alert("Section updated successfully!");
    setExamsList(prev => prev.map(e => e.id === examId ? { ...e, target_section: newSection } : e));
  };

  const savePassword = async (examId) => {
    const newPassword = editingPasswords[examId] || '';
    const { error } = await supabase.from('exams').update({
      exam_password: newPassword || null,
      has_password: !!newPassword,
    }).eq('id', examId);
    if (error) {
      alert("Error saving password. Please try again.");
      console.error(error);
      return;
    }
    alert(newPassword ? "Exam password saved!" : "Password cleared — no password required.");
    setExamsList(prev => prev.map(e => e.id === examId ? { ...e, exam_password: newPassword || null, has_password: !!newPassword } : e));
  };

  // --- NEW: Save Student Section ---
  const saveStudentSection = async (studentId) => {
    const newSection = editingStudentSections[studentId] || '';

    const { error } = await supabase.from('users').update({ section: newSection }).eq('id', studentId);

    if (error) {
      alert("Error updating student. Please try again.");
      console.error(error);
      return;
    }

    alert("Student section updated successfully!");
    setStudentsList(prev => prev.map(s => s.id === studentId ? { ...s, section: newSection } : s));
    setStudents(prev => ({
      ...prev,
      [studentId]: { ...prev[studentId], section: newSection }
    }));
  };

  const batchUpdateSection = async () => {
    if (selectedStudentIds.size === 0) return alert("Please select at least one student.");
    if (!batchSection.trim()) return alert("Please enter a section name.");
    if (!window.confirm(`Assign "${batchSection}" to ${selectedStudentIds.size} student(s)?`)) return;

    setIsBatchSaving(true);
    const ids = [...selectedStudentIds];
    const { error } = await supabase.from('users').update({ section: batchSection.trim() }).in('id', ids);

    if (error) {
      alert("Error updating students: " + error.message);
    } else {
      setStudentsList(prev => prev.map(s => selectedStudentIds.has(s.id) ? { ...s, section: batchSection.trim() } : s));
      setStudents(prev => {
        const updated = { ...prev };
        ids.forEach(id => { if (updated[id]) updated[id] = { ...updated[id], section: batchSection.trim() }; });
        return updated;
      });
      setEditingStudentSections(prev => {
        const updated = { ...prev };
        ids.forEach(id => { updated[id] = batchSection.trim(); });
        return updated;
      });
      setSelectedStudentIds(new Set());
      setBatchSection('');
    }
    setIsBatchSaving(false);
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
      if (resultSort === 'score_desc') {
        const pctA = a.total_items > 0 ? a.score / a.total_items : 0;
        const pctB = b.total_items > 0 ? b.score / b.total_items : 0;
        return pctB - pctA;
      }
      if (resultSort === 'score_asc') {
        const pctA = a.total_items > 0 ? a.score / a.total_items : 0;
        const pctB = b.total_items > 0 ? b.score / b.total_items : 0;
        return pctA - pctB;
      }
      if (resultSort === 'name') {
        const nameA = students[a.student_id]?.name || '';
        const nameB = students[b.student_id]?.name || '';
        return nameA.localeCompare(nameB);
      }
      // default: section
      const secA = students[a.student_id]?.section || 'Z';
      const secB = students[b.student_id]?.section || 'Z';
      const cmp = secA.localeCompare(secB);
      if (cmp !== 0) return cmp;
      return (students[a.student_id]?.name || '').localeCompare(students[b.student_id]?.name || '');
    });

  const uniqueSections = ['All', ...new Set(Object.values(students).map(s => s.section).filter(Boolean))];

  const exportCSV = () => {
    const headers = ['Name', 'Section', 'Exam', 'Score', 'Total Items', 'Percentage', 'Time Taken (s)', 'Violations'];
    const rows = filteredAndSortedResults.map(row => {
      const student = students[row.student_id] || { name: 'Unknown', section: 'Unknown' };
      const examTitle = examsDict[row.exam_id] || 'Unknown Exam';
      const pct = row.total_items > 0 ? Math.round((row.score / row.total_items) * 100) : 0;
      return [
        `"${student.name}"`,
        `"${student.section}"`,
        `"${examTitle}"`,
        row.score,
        row.total_items,
        `${pct}%`,
        row.time_taken_seconds ?? '',
        row.tab_switches ?? 0,
      ].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const examLabel = selectedExam !== 'All' ? (examsDict[selectedExam] || 'exam').replace(/\s+/g, '_') : 'all_exams';
    const sectionLabel = selectedSection !== 'All' ? selectedSection.replace(/\s+/g, '_') : 'all_sections';
    a.download = `results_${examLabel}_${sectionLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center', color: 'var(--text-3)' }}>
        <div style={{ fontSize: '36px', marginBottom: '12px' }}>⏳</div>
        <p style={{ margin: 0, fontWeight: 600, fontSize: '16px' }}>Loading Dashboard…</p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Header */}
      <header className="admin-header" style={{
        background: 'linear-gradient(110deg, var(--navy-dark) 0%, var(--navy) 55%, var(--navy-mid) 100%)',
        borderBottom: '3px solid var(--gold)',
        padding: '16px 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        boxShadow: 'var(--s-lg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <img src="/patts-logo.png" alt="PATTS" style={{ height: '44px', width: 'auto', objectFit: 'contain' }} />
          <div>
            <h1 style={{ margin: 0, color: 'white', fontSize: '18px', fontWeight: 700 }}>Instructor Dashboard</h1>
            {lastRefreshed && <p className="admin-header-subtitle" style={{ margin: '2px 0 0', color: 'rgba(255,255,255,.45)', fontSize: '12px' }}>Updated {lastRefreshed}</p>}
          </div>
        </div>
        <div className="admin-header-btns" style={{ display: 'flex', gap: '10px' }}>
          <button
            style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.25)', color: 'white', width: 'auto', padding: '9px 18px', fontSize: '13px', opacity: isRefreshing ? 0.7 : 1 }}
            disabled={isRefreshing}
            onClick={async () => {
              setIsRefreshing(true);
              await Promise.all([fetchDashboardData(), fetchLiveSessions()]);
              setLastRefreshed(new Date().toLocaleTimeString());
              setIsRefreshing(false);
            }}
          >
            {isRefreshing ? '⟳ Refreshing…' : '⟳ Refresh'}
          </button>
          <button style={{ background: 'rgba(231,76,60,.8)', border: '1px solid rgba(231,76,60,.5)', color: 'white', width: 'auto', padding: '9px 18px', fontSize: '13px' }} onClick={onLogout}>
            Close Portal
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="admin-tabs" style={{ background: 'var(--white)', borderBottom: '1px solid var(--border)', padding: '0 32px', boxShadow: 'var(--s-xs)' }}>
        <div style={{ display: 'flex', gap: '2px', overflowX: 'auto' }}>
          {[
            { id: 'results',   label: '📊 Results',   },
            { id: 'manage',    label: '⚙️ Manage Exams' },
            { id: 'students',  label: '🧑‍🎓 Students'  },
            { id: 'live',      label: '🔴 Live Monitor'},
            { id: 'attendance',label: '📋 Attendance'  },
            { id: 'questions', label: '📝 Questions'   },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: 'none', border: 'none', color: activeTab === tab.id ? 'var(--navy)' : 'var(--text-3)',
                fontWeight: activeTab === tab.id ? 700 : 500,
                fontSize: '13.5px', padding: '14px 18px', borderRadius: 0, width: 'auto',
                borderBottom: activeTab === tab.id ? '3px solid var(--navy)' : '3px solid transparent',
                transform: 'none', boxShadow: 'none', whiteSpace: 'nowrap',
                transition: 'color var(--t-fast), border-color var(--t-fast)',
                marginBottom: '-1px',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="admin-content" style={{ padding: '28px 32px' }}>
      <div style={{ background: 'var(--white)', borderRadius: 'var(--r-lg)', padding: '24px', color: 'var(--text-1)', boxShadow: 'var(--s-sm)', border: '1px solid var(--border)' }}>
        
        {/* --- TAB 1: STUDENT RESULTS --- */}
        {activeTab === 'results' && (
          <>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', padding: '15px', background: '#F8F9FA', borderRadius: '8px', border: '1px solid #ddd', flexWrap: 'wrap', alignItems: 'flex-end' }}>
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
              <div>
                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Sort by:</label>
                <select style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} value={resultSort} onChange={e => setResultSort(e.target.value)}>
                  <option value="section">Section (A–Z)</option>
                  <option value="name">Name (A–Z)</option>
                  <option value="score_desc">Score (Highest First)</option>
                  <option value="score_asc">Score (Lowest First)</option>
                </select>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                <span style={{ background: '#0A2342', color: 'white', padding: '5px 14px', borderRadius: '20px', fontWeight: 'bold', fontSize: '14px' }}>
                  {filteredAndSortedResults.length} student{filteredAndSortedResults.length !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={exportCSV}
                  style={{ background: '#27AE60', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}
                >
                  ⬇️ Export CSV
                </button>
              </div>
            </div>

            <div className="table-scroll">
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
                  <tr><td colSpan="7" style={{ padding: '20px', textAlign: 'center' }}>No results found.</td></tr>
                ) : (
                  filteredAndSortedResults.map((row, index) => {
                    const student = students[row.student_id] || { name: 'Unknown', section: 'Unknown' };
                    const examTitle = examsDict[row.exam_id] || 'Unknown Exam';
                    const percentage = row.total_items > 0 ? Math.round((row.score / row.total_items) * 100) : 0;
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
            </div>{/* end table-scroll */}
          </>
        )}

{/* --- TAB 2: MANAGE EXAMS --- */}
        {activeTab === 'manage' && (
          <>

            <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#0A2342', color: 'white' }}>
              <th style={{ padding: '12px' }}>Exam Title</th>
              <th style={{ padding: '12px' }}>Target Section</th>
              <th style={{ padding: '12px' }}>Status</th>
              <th style={{ padding: '12px' }}>Time Limit</th>
              <th style={{ padding: '12px' }}>Exam Password</th>
              <th style={{ padding: '12px' }}>Actions</th>
            </tr>
            </thead>
           <tbody>
            {examsList.map((exam) => (
              <tr key={exam.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '12px', fontWeight: 'bold' }}>{exam.title}</td>

               {/* UPGRADED: Editable Section Field */}
                <td style={{ padding: '12px' }}>
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={editingSections[exam.id] !== undefined ? editingSections[exam.id] : ''}
                      onChange={(e) => setEditingSections(prev => ({ ...prev, [exam.id]: e.target.value }))}
                      placeholder="e.g. Aero 101, Aero 102"
                      style={{ width: '160px', padding: '6px', border: '1px solid #ccc', borderRadius: '4px' }}
                    />
                    <button 
                      onClick={() => saveSection(exam.id)}
                      style={{ background: '#8E44AD', color: 'white', border: 'none', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', opacity: editingSections[exam.id] !== examsList.find(e => e.id === exam.id).target_section ? 1 : 0.5 }}
                    >
                      Save
                    </button>
                  </div>
                </td>

                {/* Toggle Switch */}
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
                </td>

                {/* Time Input */}
                <td style={{ padding: '12px' }}>
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                    <input 
                      type="number" 
                      value={editingTimes[exam.id] || ''} 
                      onChange={(e) => handleTimeChange(exam.id, e.target.value)}
                      style={{ width: '60px', padding: '6px', border: '1px solid #ccc' }}
                    />
                    <span>min</span>
                    <button 
                      onClick={() => saveTimeLimit(exam.id)}
                      style={{ background: '#0A2342', color: 'white', border: 'none', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', opacity: editingTimes[exam.id] != examsList.find(e => e.id === exam.id).duration_minutes ? 1 : 0.5 }}
                    >
                      Save
                    </button>
                  </div>
                </td>

                {/* Exam Password */}
                <td style={{ padding: '12px' }}>
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={editingPasswords[exam.id] !== undefined ? editingPasswords[exam.id] : ''}
                      onChange={(e) => setEditingPasswords(prev => ({ ...prev, [exam.id]: e.target.value }))}
                      placeholder="No password"
                      style={{ width: '120px', padding: '6px', border: '1px solid #ccc', borderRadius: '4px', fontFamily: 'monospace', letterSpacing: '1px' }}
                    />
                    <button
                      onClick={() => savePassword(exam.id)}
                      style={{ background: '#E67E22', color: 'white', border: 'none', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', opacity: editingPasswords[exam.id] !== (exam.exam_password || '') ? 1 : 0.5 }}
                    >
                      Save
                    </button>
                  </div>
                  <span style={{ fontSize: '11px', color: '#999', marginTop: '3px', display: 'block' }}>
                    {exam.exam_password ? '🔒 Password set' : '🔓 No password'}
                  </span>
                </td>

                {/* NEW: Action Buttons (Stats and Delete) */}
                <td style={{ padding: '12px', display: 'flex', gap: '8px' }}>
                  <button 
                    onClick={() => openExamStats(exam.id)}
                    style={{ background: '#8E44AD', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    📊 Stats
                  </button>
                  <button 
                    onClick={() => deleteExam(exam.id)}
                    style={{ background: '#E74C3C', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    🗑️ Delete
                  </button>
                </td>
              </tr>
))}
          </tbody>
          </table>
          </div>{/* end table-scroll */}
        </>
      )}

      {/* --- TAB 3: MANAGE STUDENTS --- */}
        {activeTab === 'students' && (
          <div style={{ background: '#F8F9FA', padding: '20px', borderRadius: '8px', border: '1px solid #ddd' }}>
            <h3 style={{ marginTop: 0, color: '#0A2342' }}>🧑‍🎓 Full Class Roster</h3>

            {/* BATCH EDIT BAR */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', padding: '15px', background: selectedStudentIds.size > 0 ? '#EAF4FB' : '#fff', border: `2px solid ${selectedStudentIds.size > 0 ? '#3498DB' : '#ddd'}`, borderRadius: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 'bold', color: '#0A2342', minWidth: '160px' }}>
                {selectedStudentIds.size > 0 ? `${selectedStudentIds.size} student(s) selected` : 'Select students to batch edit'}
              </span>
              <input
                type="text"
                value={batchSection}
                onChange={e => setBatchSection(e.target.value)}
                placeholder="New section (e.g. Aero 101)"
                style={{ flex: 1, minWidth: '180px', padding: '9px 12px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '14px' }}
              />
              <button
                onClick={batchUpdateSection}
                disabled={isBatchSaving || selectedStudentIds.size === 0 || !batchSection.trim()}
                style={{ background: selectedStudentIds.size > 0 && batchSection.trim() ? '#27AE60' : '#aaa', color: 'white', border: 'none', padding: '9px 20px', borderRadius: '6px', fontWeight: 'bold', cursor: selectedStudentIds.size > 0 && batchSection.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}
              >
                {isBatchSaving ? 'Saving...' : 'Apply to Selected'}
              </button>
              {selectedStudentIds.size > 0 && (
                <button
                  onClick={() => setSelectedStudentIds(new Set())}
                  style={{ background: '#E74C3C', color: 'white', border: 'none', padding: '9px 14px', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Clear
                </button>
              )}
            </div>

            <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#0A2342', color: 'white' }}>
                  <th style={{ padding: '12px', width: '40px' }}>
                    <input
                      type="checkbox"
                      style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      checked={studentsList.length > 0 && selectedStudentIds.size === studentsList.length}
                      onChange={e => {
                        if (e.target.checked) setSelectedStudentIds(new Set(studentsList.map(s => s.id)));
                        else setSelectedStudentIds(new Set());
                      }}
                    />
                  </th>
                  <th style={{ padding: '12px' }}>Student Name</th>
                  <th style={{ padding: '12px' }}>Current Section</th>
                  <th style={{ padding: '12px' }}>Edit Section (Individual)</th>
                </tr>
              </thead>
              <tbody>
                {studentsList.map((student, index) => {
                  const isChecked = selectedStudentIds.has(student.id);
                  return (
                    <tr
                      key={student.id}
                      style={{ borderBottom: '1px solid #ddd', background: isChecked ? '#D6EAF8' : index % 2 === 0 ? '#fdfdfd' : 'white', cursor: 'pointer' }}
                      onClick={() => {
                        setSelectedStudentIds(prev => {
                          const next = new Set(prev);
                          if (next.has(student.id)) next.delete(student.id);
                          else next.add(student.id);
                          return next;
                        });
                      }}
                    >
                      <td style={{ padding: '12px' }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          checked={isChecked}
                          onChange={() => {
                            setSelectedStudentIds(prev => {
                              const next = new Set(prev);
                              if (next.has(student.id)) next.delete(student.id);
                              else next.add(student.id);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td style={{ padding: '12px', fontWeight: 'bold', color: '#333' }}>
                        {student.full_name || 'Unknown'}
                      </td>
                      <td style={{ padding: '12px', color: '#8E44AD', fontWeight: 'bold' }}>
                        {student.section || 'No Section'}
                      </td>
                      <td style={{ padding: '12px' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                          <input
                            type="text"
                            value={editingStudentSections[student.id] !== undefined ? editingStudentSections[student.id] : ''}
                            onChange={(e) => setEditingStudentSections(prev => ({ ...prev, [student.id]: e.target.value }))}
                            placeholder="e.g. Aero 101"
                            style={{ width: '180px', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
                          />
                          <button
                            onClick={() => saveStudentSection(student.id)}
                            style={{ background: '#0A2342', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', opacity: editingStudentSections[student.id] !== student.section ? 1 : 0.5 }}
                          >
                            Save
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>{/* end table-scroll */}
          </div>
        )}

{/* --- TAB 4: LIVE MONITOR --- */}
        {activeTab === 'live' && (() => {
          // Hide sessions only when BOTH a result exists AND the session is not actively locked/being watched
          // Keeps students visible if they are still in the exam even if a stale result exists
          const activeSessions = liveSessions.filter(s => {
            const hasResult = results.some(r => r.student_id === s.student_id && r.exam_id === s.exam_id);
            // If locked, always keep visible so instructor can manage them
            if (s.status === 'locked') return true;
            return !hasResult;
          });
          const stuckCount = liveSessions.length - activeSessions.length;

          return (
            <div style={{ background: '#FFF9F9', padding: '20px', borderRadius: '8px', border: '2px solid #E74C3C' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '10px' }}>
                <h3 style={{ margin: 0, color: '#C0392B', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ width: '12px', height: '12px', background: '#E74C3C', borderRadius: '50%', display: 'inline-block' }}></span>
                  Live Exam Monitor
                  <span style={{ background: '#E74C3C', color: 'white', padding: '3px 12px', borderRadius: '20px', fontSize: '14px', fontWeight: 'bold' }}>
                    {activeSessions.length} active
                  </span>
                </h3>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: '#555', fontWeight: 'bold' }}>Sort:</span>
                  <button
                    onClick={() => applyLiveSort('name')}
                    style={{ background: liveSort === 'name' ? '#0A2342' : '#ddd', color: liveSort === 'name' ? 'white' : '#333', border: 'none', padding: '6px 14px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                  >
                    A–Z Name
                  </button>
                  <button
                    onClick={() => applyLiveSort('section')}
                    style={{ background: liveSort === 'section' ? '#0A2342' : '#ddd', color: liveSort === 'section' ? 'white' : '#333', border: 'none', padding: '6px 14px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                  >
                    By Section
                  </button>
                  {stuckCount > 0 && (
                    <button
                      onClick={clearStuckSessions}
                      style={{ background: '#8E44AD', color: 'white', border: 'none', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                    >
                      Clear {stuckCount} Finished
                    </button>
                  )}
                </div>
              </div>
              <p style={{ color: '#555', marginBottom: '20px' }}>Order is locked once set — student data updates in place without shuffling rows.</p>

              <div className="table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#C0392B', color: 'white' }}>
                    <th style={{ padding: '12px' }}>Student Name</th>
                    <th style={{ padding: '12px' }}>Exam Taking</th>
                    <th style={{ padding: '12px' }}>Status</th>
                    <th style={{ padding: '12px' }}>Questions Answered</th>
                    <th style={{ padding: '12px' }}>Tab Violations</th>
                    <th style={{ padding: '12px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSessions.length === 0 ? (
                    <tr><td colSpan="6" style={{ padding: '20px', textAlign: 'center' }}>No students currently taking an exam.</td></tr>
                  ) : (
                    activeSessions.map(session => (
                      <tr key={session.id} style={{ borderBottom: '1px solid #ddd', background: session.status === 'locked' ? '#FADBD8' : 'white' }}>
                        <td style={{ padding: '12px', fontWeight: 'bold', fontSize: '16px' }}>{session.student_name}</td>
                        <td style={{ padding: '12px', color: '#0A2342', fontWeight: 'bold' }}>
                          {examsDict[session.exam_id] || '—'}
                        </td>
                        <td style={{ padding: '12px', fontWeight: 'bold', color: session.status === 'locked' ? '#E74C3C' : '#27AE60' }}>
                          {session.status.toUpperCase()}
                        </td>
                        <td style={{ padding: '12px', fontWeight: 'bold', fontSize: '16px' }}>{session.answers_count}</td>
                        <td style={{ padding: '12px', fontWeight: 'bold', color: session.violation_count >= 2 ? '#E74C3C' : (session.violation_count === 1 ? '#F39C12' : '#27AE60') }}>
                          {session.violation_count}
                        </td>
                        <td style={{ padding: '12px', display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => toggleStudentLock(session.id, session.status)}
                            style={{ background: session.status === 'locked' ? '#27AE60' : '#E74C3C', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                          >
                            {session.status === 'locked' ? '🔓 UNLOCK' : '🔒 LOCK'}
                          </button>
                          <button
                            onClick={() => dismissSession(session.id)}
                            style={{ background: '#95A5A6', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                          >
                            Dismiss
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>{/* end table-scroll */}
            </div>
          );
        })()}

      {/* --- TAB 5: ATTENDANCE --- */}
      {activeTab === 'attendance' && (() => {
        const examObj = examsList.find(e => e.id === attendanceExam);

        // Students enrolled in this exam's sections
        let eligibleStudents = studentsList;
        if (examObj?.target_section) {
          const examSections = examObj.target_section.split(',').map(s => s.trim());
          eligibleStudents = studentsList.filter(s => {
            if (!s.section) return false;
            const studentSections = s.section.split(',').map(x => x.trim());
            return studentSections.some(sec => examSections.includes(sec));
          });
        }

        if (attendanceSection !== 'All') {
          eligibleStudents = eligibleStudents.filter(s => {
            if (!s.section) return false;
            return s.section.split(',').map(x => x.trim()).includes(attendanceSection);
          });
        }

        const getStatus = (studentId) => {
          if (!attendanceExam) return null;
          if (results.some(r => r.student_id === studentId && r.exam_id === attendanceExam)) return 'done';
          const session = liveSessions.find(ls => ls.student_id === studentId && ls.exam_id === attendanceExam);
          if (session) return session.status === 'locked' ? 'locked' : 'active';
          return 'absent';
        };

        const statusCounts = { done: 0, active: 0, locked: 0, absent: 0 };
        eligibleStudents.forEach(s => {
          const st = getStatus(s.id);
          if (st) statusCounts[st]++;
        });

        const sectionOptions = examObj?.target_section
          ? ['All', ...new Set(examObj.target_section.split(',').map(s => s.trim()))]
          : ['All'];

        const exportAttendanceCSV = () => {
          const headers = ['Student Name', 'Section', 'Status'];
          const rows = eligibleStudents.map(s => {
            const st = getStatus(s.id);
            const label = st === 'done' ? 'Done' : st === 'active' ? 'Taking Exam' : st === 'locked' ? 'LOCKED' : 'Absent';
            return [`"${s.full_name}"`, `"${s.section || ''}"`, `"${label}"`].join(',');
          });
          const csv = [headers.join(','), ...rows].join('\n');
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `attendance_${(examObj?.title || 'exam').replace(/\s+/g, '_')}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        };

        return (
          <div style={{ background: '#F8F0FF', padding: '20px', borderRadius: '8px', border: '2px solid #8E44AD' }}>
            <h3 style={{ margin: '0 0 16px 0', color: '#6C3483' }}>📋 Attendance Overview</h3>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#333' }}>Select Exam:</label>
                <select
                  value={attendanceExam}
                  onChange={e => { setAttendanceExam(e.target.value); setAttendanceSection('All'); }}
                  style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '14px' }}
                >
                  <option value="">— Choose an exam —</option>
                  {examsList.map(e => (
                    <option key={e.id} value={e.id}>{e.title}</option>
                  ))}
                </select>
              </div>
              {attendanceExam && (
                <div>
                  <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#333' }}>Filter by Section:</label>
                  <select
                    value={attendanceSection}
                    onChange={e => setAttendanceSection(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '14px' }}
                  >
                    {sectionOptions.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                  </select>
                </div>
              )}
              {attendanceExam && eligibleStudents.length > 0 && (
                <button
                  onClick={exportAttendanceCSV}
                  style={{ background: '#27AE60', color: 'white', border: 'none', padding: '9px 18px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}
                >
                  ⬇️ Export CSV
                </button>
              )}
            </div>

            {!attendanceExam ? (
              <p style={{ color: '#888', textAlign: 'center', padding: '40px' }}>Select an exam above to see attendance.</p>
            ) : (
              <>
                {/* Summary chips */}
                <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
                  {[
                    { label: 'Total', count: eligibleStudents.length, color: '#0A2342', bg: '#EBF5FB' },
                    { label: 'Done', count: statusCounts.done, color: '#1E8449', bg: '#D5F5E3' },
                    { label: 'Taking Exam', count: statusCounts.active, color: '#E67E22', bg: '#FEF9E7' },
                    { label: 'Locked', count: statusCounts.locked, color: '#E74C3C', bg: '#FADBD8' },
                    { label: 'Absent', count: statusCounts.absent, color: '#7F8C8D', bg: '#F2F3F4' },
                  ].map(chip => (
                    <div key={chip.label} style={{ background: chip.bg, border: `1px solid ${chip.color}`, borderRadius: '20px', padding: '6px 18px', fontWeight: 'bold', color: chip.color, fontSize: '14px' }}>
                      {chip.label}: {chip.count}
                    </div>
                  ))}
                </div>

                {eligibleStudents.length === 0 ? (
                  <p style={{ color: '#888', textAlign: 'center', padding: '20px' }}>No students found for this exam's section(s).</p>
                ) : (
                  <div className="table-scroll">
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: '#6C3483', color: 'white' }}>
                        <th style={{ padding: '12px' }}>#</th>
                        <th style={{ padding: '12px' }}>Student Name</th>
                        <th style={{ padding: '12px' }}>Section</th>
                        <th style={{ padding: '12px' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligibleStudents.map((s, idx) => {
                        const st = getStatus(s.id);
                        const statusConfig = {
                          done:   { label: '✅ Done',        color: '#1E8449', bg: '#D5F5E3' },
                          active: { label: '📝 Taking Exam', color: '#E67E22', bg: '#FEF9E7' },
                          locked: { label: '🔒 LOCKED',      color: '#E74C3C', bg: '#FADBD8' },
                          absent: { label: '❌ Absent',       color: '#7F8C8D', bg: 'white'   },
                        }[st] || { label: '—', color: '#999', bg: 'white' };

                        return (
                          <tr key={s.id} style={{ borderBottom: '1px solid #ddd', background: statusConfig.bg }}>
                            <td style={{ padding: '12px', color: '#999' }}>{idx + 1}</td>
                            <td style={{ padding: '12px', fontWeight: 'bold', color: '#333' }}>{s.full_name || 'Unknown'}</td>
                            <td style={{ padding: '12px', color: '#555' }}>{s.section || '—'}</td>
                            <td style={{ padding: '12px', fontWeight: 'bold', color: statusConfig.color }}>{statusConfig.label}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* --- TAB 6: QUESTION MANAGEMENT --- */}
      {activeTab === 'questions' && (
        <div style={{ background: '#F0FFF4', padding: '20px', borderRadius: '8px', border: '2px solid #27AE60' }}>
          <h3 style={{ margin: '0 0 16px 0', color: '#1E8449' }}>📝 Question Management</h3>

          {/* Exam selector */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '6px', color: '#333' }}>Select Exam to Manage:</label>
            <select
              value={qExamId}
              onChange={e => handleQExamChange(e.target.value)}
              style={{ padding: '10px 14px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '15px', minWidth: '280px' }}
            >
              <option value="">— Choose an exam —</option>
              {examsList.map(e => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </select>
          </div>

          {qExamId && (
            <>
              {/* Add / Edit Form */}
              <div style={{ background: 'white', padding: '20px', borderRadius: '8px', border: '1px solid #A9DFBF', marginBottom: '24px' }}>
                <h4 style={{ margin: '0 0 16px 0', color: '#1E8449' }}>
                  {editingQ ? `✏️ Editing Question #${qList.findIndex(q => q.id === editingQ.id) + 1}` : '➕ Add New Question'}
                </h4>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>Question Text:</label>
                  <textarea
                    value={qForm.question_text}
                    onChange={e => setQForm(f => ({ ...f, question_text: e.target.value }))}
                    placeholder="Enter the question..."
                    rows={3}
                    style={{ width: '100%', padding: '10px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box', resize: 'vertical' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                  {['a', 'b', 'c', 'd'].map((letter, i) => (
                    <div key={letter}>
                      <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
                        Choice {letter.toUpperCase()}
                        {Number(qForm.correct_answer) === i && (
                          <span style={{ marginLeft: '8px', background: '#27AE60', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold' }}>✓ Correct</span>
                        )}
                      </label>
                      <input
                        type="text"
                        value={qForm[`choice_${letter}`]}
                        onChange={e => setQForm(f => ({ ...f, [`choice_${letter}`]: e.target.value }))}
                        placeholder={`Choice ${letter.toUpperCase()}...`}
                        style={{ width: '100%', padding: '9px', border: `2px solid ${Number(qForm.correct_answer) === i ? '#27AE60' : '#ccc'}`, borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' }}
                      />
                    </div>
                  ))}
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Correct Answer:</label>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    {['A', 'B', 'C', 'D'].map((letter, i) => (
                      <label key={letter} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: Number(qForm.correct_answer) === i ? 'bold' : 'normal', color: Number(qForm.correct_answer) === i ? '#1E8449' : '#333' }}>
                        <input
                          type="radio"
                          name="correct_answer"
                          value={i}
                          checked={Number(qForm.correct_answer) === i}
                          onChange={() => setQForm(f => ({ ...f, correct_answer: i }))}
                          style={{ width: '16px', height: '16px' }}
                        />
                        Choice {letter}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={saveQuestion}
                    disabled={qSaving}
                    style={{ background: '#27AE60', color: 'white', border: 'none', padding: '10px 24px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', opacity: qSaving ? 0.7 : 1 }}
                  >
                    {qSaving ? 'Saving...' : editingQ ? 'Update Question' : 'Add Question'}
                  </button>
                  {editingQ && (
                    <button
                      onClick={() => { setEditingQ(null); setQForm(emptyQ); }}
                      style={{ background: '#95A5A6', color: 'white', border: 'none', padding: '10px 18px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* Question List */}
              {qLoading ? (
                <p style={{ textAlign: 'center', color: '#555' }}>Loading questions...</p>
              ) : qList.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#888', padding: '20px' }}>No questions yet. Add the first one above.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontWeight: 'bold', color: '#1E8449' }}>{qList.length} question{qList.length !== 1 ? 's' : ''} total</span>
                  </div>
                  <div style={{ display: 'grid', gap: '12px' }}>
                    {qList.map((q, idx) => (
                      <div
                        key={q.id}
                        style={{
                          background: editingQ?.id === q.id ? '#EAF8EE' : 'white',
                          border: `2px solid ${editingQ?.id === q.id ? '#27AE60' : '#ddd'}`,
                          borderRadius: '8px',
                          padding: '16px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                          <p style={{ margin: '0 0 10px 0', fontWeight: 'bold', color: '#333', flex: 1 }}>
                            <span style={{ color: '#27AE60', marginRight: '8px' }}>{idx + 1}.</span>
                            {q.question_text}
                          </p>
                          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                            <button
                              onClick={() => startEditQuestion(q)}
                              style={{ background: '#3498DB', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                            >
                              ✏️ Edit
                            </button>
                            <button
                              onClick={() => deleteQuestion(q.id)}
                              style={{ background: '#E74C3C', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                          {['a', 'b', 'c', 'd'].map((letter, i) => (
                            <div
                              key={letter}
                              style={{
                                padding: '6px 10px',
                                borderRadius: '4px',
                                background: Number(q.correct_answer) === i ? '#D5F5E3' : '#F8F9FA',
                                border: `1px solid ${Number(q.correct_answer) === i ? '#27AE60' : '#ddd'}`,
                                fontSize: '13px',
                                color: Number(q.correct_answer) === i ? '#1E8449' : '#555',
                                fontWeight: Number(q.correct_answer) === i ? 'bold' : 'normal',
                              }}
                            >
                              <strong>{letter.toUpperCase()}.</strong> {q[`choice_${letter}`]}
                              {Number(q.correct_answer) === i && ' ✓'}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      </div>
      </div>{/* end padding wrapper */}

{/* Loading overlay for question fetches — replaces the old global isLoading flash */}
      {isLoadingQuestions && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
          <div style={{ background: 'white', padding: '30px 50px', borderRadius: '12px', textAlign: 'center', fontSize: '18px', fontWeight: 'bold', color: '#0A2342' }}>
            Loading questions…
          </div>
        </div>
      )}

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
                  {viewingStudent.violation_logs.map((log, i) => {
                    const split = log.indexOf('] ');
                    const ts = split >= 0 ? log.substring(0, split + 1) : '';
                    const reason = split >= 0 ? log.substring(split + 2) : log;
                    return <li key={i}><strong>{ts}</strong> {reason}</li>;
                  })}
                </ul>
              </div>
            )}
            <div style={{ display: 'grid', gap: '15px' }}>
              {(examQuestionsCache[viewingStudent.exam_id] || []).map((q, idx) => {
                const sAnswer = (viewingStudent.answers_json || {})[q.id];
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
                  const sAnswer = (r.answers_json || {})[q.id];
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
                          <div key={letter} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 12px', borderRadius: '8px', background: isCorrect ? '#F0FBF4' : '#FAFAFA', border: `2px solid ${isCorrect ? '#27AE60' : '#E8E8E8'}` }}>
                            {/* Label row */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 'bold', color: isCorrect ? '#1E8449' : '#555', fontSize: '14px' }}>
                                {letter.toUpperCase()}. {q[`choice_${letter}`]}
                                {isCorrect && <span style={{ marginLeft: '8px', fontSize: '12px', background: '#27AE60', color: 'white', padding: '2px 8px', borderRadius: '10px' }}>✓ Correct</span>}
                              </span>
                              <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#555', whiteSpace: 'nowrap', marginLeft: '12px' }}>
                                {count} ({percentage}%)
                              </span>
                            </div>
                            {/* Bar */}
                            <div style={{ background: '#E0E0E0', height: '10px', borderRadius: '6px', overflow: 'hidden' }}>
                              <div style={{ width: `${percentage}%`, height: '100%', background: isCorrect ? '#27AE60' : '#3498DB', transition: 'width 0.5s ease' }}></div>
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