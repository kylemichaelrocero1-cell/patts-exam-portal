import { useState, useEffect, useRef } from 'react';
import Icon from './components/Icon';
import { supabase } from './supabase';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// PostgREST caps every response at 1000 rows (Supabase's db-max-rows default).
// A query that can exceed that silently drops the overflow, and with no ORDER BY
// the rows that survive are whatever order the heap hands back — so entire exams
// disappear from the dashboard at random. Page through instead, ordered by the
// primary key so paging is stable across requests.
//
// PAGE_SIZE must stay BELOW the server cap: we treat a short page as "last page",
// so asking for more than the server will ever return would end the loop after
// one page and silently truncate again.
const PAGE_SIZE = 500;
async function fetchAllRows(buildQuery) {
  const all = [];
  for (;;) {
    const { data, error } = await buildQuery()
      .order('id', { ascending: true })
      .range(all.length, all.length + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

export default function AdminDashboard({ instructorId, instructorName, onLogout }) {
  // Navigation State
  const [activeView, setActiveView] = useState('results');

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
  const [liveViolationTooltip, setLiveViolationTooltip] = useState(null); // { session, rect }
  const [resultSort, setResultSort] = useState('section');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Filter States
  const [selectedSection, setSelectedSection] = useState('All');
  const [selectedExam, setSelectedExam] = useState('All');
  const [studentSectionFilter, setStudentSectionFilter] = useState('All');

  // Edit Time State
  const [editingTimes, setEditingTimes] = useState({});
  const [editingSections, setEditingSections] = useState({});
  const [editingPasswords, setEditingPasswords] = useState({});
  const [editingTitles, setEditingTitles] = useState({});
  // --- NEW: Create Exam States ---
const [newTitle, setNewTitle] = useState('');
const [targetSection, setTargetSection] = useState('');

  // --- NEW ANALYTICS STATES ---
  const [viewingStudent, setViewingStudent] = useState(null);
  const [viewingStatsExam, setViewingStatsExam] = useState(null);
  const [examQuestionsCache, setExamQuestionsCache] = useState({});
  const [answersJsonCache, setAnswersJsonCache] = useState({}); // keyed by `studentId_examId`
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
  const emptyQ = { question_text: '', choice_a: '', choice_b: '', choice_c: '', choice_d: '', correct_answer: 0, question_type: 'multiple_choice', image_url: null };
  const instructorExamIdsRef = useRef(new Set());
  const [qForm, setQForm] = useState(emptyQ);
  const [qImageFile, setQImageFile] = useState(null);
  const [qImageUploading, setQImageUploading] = useState(false);
  const [qImagePreview, setQImagePreview] = useState(null);

  // --- CSV IMPORT STATES ---
  const [csvParsed, setCsvParsed] = useState(null);       // { questions, errors } for Questions tab
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvReplaceMode, setCsvReplaceMode] = useState(false);
  const [csvExamParsed, setCsvExamParsed] = useState(null); // { questions, errors } attached to Create Exam form
  const [studentCsvParsed, setStudentCsvParsed] = useState(null); // { students, errors } for Students tab
  const [studentCsvImporting, setStudentCsvImporting] = useState(false);
  // Instructor-managed sections (derived from exam list)
  const [instructorSections, setInstructorSections] = useState(new Set());

  // --- ADD STUDENT STATES ---
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');
  const [newStudentCode, setNewStudentCode] = useState('');
  const [newStudentSection, setNewStudentSection] = useState('');
  const [isAddingStudent, setIsAddingStudent] = useState(false);

  // --- DUPLICATE STATES ---
  const [dupModal, setDupModal] = useState(null); // source exam object | null
  const [dupTitle, setDupTitle] = useState('');
  const [dupSection, setDupSection] = useState('');
  const [dupAssignTo, setDupAssignTo] = useState('self');
  const [isDuplicating, setIsDuplicating] = useState(false);

  // --- TRANSFER STATES ---
  const [instructorsList, setInstructorsList] = useState([]);
  const [transferTarget, setTransferTarget] = useState('');
  const [transferExamIds, setTransferExamIds] = useState(new Set());
  const [isTransferring, setIsTransferring] = useState(false);

  // --- SHARING STATES ---
  const [shareModal, setShareModal] = useState(null); // exam object | null
  const [shareTarget, setShareTarget] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [sharesMap, setSharesMap] = useState({}); // { [examId]: [{ id, shared_with }] }
  const [sharedExamsList, setSharedExamsList] = useState([]); // exams shared WITH me

  // --- SECTION CO-INSTRUCTOR STATES ---
  const [sectionCoModal, setSectionCoModal] = useState(null); // section name string | null
  const [sectionCoTarget, setSectionCoTarget] = useState('');
  const [isSectionCoSaving, setIsSectionCoSaving] = useState(false);
  // { [sectionName]: [{ id, instructor_id, added_by }] } for sections I own
  const [sectionCoMap, setSectionCoMap] = useState({});

  // Helper to load questions — uses a separate loading state so the dashboard never disappears
  const loadExamQuestions = async (examId) => {
    if (examQuestionsCache[examId]) return examQuestionsCache[examId];
    setIsLoadingQuestions(true);
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('exam_id', examId)
      .order('id', { ascending: true });
    setIsLoadingQuestions(false);
    if (error) {
      alert('Failed to load questions: ' + error.message);
      return [];
    }
    setExamQuestionsCache(prev => ({ ...prev, [examId]: data || [] }));
    return data || [];
  };

  const openStudentDetails = async (row) => {
    const cacheKey = `${row.student_id}_${row.exam_id}`;
    setIsLoadingQuestions(true);
    const [, answersJson] = await Promise.all([
      loadExamQuestions(row.exam_id),
      (async () => {
        if (answersJsonCache[cacheKey] !== undefined) return answersJsonCache[cacheKey];
        const { data } = await supabase
          .from('results')
          .select('answers_json')
          .eq('student_id', row.student_id)
          .eq('exam_id', row.exam_id)
          .single();
        const json = data?.answers_json || {};
        setAnswersJsonCache(prev => ({ ...prev, [cacheKey]: json }));
        return json;
      })(),
    ]);
    setIsLoadingQuestions(false);
    setViewingStudent({ ...row, answers_json: answersJson });
  };

  const openExamStats = async (examId) => {
    setIsLoadingQuestions(true);
    const examResults = results.filter(r => r.exam_id === examId);
    try {
      await Promise.all([
        loadExamQuestions(examId),
        (async () => {
          const uncached = examResults.filter(r => answersJsonCache[`${r.student_id}_${examId}`] === undefined);
          if (uncached.length === 0) return;
          const data = await fetchAllRows(() => supabase
            .from('results')
            .select('student_id, answers_json')
            .eq('exam_id', examId));
          setAnswersJsonCache(prev => {
            const next = { ...prev };
            data.forEach(r => { next[`${r.student_id}_${examId}`] = r.answers_json || {}; });
            return next;
          });
        })(),
      ]);
    } catch (err) {
      console.error('Failed to load exam stats:', err);
    }
    setIsLoadingQuestions(false);
    setViewingStatsExam(examId);
  };

  useEffect(() => {
    // fetchDashboardData first — it populates instructorExamIdsRef which fetchLiveSessions depends on
    fetchDashboardData().then(() => fetchLiveSessions());
    fetchInstructors();

    const channel = supabase.channel('admin-realtime')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_sessions' }, payload => {
        if (!instructorExamIdsRef.current.has(payload.new.exam_id)) return;
        if (payload.new.status === 'finished') {
          setLiveSessions(prev => prev.filter(s => s.id !== payload.new.id));
          return;
        }
        setLiveSessions(prev => {
          const exists = prev.some(s => s.id === payload.new.id);
          if (exists) {
            return prev.map(s => s.id === payload.new.id ? { ...s, ...payload.new } : s);
          }
          // Session dismissed but student still active — restore only for our exams
          return [...prev, payload.new];
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_sessions' }, payload => {
        if (!instructorExamIdsRef.current.has(payload.new.exam_id)) return;
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
        if (!instructorExamIdsRef.current.has(payload.new.exam_id)) return;
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
    const examIds = [...instructorExamIdsRef.current];
    if (examIds.length === 0) { setLiveSessions([]); return; }
    let data;
    try {
      data = await fetchAllRows(() => supabase.from('live_sessions').select('*').neq('status', 'finished').in('exam_id', examIds));
    } catch (err) {
      console.error('Failed to load live sessions:', err);
      return; // keep the last good snapshot rather than blanking the monitor
    }
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
    // Optimistic update — realtime doesn't echo back the instructor's own writes
    setLiveSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status: newStatus } : s));
    const { error } = await supabase.from('live_sessions').update({ status: newStatus, updated_at: new Date() }).eq('id', sessionId);
    if (error) {
      // Roll back optimistic update on failure
      setLiveSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status: currentStatus } : s));
      alert('Failed to update lock status: ' + error.message);
    }
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

  const printAnalysis = () => {
    const zone = document.querySelector('.print-zone');
    if (!zone) { window.print(); return; }
    const printRoot = document.createElement('div');
    printRoot.id = 'analysis-print-root';
    printRoot.innerHTML = zone.innerHTML;
    document.body.appendChild(printRoot);
    document.body.classList.add('analysis-printing');
    const cleanup = () => {
      document.body.removeChild(printRoot);
      document.body.classList.remove('analysis-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  const dismissSession = async (sessionId) => {
    const { error } = await supabase.from('live_sessions').update({ status: 'finished' }).eq('id', sessionId);
    if (error) { alert('Failed to dismiss session: ' + error.message); return; }
    setLiveSessions(prev => prev.filter(s => s.id !== sessionId));
  };

  // --- SECTION CO-INSTRUCTOR FUNCTIONS ---
  const addSectionCoInstructor = async () => {
    if (!sectionCoModal || !sectionCoTarget) return;
    if (sectionCoTarget === instructorId) return alert('You cannot add yourself as a co-instructor.');
    setIsSectionCoSaving(true);
    const { error } = await supabase.from('section_instructors').insert([{
      section_name: sectionCoModal,
      instructor_id: sectionCoTarget,
      added_by: instructorId,
    }]);
    setIsSectionCoSaving(false);
    if (error) {
      if (error.code === '23505') return alert('That instructor already has access to this section.');
      return alert('Error adding co-instructor: ' + error.message);
    }
    setSectionCoMap(prev => {
      const updated = { ...prev };
      if (!updated[sectionCoModal]) updated[sectionCoModal] = [];
      updated[sectionCoModal] = [...updated[sectionCoModal], { instructor_id: sectionCoTarget, added_by: instructorId, section_name: sectionCoModal }];
      return updated;
    });
    setSectionCoTarget('');
  };

  const removeSectionCoInstructor = async (row) => {
    const { error } = await supabase.from('section_instructors').delete()
      .eq('section_name', row.section_name)
      .eq('instructor_id', row.instructor_id)
      .eq('added_by', instructorId);
    if (error) return alert('Error removing co-instructor: ' + error.message);
    setSectionCoMap(prev => {
      const updated = { ...prev };
      updated[row.section_name] = (updated[row.section_name] || []).filter(r => r.instructor_id !== row.instructor_id);
      return updated;
    });
  };

  const clearStuckSessions = async () => {
    const stuckIds = liveSessions
      .filter(s => results.some(r => r.student_id === s.student_id && r.exam_id === s.exam_id))
      .map(s => s.id);
    if (stuckIds.length === 0) return alert("No stuck sessions found.");
    await supabase.from('live_sessions').update({ status: 'finished' }).in('id', stuckIds);
    setLiveSessions(prev => prev.filter(s => !stuckIds.includes(s.id)));
  };

  // --- FORCE SUBMIT ---
  // Returns true if a live session has run past the exam's time limit.
  const isSessionTimedOut = (session) => {
    const duration = editingTimes[session.exam_id]
      || sharedExamsList.find(e => e.id === session.exam_id)?.duration_minutes
      || 0;
    if (!duration || !session.created_at) return false;
    const deadline = new Date(session.created_at).getTime() + duration * 60 * 1000 + 30000;
    return Date.now() > deadline;
  };

  // Returns true if a session should be force-submittable:
  // either timed out OR the exam was closed by the instructor.
  const isSessionForceSubmittable = (session) => {
    if (results.some(r => r.student_id === session.student_id && r.exam_id === session.exam_id)) return false;
    const examClosed = [...examsList, ...sharedExamsList].find(e => e.id === session.exam_id)?.is_open === false;
    return isSessionTimedOut(session) || examClosed;
  };

  const [isForceSubmitting, setIsForceSubmitting] = useState(false);
  const [forceSubmitConfirmList, setForceSubmitConfirmList] = useState(null); // sessions[] | null

  const doForceSubmit = async (sessions) => {
    setIsForceSubmitting(true);
    const examIds = [...new Set(sessions.map(s => s.exam_id))];

    // Load questions for all affected exams in parallel and keep the returned data
    // directly — do NOT read from examQuestionsCache state, which is a stale closure.
    const questionsByExam = {};
    await Promise.all(examIds.map(async id => {
      questionsByExam[id] = await loadExamQuestions(id);
    }));

    const errors = [];
    for (const session of sessions) {
      try {
        const questions = questionsByExam[session.exam_id] || [];
        const rawAnswers = session.answers_json || {};
        const rawEssays = session.essay_answers_json || {};

        let correctCount = 0, mcTotal = 0;
        const formattedAnswers = {};

        questions.forEach(q => {
          const qId = String(q.id);
          if ((q.question_type || 'multiple_choice') === 'essay') {
            const text = rawEssays[qId];
            if (text?.trim()) formattedAnswers[qId] = { type: 'essay', text: text.trim() };
          } else {
            mcTotal++;
            if (rawAnswers[qId] !== undefined) {
              const chosen = Number(rawAnswers[qId]);
              const isCorrect = chosen === Number(q.correct_answer);
              if (isCorrect) correctCount++;
              formattedAnswers[qId] = { chosen, is_correct: isCorrect };
            }
          }
        });

        const duration = editingTimes[session.exam_id]
          || sharedExamsList.find(e => e.id === session.exam_id)?.duration_minutes
          || 0;
        const elapsed = Math.floor((Date.now() - new Date(session.created_at).getTime()) / 1000);
        const timeTaken = Math.min(elapsed, duration * 60);

        const { error: insertErr } = await supabase.from('results').insert([{
          student_id: session.student_id,
          exam_id: session.exam_id,
          answers_json: formattedAnswers,
          score: correctCount,
          total_items: mcTotal,
          time_taken_seconds: timeTaken,
          tab_switches: session.violation_count || 0,
          violation_logs: session.violation_log || [],
        }]);

        // 23505 = duplicate (already submitted) — treat as success
        if (insertErr && insertErr.code !== '23505') {
          errors.push(`${session.student_name}: ${insertErr.message}`);
          continue;
        }

        await supabase.from('live_sessions').update({ status: 'finished' }).eq('id', session.id);
        setLiveSessions(prev => prev.filter(s => s.id !== session.id));
        if (insertErr?.code !== '23505') {
          // Add to local results so dashboard updates immediately
          setResults(prev => [...prev, {
            student_id: session.student_id,
            exam_id: session.exam_id,
            score: correctCount,
            total_items: mcTotal,
            time_taken_seconds: timeTaken,
            tab_switches: session.violation_count || 0,
            submitted_at: new Date().toISOString(),
          }]);
        }
      } catch (err) {
        errors.push(`${session.student_name}: ${err.message}`);
      }
    }

    setIsForceSubmitting(false);
    setForceSubmitConfirmList(null);
    if (errors.length > 0) alert(`Force submit completed with errors:\n${errors.join('\n')}`);
  };

  // --- RESCORE / REPAIR ZERO RESULTS ---
  const [isRescoring, setIsRescoring] = useState(false);
  const [manualScoreModal, setManualScoreModal] = useState(null); // { student_id, exam_id, student_name, exam_title, total_items }
  const [manualScoreValue, setManualScoreValue] = useState('');

  const saveManualScore = async () => {
    if (!manualScoreModal) return;
    const score = parseInt(manualScoreValue, 10);
    if (isNaN(score) || score < 0 || score > manualScoreModal.total_items) {
      return alert(`Score must be between 0 and ${manualScoreModal.total_items}.`);
    }
    const { error } = await supabase.from('results')
      .update({ score })
      .eq('student_id', manualScoreModal.student_id)
      .eq('exam_id', manualScoreModal.exam_id);
    if (error) return alert('Save failed: ' + error.message);
    setResults(prev => prev.map(r =>
      r.student_id === manualScoreModal.student_id && r.exam_id === manualScoreModal.exam_id
        ? { ...r, score }
        : r
    ));
    setManualScoreModal(null);
    setManualScoreValue('');
  };

  // ── Change password (own instructor account) ──
  const [showPwModal, setShowPwModal] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [isChangingPw, setIsChangingPw] = useState(false);

  const closePwModal = () => {
    setShowPwModal(false);
    setPwCurrent(''); setPwNew(''); setPwConfirm('');
    setPwError(''); setIsChangingPw(false);
  };

  const changePassword = async () => {
    setPwError('');
    if (!pwCurrent) return setPwError('Enter your current password.');
    if (pwNew.length < 8) return setPwError('New password must be at least 8 characters.');
    if (pwNew !== pwConfirm) return setPwError('New passwords do not match.');
    if (pwNew === pwCurrent) return setPwError('New password must be different from the current one.');

    setIsChangingPw(true);
    try {
      // Get the signed-in instructor's email to re-verify the current password
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !user?.email) {
        setIsChangingPw(false);
        return setPwError('Could not verify your session. Please sign out and back in.');
      }
      // Re-authenticate to confirm the current password is correct
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: pwCurrent,
      });
      if (signInErr) {
        setIsChangingPw(false);
        return setPwError('Current password is incorrect.');
      }
      // Update to the new password
      const { error: updateErr } = await supabase.auth.updateUser({ password: pwNew });
      if (updateErr) {
        setIsChangingPw(false);
        return setPwError(updateErr.message || 'Could not update password.');
      }
      closePwModal();
      alert('Password updated successfully.');
    } catch (e) {
      setIsChangingPw(false);
      setPwError('Something went wrong. Please try again.');
    }
  };

  const rescoreZeroResults = async () => {
    const allExamIds = [...instructorExamIdsRef.current];
    const zeroResults = results.filter(r =>
      r.total_items === 0 && allExamIds.includes(r.exam_id)
    );
    if (zeroResults.length === 0) return alert('No 0/0 results found.');

    setIsRescoring(true);

    const examIds = [...new Set(zeroResults.map(r => r.exam_id))];
    const questionsByExam = {};
    await Promise.all(examIds.map(async id => { questionsByExam[id] = await loadExamQuestions(id); }));

    const mcExamIds = new Set(
      examIds.filter(id => (questionsByExam[id] || []).some(q => (q.question_type || 'multiple_choice') !== 'essay'))
    );
    const toFix = zeroResults.filter(r => mcExamIds.has(r.exam_id));
    if (toFix.length === 0) { setIsRescoring(false); return alert('All 0/0 results are essay-only — nothing to fix.'); }

    // Fetch finished live_sessions to get answers + created_at for time calculation
    const sessionFetches = await Promise.all(
      toFix.map(r =>
        supabase.from('live_sessions')
          .select('student_id, exam_id, answers_json, essay_answers_json, created_at')
          .eq('student_id', r.student_id).eq('exam_id', r.exam_id)
          .order('updated_at', { ascending: false }).limit(1)
      )
    );

    // Diagnose whether answers_json data actually exists on the server
    const hasAnswerData = sessionFetches.some(f => {
      const s = f?.data?.[0];
      return s?.answers_json && Object.keys(s.answers_json).length > 0;
    });

    let timeFixed = 0, scoreFixed = 0, failed = 0;

    for (let i = 0; i < toFix.length; i++) {
      const result = toFix[i];
      const session = sessionFetches[i]?.data?.[0];
      const questions = questionsByExam[result.exam_id] || [];

      // Always fix time_taken_seconds from created_at + exam duration
      const duration = [...examsList, ...sharedExamsList].find(e => e.id === result.exam_id)?.duration_minutes || 0;
      const elapsed = session?.created_at
        ? Math.floor((Date.now() - new Date(session.created_at).getTime()) / 1000)
        : 0;
      const timeTaken = duration > 0 ? Math.min(elapsed, duration * 60) : elapsed;

      const rawAnswers = session?.answers_json || {};
      const rawEssays = session?.essay_answers_json || {};
      const answersAvailable = Object.keys(rawAnswers).length > 0 || Object.keys(rawEssays).length > 0;

      let correctCount = 0, mcTotal = 0;
      const formattedAnswers = {};

      questions.forEach(q => {
        const qId = String(q.id);
        if ((q.question_type || 'multiple_choice') === 'essay') {
          const text = rawEssays[qId];
          if (text?.trim()) formattedAnswers[qId] = { type: 'essay', text: text.trim() };
        } else {
          mcTotal++;
          if (rawAnswers[qId] !== undefined) {
            const chosen = Number(rawAnswers[qId]);
            const isCorrect = chosen === Number(q.correct_answer);
            if (isCorrect) correctCount++;
            formattedAnswers[qId] = { chosen, is_correct: isCorrect };
          }
        }
      });

      const updatePayload = answersAvailable
        ? { score: correctCount, total_items: mcTotal, answers_json: formattedAnswers, time_taken_seconds: timeTaken }
        : { total_items: mcTotal, time_taken_seconds: timeTaken };

      const { error } = await supabase.from('results')
        .update(updatePayload)
        .eq('student_id', result.student_id).eq('exam_id', result.exam_id);

      if (error) { failed++; continue; }
      if (answersAvailable) scoreFixed++;
      timeFixed++;
      setResults(prev => prev.map(r =>
        r.student_id === result.student_id && r.exam_id === result.exam_id
          ? { ...r, ...updatePayload }
          : r
      ));
    }

    setIsRescoring(false);

    if (!hasAnswerData) {
      alert(
        `Time fixed for ${timeFixed} student${timeFixed !== 1 ? 's' : ''}.\n\n` +
        `⚠️ Scores could NOT be recovered automatically.\n\n` +
        `The students' answers were never saved to the server — only the answer COUNT was stored. ` +
        `This is because the live_sessions table is missing the answers_json column.\n\n` +
        `Run this SQL in Supabase to fix it for future exams:\n\n` +
        `ALTER TABLE live_sessions\n` +
        `  ADD COLUMN IF NOT EXISTS answers_json jsonb,\n` +
        `  ADD COLUMN IF NOT EXISTS essay_answers_json jsonb,\n` +
        `  ADD COLUMN IF NOT EXISTS exam_set text;\n\n` +
        `For these ${timeFixed} students, use the pencil (✏️) icon in the Results table to enter scores manually.`
      );
    } else {
      alert(`Done: ${scoreFixed} re-scored, ${timeFixed} time fixed${failed > 0 ? `, ${failed} failed` : ''}.`);
    }
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
    setQImageFile(null);
    setQImagePreview(null);
    setCsvParsed(null);
    loadQuestionList(examId);
  };

  const uploadQuestionImage = async (file) => {
    const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
    const path = `${qExamId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from('question-images').upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from('question-images').getPublicUrl(path);
    return data.publicUrl;
  };

  const removeQuestionImageFromStorage = async (imageUrl) => {
    if (!imageUrl) return;
    try {
      const marker = '/question-images/';
      const idx = imageUrl.indexOf(marker);
      if (idx === -1) return;
      const path = decodeURIComponent(imageUrl.slice(idx + marker.length).split('?')[0]);
      await supabase.storage.from('question-images').remove([path]);
    } catch { /* best-effort — orphaned file is non-critical */ }
  };

  const saveQuestion = async () => {
    if (!qExamId) return;
    if (!qForm.question_text.trim()) return alert('Question text is required.');
    if (qForm.question_type !== 'essay') {
      if (!qForm.choice_a.trim() || !qForm.choice_b.trim() || !qForm.choice_c.trim() || !qForm.choice_d.trim())
        return alert('All four choices are required for multiple choice questions.');
    }

    setQSaving(true);
    const isEssay = qForm.question_type === 'essay';

    let imageUrl = qForm.image_url;

    if (qImageFile) {
      setQImageUploading(true);
      try {
        if (editingQ?.image_url && editingQ.image_url !== imageUrl) {
          await removeQuestionImageFromStorage(editingQ.image_url);
        }
        imageUrl = await uploadQuestionImage(qImageFile);
      } catch (err) {
        alert('Image upload failed: ' + err.message + '\n\nMake sure the "question-images" Storage bucket exists and is public in Supabase.');
        setQSaving(false);
        setQImageUploading(false);
        return;
      }
      setQImageUploading(false);
    } else if (editingQ?.image_url && qForm.image_url === null) {
      await removeQuestionImageFromStorage(editingQ.image_url);
    }

    const payload = {
      exam_id: qExamId,
      question_text: qForm.question_text.trim(),
      question_type: qForm.question_type,
      choice_a: isEssay ? null : qForm.choice_a.trim(),
      choice_b: isEssay ? null : qForm.choice_b.trim(),
      choice_c: isEssay ? null : qForm.choice_c.trim(),
      choice_d: isEssay ? null : qForm.choice_d.trim(),
      correct_answer: isEssay ? null : Number(qForm.correct_answer),
      image_url: imageUrl || null,
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
      setQImageFile(null);
      setQImagePreview(null);
      setExamQuestionsCache(prev => { const n = { ...prev }; delete n[qExamId]; return n; });
      loadQuestionList(qExamId);
    }
    setQSaving(false);
  };

  const deleteQuestion = async (questionId) => {
    if (!window.confirm('Delete this question permanently?')) return;
    const q = qList.find(q => q.id === questionId);
    const { error } = await supabase.from('questions').delete().eq('id', questionId);
    if (error) { alert('Error deleting question: ' + error.message); return; }
    if (q?.image_url) await removeQuestionImageFromStorage(q.image_url);
    if (editingQ?.id === questionId) { setEditingQ(null); setQForm(emptyQ); setQImageFile(null); setQImagePreview(null); }
    setExamQuestionsCache(prev => { const n = { ...prev }; delete n[qExamId]; return n; });
    loadQuestionList(qExamId);
  };

  const startEditQuestion = (q) => {
    setEditingQ(q);
    setQForm({
      question_text: q.question_text,
      choice_a: q.choice_a || '',
      choice_b: q.choice_b || '',
      choice_c: q.choice_c || '',
      choice_d: q.choice_d || '',
      correct_answer: Number(q.correct_answer || 0),
      question_type: q.question_type || 'multiple_choice',
      image_url: q.image_url || null,
    });
    setQImageFile(null);
    setQImagePreview(q.image_url || null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // --- CSV HELPERS ---
  const parseQuestionCSV = (text) => {
    const rawRows = text.trim().split(/\r?\n/);
    const rows = rawRows.map(row => {
      const cells = [];
      let cell = '', inQ = false;
      for (const ch of row) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { cells.push(cell.trim()); cell = ''; }
        else { cell += ch; }
      }
      cells.push(cell.trim());
      return cells;
    });
    const firstCell = rows[0]?.[0]?.toLowerCase().replace(/\s/g, '_');
    const dataRows = (firstCell === 'question_text' || firstCell === 'question') ? rows.slice(1) : rows;
    const questions = [], errors = [];
    dataRows.forEach((cols, idx) => {
      const qText = cols[0]?.trim();
      if (!qText) return;
      const a = cols[1]?.trim() || '', b = cols[2]?.trim() || '';
      const c = cols[3]?.trim() || '', d = cols[4]?.trim() || '';
      const isEssay = !a;
      if (isEssay) {
        questions.push({ question_text: qText, question_type: 'essay', choice_a: null, choice_b: null, choice_c: null, choice_d: null, correct_answer: null });
      } else {
        if (!b || !c || !d) { errors.push(`Row ${idx + 2}: Missing choices — need A, B, C, and D`); return; }
        const raw = cols[5]?.trim().toUpperCase() || '';
        const map = { A: 0, B: 1, C: 2, D: 3, '0': 0, '1': 1, '2': 2, '3': 3 };
        if (map[raw] === undefined) { errors.push(`Row ${idx + 2}: Invalid answer "${raw}" — use 0, 1, 2, or 3 (0=A 1=B 2=C 3=D)`); return; }
        questions.push({ question_text: qText, question_type: 'multiple_choice', choice_a: a, choice_b: b, choice_c: c, choice_d: d, correct_answer: map[raw] });
      }
    });
    return { questions, errors };
  };

  const downloadCSVTemplate = () => {
    const csv = [
      'question_text,choice_a,choice_b,choice_c,choice_d,correct_answer (0=A 1=B 2=C 3=D)',
      '"What is lift?","Pressure difference","Gravity","Drag","Thrust",0',
      '"What is the primary function of an aileron?","Roll control","Pitch control","Yaw control","Speed control",0',
      '"Explain Bernoulli\'s principle in your own words.",,,,, ',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'question_template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleCsvFileSelect = (e, setter) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setter(parseQuestionCSV(ev.target.result));
    reader.readAsText(file);
    e.target.value = '';
  };

  const importQuestionsFromCSV = async (examId, questions, replace) => {
    setCsvImporting(true);
    try {
      if (replace) await supabase.from('questions').delete().eq('exam_id', examId);
      const payload = questions.map(q => ({ ...q, exam_id: examId }));
      for (let i = 0; i < payload.length; i += 50) {
        const { error } = await supabase.from('questions').insert(payload.slice(i, i + 50));
        if (error) throw error;
      }
      setCsvParsed(null);
      setExamQuestionsCache(prev => { const n = { ...prev }; delete n[examId]; return n; });
      loadQuestionList(examId);
      alert(`✅ ${questions.length} question${questions.length !== 1 ? 's' : ''} imported!`);
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    setCsvImporting(false);
  };

  // --- STUDENT CSV HELPERS ---
  const parseStudentCSV = (text) => {
    const rawRows = text.trim().split(/\r?\n/);
    const rows = rawRows.map(row => {
      const cells = [];
      let cell = '', inQ = false;
      for (const ch of row) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { cells.push(cell.trim()); cell = ''; }
        else { cell += ch; }
      }
      cells.push(cell.trim());
      return cells;
    });
    const firstCell = rows[0]?.[0]?.toLowerCase().replace(/\s/g, '_');
    const dataRows = (firstCell === 'full_name' || firstCell === 'name') ? rows.slice(1) : rows;
    const students = [], errors = [];
    dataRows.forEach((cols, idx) => {
      const name = cols[0]?.trim();
      const email = cols[1]?.trim().toLowerCase();
      const code = cols[2]?.trim();
      const section = cols[3]?.trim();
      if (!name && !email && !code && !section) return;
      const rowNum = idx + 2;
      if (!name) { errors.push(`Row ${rowNum}: Full name is required.`); return; }
      if (!email) { errors.push(`Row ${rowNum}: Email is required.`); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errors.push(`Row ${rowNum}: "${email}" is not a valid email address.`); return; }
      if (!code) { errors.push(`Row ${rowNum}: Student ID is required.`); return; }
      if (!section) { errors.push(`Row ${rowNum}: Section is required.`); return; }
      students.push({ full_name: name, student_email: email, student_code: code, section });
    });
    // Flag in-file duplicates (same email or student_id appearing more than once in the CSV)
    const seenEmails = new Map(), seenCodes = new Map();
    students.forEach((s, i) => {
      if (seenEmails.has(s.student_email)) errors.push(`Duplicate email in CSV: "${s.student_email}" (rows ${seenEmails.get(s.student_email) + 2} & ${i + 2})`);
      else seenEmails.set(s.student_email, i);
      if (seenCodes.has(s.student_code)) errors.push(`Duplicate Student ID in CSV: "${s.student_code}" (rows ${seenCodes.get(s.student_code) + 2} & ${i + 2})`);
      else seenCodes.set(s.student_code, i);
    });
    return { students, errors };
  };

  const downloadStudentCSVTemplate = () => {
    const csv = [
      'full_name,student_email,student_id,section',
      '"Juan dela Cruz","juan.delacruz@patts.edu.ph","2021-1-1234","Aero 101"',
      '"Maria Santos","maria.santos@patts.edu.ph","2021-1-5678","Aero 101"',
      '"Pedro Reyes","pedro.reyes@patts.edu.ph","2022-2-9012","Aero 102"',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'student_template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const importStudentsFromCSV = async () => {
    if (!studentCsvParsed || studentCsvParsed.students.length === 0) return;
    setStudentCsvImporting(true);
    try {
      const existing = await fetchAllRows(() => supabase.from('users').select('student_email, student_code'));
      const existingEmails = new Set((existing || []).map(u => u.student_email));
      const existingCodes = new Set((existing || []).map(u => u.student_code));

      const toInsert = [], skipped = [];
      studentCsvParsed.students.forEach(s => {
        if (existingEmails.has(s.student_email)) { skipped.push(`${s.full_name} — email already exists`); return; }
        if (existingCodes.has(s.student_code)) { skipped.push(`${s.full_name} — Student ID already exists`); return; }
        toInsert.push(s);
      });

      let inserted = [];
      for (let i = 0; i < toInsert.length; i += 50) {
        const { data, error } = await supabase.from('users').insert(toInsert.slice(i, i + 50)).select();
        if (error) throw error;
        if (data) inserted = [...inserted, ...data];
      }

      if (inserted.length > 0) {
        setStudentsList(prev => [...prev, ...inserted]);
        setStudents(prev => {
          const next = { ...prev };
          inserted.forEach(s => { next[s.id] = { name: s.full_name, section: s.section }; });
          return next;
        });
        setEditingStudentSections(prev => {
          const next = { ...prev };
          inserted.forEach(s => { next[s.id] = s.section; });
          return next;
        });
      }

      setStudentCsvParsed(null);
      let msg = `✅ ${inserted.length} student${inserted.length !== 1 ? 's' : ''} imported.`;
      if (skipped.length > 0) {
        const preview = skipped.slice(0, 8).join('\n');
        const more = skipped.length > 8 ? `\n…and ${skipped.length - 8} more` : '';
        msg += `\n\nSkipped ${skipped.length} duplicate${skipped.length !== 1 ? 's' : ''}:\n${preview}${more}`;
      }
      alert(msg);
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    setStudentCsvImporting(false);
  };

  const openDupModal = (exam) => {
    setDupModal(exam);
    setDupTitle(`Copy of ${exam.title}`);
    setDupSection(exam.target_section || '');
    setDupAssignTo('self');
  };

  const duplicateExam = async () => {
    if (!dupTitle.trim()) return alert('New title is required.');
    if (!dupSection.trim()) return alert('Target section is required — students find the exam by section.');
    setIsDuplicating(true);
    const targetId = dupAssignTo === 'self' ? instructorId : dupAssignTo;
    const { data: newExamId, error } = await supabase.rpc('duplicate_exam', {
      p_source_exam_id: dupModal.id,
      p_new_title: dupTitle.trim(),
      p_target_section: dupSection.trim(),
      p_target_instructor_id: targetId,
    });
    if (error) {
      alert('Duplicate failed: ' + error.message);
    } else {
      const dest = dupAssignTo === 'self'
        ? 'your account'
        : (instructorsList.find(i => i.id === dupAssignTo)?.full_name || 'the instructor');
      setDupModal(null);
      await fetchDashboardData();
      alert(`✅ Exam duplicated and assigned to ${dest}.`);
    }
    setIsDuplicating(false);
  };

  const fetchInstructors = async () => {
    const { data } = await supabase.from('instructors').select('*').neq('id', instructorId).order('full_name');
    setInstructorsList(data || []);
  };

  // --- SHARING FUNCTIONS ---
  const openShareModal = (exam) => {
    setShareModal(exam);
    setShareTarget('');
  };

  // Targeted share-only refresh — does NOT set isLoading so the dashboard never disappears.
  const refreshShares = async () => {
    const [outSharesRes, inSharesRes] = await Promise.all([
      supabase.from('exam_shares').select('id, exam_id, shared_with').eq('shared_by', instructorId),
      supabase.from('exam_shares').select('id, exam_id, shared_by').eq('shared_with', instructorId),
    ]);

    const newSharesMap = {};
    (outSharesRes.data || []).forEach(s => {
      if (!newSharesMap[s.exam_id]) newSharesMap[s.exam_id] = [];
      newSharesMap[s.exam_id].push({ id: s.id, shared_with: s.shared_with });
    });
    setSharesMap(newSharesMap);

    const inShares = inSharesRes.data || [];
    if (inShares.length > 0) {
      const sharedIds = [...new Set(inShares.map(s => s.exam_id))];
      const { data: sharedExamsData } = await supabase
        .from('exams')
        .select('id, title, is_open, duration_minutes, target_section, exam_password')
        .in('id', sharedIds);
      const sharedList = inShares.map(s => {
        const exam = (sharedExamsData || []).find(e => e.id === s.exam_id);
        if (!exam) return null;
        return { ...exam, share_id: s.id, shared_by: s.shared_by };
      }).filter(Boolean);
      setSharedExamsList(sharedList);
      (sharedExamsData || []).forEach(e => instructorExamIdsRef.current.add(e.id));
      setExamsDict(prev => {
        const next = { ...prev };
        (sharedExamsData || []).forEach(e => { next[e.id] = e.title; });
        return next;
      });
    } else {
      setSharedExamsList([]);
    }
  };

  const shareExam = async () => {
    if (!shareModal || !shareTarget) return;
    setIsSharing(true);
    const { error } = await supabase.from('exam_shares').insert([{
      exam_id: shareModal.id,
      shared_by: instructorId,
      shared_with: shareTarget,
    }]);
    if (error) {
      alert('Share failed: ' + (error.code === '23505' ? 'This instructor already has access.' : error.message));
      setIsSharing(false);
      return;
    }
    setShareTarget('');
    await refreshShares();
    setIsSharing(false);
  };

  const revokeShare = async (shareId, examId) => {
    const { error } = await supabase.from('exam_shares').delete().eq('id', shareId);
    if (error) { alert('Error revoking access: ' + error.message); return; }
    setSharesMap(prev => {
      const updated = (prev[examId] || []).filter(s => s.id !== shareId);
      const next = { ...prev };
      if (updated.length === 0) delete next[examId];
      else next[examId] = updated;
      return next;
    });
  };

  const removeSharedAccess = async (shareId) => {
    const { error } = await supabase.from('exam_shares').delete().eq('id', shareId);
    if (error) { alert('Error removing shared exam: ' + error.message); return; }
    setSharedExamsList(prev => prev.filter(e => e.share_id !== shareId));
    instructorExamIdsRef.current = new Set(
      [...instructorExamIdsRef.current].filter(id =>
        sharedExamsList.some(e => e.share_id !== shareId && e.id === id) ||
        examsList.some(e => e.id === id)
      )
    );
  };

  const transferExams = async () => {
    if (!transferTarget || transferExamIds.size === 0) return;
    const dest = instructorsList.find(i => i.id === transferTarget);
    if (!window.confirm(`Transfer ${transferExamIds.size} exam${transferExamIds.size !== 1 ? 's' : ''} to ${dest?.full_name || dest?.email}?\n\nStudents will automatically appear under their dashboard. This cannot be undone from the UI.`)) return;
    setIsTransferring(true);
    const { error } = await supabase.rpc('transfer_exams', {
      p_exam_ids: [...transferExamIds],
      p_target_instructor_id: transferTarget,
    });
    if (error) {
      alert('Transfer failed: ' + error.message);
    } else {
      const count = transferExamIds.size;
      setTransferExamIds(new Set());
      setTransferTarget('');
      await fetchDashboardData();
      alert(`✅ ${count} exam${count !== 1 ? 's' : ''} transferred to ${dest?.full_name || dest?.email}.`);
    }
    setIsTransferring(false);
  };

async function fetchDashboardData() {
    setIsLoading(true);
    try {
      // Fetch own exams, incoming exam-shares, and section co-instructor memberships in parallel
      const [examsRes, inSharesRes, coSectionsRes] = await Promise.all([
        supabase.from('exams')
          .select('id, title, is_open, duration_minutes, target_section, exam_password')
          .eq('instructor_id', instructorId)
          .order('created_at', { ascending: true }),
        supabase.from('exam_shares')
          .select('id, exam_id, shared_by')
          .eq('shared_with', instructorId),
        supabase.from('section_instructors')
          .select('id, section_name, instructor_id, added_by')
          .or(`added_by.eq.${instructorId},instructor_id.eq.${instructorId}`),
      ]);

      const examsData = examsRes.data || [];
      const inShares = inSharesRes.data || [];
      const allSectionRows = coSectionsRes.data || [];

      // Build section co-instructor map for sections I own (added_by = me)
      const newSectionCoMap = {};
      allSectionRows.filter(r => r.added_by === instructorId).forEach(r => {
        if (!newSectionCoMap[r.section_name]) newSectionCoMap[r.section_name] = [];
        newSectionCoMap[r.section_name].push(r);
      });
      setSectionCoMap(newSectionCoMap);

      // Sections I co-manage (added by another instructor, I am the co-instructor)
      const coManagedSectionNames = [
        ...new Set(allSectionRows.filter(r => r.instructor_id === instructorId && r.added_by !== instructorId).map(r => r.section_name))
      ];

      // Fetch shared exam data + outgoing shares + students + co-section exams in parallel
      const sharedExamIdsFromShares = [...new Set(inShares.map(s => s.exam_id))];
      const [sharedExamsRes, outSharesRes, studentsData, ...coSectionExamResults] = await Promise.all([
        sharedExamIdsFromShares.length > 0
          ? supabase.from('exams').select('id, title, is_open, duration_minutes, target_section, exam_password').in('id', sharedExamIdsFromShares)
          : Promise.resolve({ data: [] }),
        supabase.from('exam_shares').select('id, exam_id, shared_with').eq('shared_by', instructorId),
        fetchAllRows(() => supabase.from('users').select('id, full_name, section')),
        // For each co-managed section, fetch other instructors' exams targeting it
        ...coManagedSectionNames.map(sec =>
          supabase.from('exams')
            .select('id, title, is_open, duration_minutes, target_section, exam_password, instructor_id')
            .ilike('target_section', `%${sec}%`)
            .neq('instructor_id', instructorId)
        ),
      ]);

      const sharedExamsData = sharedExamsRes.data || [];
      const outShares = outSharesRes.data || [];

      // Merge exams from co-managed sections (verify exact section match client-side)
      const ownExamIdSet = new Set(examsData.map(e => e.id));
      const coSectionExams = [];
      const seenCoIds = new Set(sharedExamsData.map(e => e.id));
      coSectionExamResults.forEach((res, i) => {
        const secName = coManagedSectionNames[i];
        (res.data || []).forEach(exam => {
          // Exact section match — ensures "BSME 3A" doesn't match "BSME 30"
          const sections = (exam.target_section || '').split(',').map(s => s.trim());
          if (!sections.includes(secName)) return;
          if (ownExamIdSet.has(exam.id) || seenCoIds.has(exam.id)) return;
          seenCoIds.add(exam.id);
          coSectionExams.push({ ...exam, _coSection: secName });
        });
      });

      // Combine all exam IDs for live monitor and results
      const ownExamIds = examsData.map(e => e.id);
      const sharedExamIds = [...sharedExamsData.map(e => e.id), ...coSectionExams.map(e => e.id)];
      const allExamIds = [...ownExamIds, ...sharedExamIds];
      instructorExamIdsRef.current = new Set(allExamIds);

      // Fetch results for all exams (paged — this routinely exceeds 1000 rows)
      const resultsData = allExamIds.length > 0
        ? await fetchAllRows(() => supabase.from('results')
            .select('student_id, exam_id, score, total_items, tab_switches, time_taken_seconds, violation_logs, submitted_at')
            .in('exam_id', allExamIds))
        : [];

      // Process own exam metadata
      const dict = {}, times = {}, secs = {}, passwords = {}, titles = {};
      examsData.forEach(e => {
        dict[e.id] = e.title;
        times[e.id] = e.duration_minutes;
        secs[e.id] = e.target_section || '';
        passwords[e.id] = e.exam_password || '';
        titles[e.id] = e.title;
      });
      // Add shared exam titles to dict for result modals
      sharedExamsData.forEach(e => { dict[e.id] = e.title; });

      setExamsList(examsData);
      setExamsDict(dict);
      setEditingTimes(times);
      setEditingSections(secs);
      setEditingPasswords(passwords);
      setEditingTitles(titles);

      const sections = new Set(
        examsData.flatMap(e => (e.target_section || '').split(',').map(s => s.trim()).filter(Boolean))
      );
      setInstructorSections(sections);

      // Build sharesMap (outgoing) keyed by exam ID
      const newSharesMap = {};
      outShares.forEach(s => {
        if (!newSharesMap[s.exam_id]) newSharesMap[s.exam_id] = [];
        newSharesMap[s.exam_id].push({ id: s.id, shared_with: s.shared_with });
      });
      setSharesMap(newSharesMap);

      // Build sharedExamsList (incoming exam-shares + co-section exams)
      const sharedList = [
        ...inShares.map(s => {
          const exam = sharedExamsData.find(e => e.id === s.exam_id);
          if (!exam) return null;
          return { ...exam, share_id: s.id, shared_by: s.shared_by };
        }).filter(Boolean),
        ...coSectionExams.map(e => ({ ...e, shared_by: e.instructor_id, _isCoSection: true })),
      ];
      setSharedExamsList(sharedList);

      // Process students
      const safeStudentsCopy = [...studentsData].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
      const studentDict = {}, studentSecs = {};
      safeStudentsCopy.forEach(s => {
        studentDict[s.id] = { name: s.full_name || 'Unknown', section: s.section || 'Unknown' };
        studentSecs[s.id] = s.section || '';
      });

      const mySections = new Set(
        examsData.flatMap(e => (e.target_section || '').split(',').map(s => s.trim()).filter(Boolean))
      );
      const myStudents = safeStudentsCopy.filter(s =>
        s.section && s.section.split(',').map(x => x.trim()).some(sec => mySections.has(sec))
      );

      setStudentsList(myStudents);
      setEditingStudentSections(studentSecs);
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

    const { data: newExam, error } = await supabase.from('exams').insert([{
      title: newTitle,
      target_section: targetSection,
      instructor_id: instructorId,
      is_open: false,
      duration_minutes: 60,
    }]).select().single();

    if (error) {
      console.error(error);
      alert("Error creating exam.");
      setIsLoading(false);
      return;
    }

    // Bulk-insert questions from CSV if provided
    const csvQs = csvExamParsed?.questions || [];
    if (csvQs.length > 0 && newExam?.id) {
      const payload = csvQs.map(q => ({ ...q, exam_id: newExam.id }));
      for (let i = 0; i < payload.length; i += 50) {
        await supabase.from('questions').insert(payload.slice(i, i + 50));
      }
    }

    setNewTitle('');
    setTargetSection('');
    setCsvExamParsed(null);
    await fetchDashboardData();
    alert(`Exam created!${csvQs.length > 0 ? ` ${csvQs.length} questions imported.` : ' Add questions in the Questions tab.'}`);
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

  // --- Rename Exam Title ---
  const saveTitle = async (examId) => {
    const newTitle = (editingTitles[examId] || '').trim();
    if (!newTitle) return alert('Exam title cannot be empty.');
    const { error } = await supabase.from('exams').update({ title: newTitle }).eq('id', examId);
    if (error) { alert('Error saving title: ' + error.message); return; }
    setExamsList(prev => prev.map(e => e.id === examId ? { ...e, title: newTitle } : e));
    setExamsDict(prev => ({ ...prev, [examId]: newTitle }));
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
    // Guard: only allow editing students visible in this instructor's filtered list
    if (!studentsList.some(s => s.id === studentId)) {
      alert('You can only manage students in your sections.');
      return;
    }
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
    // Strip any IDs not in the instructor's visible student list (belt-and-suspenders)
    const ownedStudentIds = new Set(studentsList.map(s => s.id));
    const ids = [...selectedStudentIds].filter(id => ownedStudentIds.has(id));
    if (ids.length === 0) { setIsBatchSaving(false); return alert('None of the selected students are in your sections.'); }
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

  const deleteStudent = async (studentId) => {
    const student = studentsList.find(s => s.id === studentId);
    if (!student) return;
    if (!window.confirm(`Delete "${student.full_name || 'this student'}" permanently?\n\nThis will also remove all their exam results. This cannot be undone.`)) return;

    await supabase.from('live_sessions').delete().eq('student_id', studentId);
    await supabase.from('results').delete().eq('student_id', studentId);
    const { error } = await supabase.from('users').delete().eq('id', studentId);

    if (error) {
      alert('Error deleting student: ' + error.message);
      return;
    }

    setStudentsList(prev => prev.filter(s => s.id !== studentId));
    setStudents(prev => { const n = { ...prev }; delete n[studentId]; return n; });
    setResults(prev => prev.filter(r => r.student_id !== studentId));
    setSelectedStudentIds(prev => { const n = new Set(prev); n.delete(studentId); return n; });
  };

  const batchDeleteStudents = async () => {
    if (selectedStudentIds.size === 0) return;
    const ownedIds = new Set(studentsList.map(s => s.id));
    const ids = [...selectedStudentIds].filter(id => ownedIds.has(id));
    if (ids.length === 0) return;
    if (!window.confirm(`Permanently delete ${ids.length} student(s) and all their results?\n\nThis cannot be undone.`)) return;

    setIsBatchSaving(true);
    await supabase.from('live_sessions').delete().in('student_id', ids);
    await supabase.from('results').delete().in('student_id', ids);
    const { error } = await supabase.from('users').delete().in('id', ids);

    if (error) {
      alert('Error deleting students: ' + error.message);
    } else {
      const deletedSet = new Set(ids);
      setStudentsList(prev => prev.filter(s => !deletedSet.has(s.id)));
      setStudents(prev => { const n = { ...prev }; ids.forEach(id => delete n[id]); return n; });
      setResults(prev => prev.filter(r => !deletedSet.has(r.student_id)));
      setSelectedStudentIds(new Set());
    }
    setIsBatchSaving(false);
  };

  const createStudent = async () => {
    if (!newStudentName.trim()) return alert('Full name is required.');
    if (!newStudentEmail.trim()) return alert('Student email is required.');
    if (!newStudentCode.trim()) return alert('Student ID is required.');
    if (!newStudentSection.trim()) return alert('Section is required.');

    setIsAddingStudent(true);

    // Check for duplicate email and student code separately to avoid PostgREST filter injection
    const email = newStudentEmail.trim().toLowerCase();
    const code = newStudentCode.trim();
    const [{ data: byEmail }, { data: byCode }] = await Promise.all([
      supabase.from('users').select('id').eq('student_email', email).limit(1),
      supabase.from('users').select('id').eq('student_code', code).limit(1),
    ]);

    if (byEmail?.length > 0) {
      alert('A student with that email already exists.');
      setIsAddingStudent(false);
      return;
    }
    if (byCode?.length > 0) {
      alert('A student with that Student ID already exists.');
      setIsAddingStudent(false);
      return;
    }

    const { data: created, error } = await supabase.from('users').insert([{
      full_name: newStudentName.trim(),
      student_email: email,
      student_code: code,
      section: newStudentSection.trim(),
    }]).select().single();

    if (error) {
      alert('Error creating student: ' + error.message);
    } else {
      setStudentsList(prev => [...prev, created]);
      setStudents(prev => ({ ...prev, [created.id]: { name: created.full_name, section: created.section } }));
      setEditingStudentSections(prev => ({ ...prev, [created.id]: created.section }));
      setNewStudentName('');
      setNewStudentEmail('');
      setNewStudentCode('');
      setNewStudentSection('');
      alert(`Student "${created.full_name}" added successfully.`);
    }
    setIsAddingStudent(false);
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
      // section is a comma-separated list — match membership, not the whole string,
      // or a student in "AENG 223L-2, AENG 223L" is invisible under either section.
      const matchesSection = selectedSection === 'All' ||
        (studentInfo.section || '').split(',').map(x => x.trim()).includes(selectedSection);
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

  // Derive from actual result rows so shared-exam sections are always included.
  // Split the comma list into individual sections — same as the Students tab.
  const uniqueSections = ['All', ...[...new Set(
    results.flatMap(r => (students[r.student_id]?.section || '').split(',').map(x => x.trim()).filter(Boolean))
  )].sort()];

  // --- RESULTS STATISTICS ---
  const resultStats = (() => {
    const n = filteredAndSortedResults.length;
    if (n === 0) return null;
    const pcts = filteredAndSortedResults.map(r => r.total_items > 0 ? (r.score / r.total_items) * 100 : 0);
    const sorted = [...pcts].sort((a, b) => a - b);
    const sum = pcts.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
    const variance = pcts.reduce((acc, p) => acc + Math.pow(p - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    const highest = sorted[n - 1];
    const lowest = sorted[0];
    const passing = pcts.filter(p => p >= 75).length;
    const passRate = (passing / n) * 100;
    const brackets = [
      { label: '0–49%', min: 0, max: 49, color: '#E74C3C' },
      { label: '50–59%', min: 50, max: 59, color: '#E67E22' },
      { label: '60–69%', min: 60, max: 69, color: '#F39C12' },
      { label: '70–74%', min: 70, max: 74, color: '#F1C40F' },
      { label: '75–79%', min: 75, max: 79, color: '#2ECC71' },
      { label: '80–89%', min: 80, max: 89, color: '#27AE60' },
      { label: '90–100%', min: 90, max: 100, color: '#1A8A4A' },
    ];
    const distribution = brackets.map(b => ({
      ...b,
      count: pcts.filter(p => p >= b.min && p <= b.max).length,
    }));
    const avgTimeSec = filteredAndSortedResults.reduce((a, r) => a + (r.time_taken_seconds || 0), 0) / n;
    const avgViolations = filteredAndSortedResults.reduce((a, r) => a + (r.tab_switches || 0), 0) / n;
    return { n, mean, median, stdDev, highest, lowest, passRate, distribution, avgTimeSec, avgViolations };
  })();

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
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '240px 1fr', background: 'var(--paper)' }}>
      <div style={{ background: 'var(--navy)', height: '100vh' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          <Icon name="clipboard" size={36} color="var(--navy)" style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Loading Dashboard…</p>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '240px 1fr', background: 'var(--paper)' }}>

      {/* ── SIDEBAR ── */}
      <aside style={{
        display: 'flex', flexDirection: 'column',
        background: 'var(--navy)', borderRight: '1px solid rgba(255,255,255,.07)',
        height: '100vh', position: 'sticky', top: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: '20px 18px 14px', borderBottom: '1px solid rgba(255,255,255,.07)', flexShrink: 0 }}>
          <img src="/patts-logo.png" alt="PATTS" style={{ height: 34, objectFit: 'contain', display: 'block' }} />
          <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,.38)', fontWeight: 700, letterSpacing: '.16em', marginTop: 8, textTransform: 'uppercase' }}>
            Instructor Dashboard
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[
            { id: 'home',       label: 'Overview',     icon: 'home' },
            { id: 'results',    label: 'Results',       icon: 'bar-chart' },
            { id: 'manage',     label: 'Manage Exams',  icon: 'clipboard' },
            { id: 'students',   label: 'Students',      icon: 'users' },
            { id: 'live',       label: 'Live Monitor',  icon: 'activity', badge: liveSessions.length > 0 ? String(liveSessions.length) : null, live: true },
            { id: 'attendance', label: 'Attendance',    icon: 'calendar' },
            { id: 'questions',  label: 'Questions',     icon: 'file-text' },
            { id: 'transfer',   label: 'Transfer',      icon: 'arrow-up-right' },
          ].map(item => {
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setActiveView(item.id); setLiveViolationTooltip(null); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '9px 11px', borderRadius: 'var(--r-sm)',
                  border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%',
                  background: active ? 'rgba(255,255,255,.13)' : 'transparent',
                  color: active ? 'white' : 'rgba(255,255,255,.58)',
                  fontWeight: active ? 600 : 400,
                  fontSize: 13.5, transition: 'all var(--t-1)',
                }}
              >
                <Icon name={item.icon} size={16} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.badge && (
                  <span style={{
                    background: item.live ? '#E74C3C' : 'rgba(255,255,255,.2)',
                    color: 'white', fontSize: 10.5, fontWeight: 700,
                    padding: '1px 6px', borderRadius: 99, lineHeight: 1.6,
                  }}>{item.badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Profile + Logout */}
        <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,.07)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
              background: 'var(--gold)', color: 'var(--navy)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12.5, fontWeight: 700,
            }}>
              {(instructorName || '?')[0].toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {instructorName}
              </div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.38)' }}>Instructor</div>
            </div>
          </div>
          <button
            onClick={() => setShowPwModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, width: '100%',
              padding: '7px 10px', borderRadius: 'var(--r-sm)', marginBottom: 6,
              border: '1px solid rgba(255,255,255,.14)',
              background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.65)',
              fontSize: 12.5, cursor: 'pointer', transition: 'all var(--t-1)',
            }}
          >
            <Icon name="lock" size={13} />
            Change password
          </button>
          <button
            onClick={onLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, width: '100%',
              padding: '7px 10px', borderRadius: 'var(--r-sm)',
              border: '1px solid rgba(255,255,255,.14)',
              background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.65)',
              fontSize: 12.5, cursor: 'pointer', transition: 'all var(--t-1)',
            }}
          >
            <Icon name="logout" size={13} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── WORKSPACE ── */}
      <main style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', overflow: 'hidden', background: 'var(--surface-2)' }}>

        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 24px', borderBottom: '1px solid var(--line)',
          background: 'var(--paper)', position: 'sticky', top: 0, zIndex: 10,
          boxShadow: '0 1px 0 var(--line)',
        }}>
          <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: 'var(--ink-1)' }}>
            {({
              home: 'Overview',
              results: 'Results',
              manage: 'Manage Exams',
              students: 'Students',
              live: 'Live Monitor',
              attendance: 'Attendance',
              questions: 'Questions',
              transfer: 'Transfer Exams',
            })[activeView] || 'Dashboard'}
          </h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {lastRefreshed && (
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Updated {lastRefreshed}</span>
            )}
            <button
              disabled={isRefreshing}
              onClick={async () => {
                setIsRefreshing(true);
                await Promise.all([fetchDashboardData(), fetchLiveSessions()]);
                setLastRefreshed(new Date().toLocaleTimeString());
                setIsRefreshing(false);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'transparent', border: '1px solid var(--line)',
                color: 'var(--ink-3)', padding: '6px 13px', borderRadius: 'var(--r-sm)',
                fontSize: 12.5, cursor: 'pointer', opacity: isRefreshing ? 0.6 : 1,
              }}
            >
              <Icon name="refresh" size={13} />
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Panel content */}
        <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>

          {/* --- OVERVIEW HOME PANEL --- */}
          {activeView === 'home' && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <div className="eyebrow" style={{ fontSize: 10 }}>Dashboard</div>
                <h3 style={{ margin: '4px 0 4px', fontSize: 18 }}>Welcome back, {(instructorName || 'Instructor').split(' ')[0]}.</h3>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }}>
                  {examsList.length} exam{examsList.length !== 1 ? 's' : ''} · {studentsList.length} student{studentsList.length !== 1 ? 's' : ''} · {results.length} submission{results.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
                {[
                  { label: 'Open Exams', value: examsList.filter(e => e.is_open).length, color: 'var(--navy)', icon: 'clipboard', sub: 'currently open' },
                  { label: 'Live Now', value: liveSessions.length, color: liveSessions.length > 0 ? '#E74C3C' : 'var(--ink-3)', icon: 'activity', sub: 'active sessions' },
                  { label: 'Total Students', value: studentsList.length, color: '#2980B9', icon: 'users', sub: 'in your sections' },
                  { label: 'Total Results', value: results.length, color: '#27AE60', icon: 'bar-chart', sub: 'submissions' },
                  { label: 'Pass Rate', value: (() => { const n = results.length; if (n === 0) return '–'; const p = results.filter(r => r.total_items > 0 && (r.score / r.total_items) >= 0.75).length; return `${Math.round((p / n) * 100)}%`; })(), color: '#16A085', icon: 'trend-up', sub: '≥75% passing' },
                ].map(card => (
                  <div key={card.label} style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)', borderRadius: 'var(--r-md)', padding: '16px 14px', textAlign: 'center' }}>
                    <Icon name={card.icon} size={20} color={card.color} style={{ marginBottom: 8 }} />
                    <div style={{ fontSize: 24, fontWeight: 800, color: card.color, lineHeight: 1 }}>{card.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, marginTop: 4 }}>{card.label}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2 }}>{card.sub}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.08em' }}>Your Exams</div>
                  {examsList.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--ink-4)' }}>No exams yet — create one in Manage Exams.</p>
                  ) : examsList.slice(0, 6).map(e => (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', marginBottom: 5 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: e.is_open ? '#27AE60' : 'var(--ink-4)', flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{e.target_section}</span>
                    </div>
                  ))}
                  {examsList.length > 6 && <p style={{ fontSize: 12, color: 'var(--ink-4)', margin: '4px 0 0' }}>+{examsList.length - 6} more — view all in Manage Exams</p>}
                </div>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.08em' }}>Quick Actions</div>
                  {[
                    { label: 'Manage Exams', icon: 'clipboard', view: 'manage' },
                    { label: 'View Results', icon: 'bar-chart', view: 'results' },
                    { label: 'Live Monitor', icon: 'activity', view: 'live' },
                    { label: 'Student Roster', icon: 'users', view: 'students' },
                  ].map(action => (
                    <button
                      key={action.view}
                      onClick={() => setActiveView(action.view)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: '9px 12px', marginBottom: 6,
                        background: 'var(--surface-2)', border: '1px solid var(--line)',
                        borderRadius: 'var(--r-sm)', cursor: 'pointer',
                        fontSize: 13, fontWeight: 500, color: 'var(--ink-1)',
                        transition: 'all var(--t-1)',
                      }}
                    >
                      <Icon name={action.icon} size={15} color="var(--navy)" />
                      {action.label}
                      <Icon name="chevron-right" size={14} color="var(--ink-4)" style={{ marginLeft: 'auto' }} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* --- RESULTS PANEL --- */}
        {activeView === 'results' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-0.02em' }}>Results</h1>
                <p style={{ color: 'var(--ink-3)', margin: '4px 0 0', fontSize: 13.5 }}>Submitted scores across all your exams.</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost sm" onClick={exportCSV}><Icon name="download" size={14} /> Export CSV</button>
              </div>
            </div>

            {/* Rescore banner — only for 0/0 rows, which is exactly what
                rescoreZeroResults() repairs. Do not widen this to 0/N: the
                dashboard query does not select answers_json, so any test on it
                is always true and the banner would never clear. */}
            {results.some(r =>
              r.total_items === 0 && instructorExamIdsRef.current.has(r.exam_id)
            ) && (
              <div style={{ background: 'var(--warn-bg, #FFF8E1)', border: '1.5px solid var(--warn-bd, #F9A825)', borderRadius: 'var(--r-lg)', padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="alert" size={16} color="#B8860B" />
                  <span style={{ fontWeight: 600, color: '#7B5800', fontSize: 14 }}>Some results show 0/0</span>
                  <span style={{ color: '#A07000', fontSize: 13 }}>— answers are saved on the server and can be re-scored</span>
                </div>
                <button
                  className="btn sm"
                  onClick={rescoreZeroResults}
                  disabled={isRescoring}
                  style={{ background: '#F9A825', borderColor: '#F9A825', color: '#1a1000', width: 'auto', fontWeight: 700 }}
                >
                  {isRescoring ? 'Re-scoring…' : 'Fix 0/0 Results'}
                </button>
              </div>
            )}

            {/* Filters */}
            <div className="card" style={{ padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label className="label">Filter by Exam</label>
                <select className="input" style={{ width: 'auto', minWidth: 200, display: 'inline-block' }} value={selectedExam} onChange={e => setSelectedExam(e.target.value)}>
                  <option value="All">All Exams</option>
                  {Object.entries(examsDict).map(([id, title]) => (
                    <option key={id} value={id}>{title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Filter by Section</label>
                <select className="input" style={{ width: 'auto', minWidth: 160, display: 'inline-block' }} value={selectedSection} onChange={e => setSelectedSection(e.target.value)}>
                  {uniqueSections.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Sort by</label>
                <select className="input" style={{ width: 'auto', minWidth: 180, display: 'inline-block' }} value={resultSort} onChange={e => setResultSort(e.target.value)}>
                  <option value="section">Section (A–Z)</option>
                  <option value="name">Name (A–Z)</option>
                  <option value="score_desc">Score (Highest First)</option>
                  <option value="score_asc">Score (Lowest First)</option>
                </select>
              </div>
              <span className="px-pill brand" style={{ marginLeft: 'auto' }}>{filteredAndSortedResults.length} student{filteredAndSortedResults.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Stats */}
            {resultStats && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14, marginBottom: 16 }}>
                <div className="card" style={{ padding: 18 }}>
                  <h4 style={{ marginBottom: 12 }}>Quick stats</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                      { label: 'Mean', value: `${resultStats.mean.toFixed(1)}%` },
                      { label: 'Median', value: `${resultStats.median.toFixed(1)}%` },
                      { label: 'Pass rate', value: `${resultStats.passRate.toFixed(1)}%` },
                      { label: 'Highest', value: `${resultStats.highest.toFixed(1)}%` },
                    ].map(s => (
                      <div key={s.label} style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8 }}>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>{s.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: 2 }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card" style={{ padding: 18 }}>
                  <h4 style={{ marginBottom: 12 }}>Score distribution</h4>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={resultStats.distribution} margin={{ top: 4, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
                      <Tooltip formatter={(value) => [`${value} student${value !== 1 ? 's' : ''}`, 'Count']} contentStyle={{ fontSize: '12px', borderRadius: '6px' }} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {resultStats.distribution.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="table-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Section</th>
                      <th>Exam</th>
                      <th style={{ textAlign: 'right' }}>Score</th>
                      <th>Time</th>
                      <th>Violations</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedResults.length === 0 ? (
                      <tr><td colSpan="7" style={{ padding: '24px', textAlign: 'center', color: 'var(--ink-4)' }}>No results found.</td></tr>
                    ) : (
                      filteredAndSortedResults.map((row, index) => {
                        const student = students[row.student_id] || { name: 'Unknown', section: 'Unknown' };
                        const examTitle = examsDict[row.exam_id] || 'Unknown Exam';
                        const percentage = row.total_items > 0 ? Math.round((row.score / row.total_items) * 100) : 0;
                        const essayCount = (examQuestionsCache[row.exam_id] || []).filter(q => q.question_type === 'essay').length;
                        return (
                          <tr key={index}>
                            <td style={{ fontWeight: 600 }}>{student.name}</td>
                            <td><span className="px-pill brand">{student.section}</span></td>
                            <td style={{ color: 'var(--ink-2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{examTitle}</td>
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                                <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{row.score}/{row.total_items}</span>
                                <span style={{ color: percentage >= 75 ? 'var(--ok)' : 'var(--warn)', fontWeight: 600, fontSize: 12 }}>{percentage}%</span>
                                {/* Manual edit pencil — shown when answers are missing (data lost from force-submit bug) */}
                                {row.total_items > 0 && (!row.answers_json || Object.keys(row.answers_json).length === 0) && (
                                  <button
                                    title="Enter score manually"
                                    onClick={() => { setManualScoreModal({ student_id: row.student_id, exam_id: row.exam_id, student_name: students[row.student_id]?.name || 'Student', exam_title: examsDict[row.exam_id] || 'Exam', total_items: row.total_items }); setManualScoreValue(String(row.score)); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--info)', fontSize: 13, lineHeight: 1 }}
                                  >✏️</button>
                                )}
                              </div>
                              {essayCount > 0 && <span style={{ display: 'block', fontSize: 11, color: 'var(--info)', marginTop: 2, textAlign: 'right' }}>+{essayCount} essay{essayCount !== 1 ? 's' : ''}</span>}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink-3)' }}>{row.time_taken_seconds > 0 ? formatTime(row.time_taken_seconds) : 'N/A'}</td>
                            <td>
                              {row.tab_switches > 0
                                ? <span className="px-pill bad"><Icon name="flag" size={11} /> {row.tab_switches}</span>
                                : <span className="px-pill ok"><Icon name="check" size={10} /> Clean</span>
                              }
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button onClick={() => openStudentDetails(row)} className="btn ghost sm"><Icon name="eye" size={13} /></button>
                                <button onClick={() => deleteResult(row.student_id, row.exam_id)} className="btn ghost sm" style={{ color: 'var(--bad)', borderColor: 'var(--bad-bd)' }}><Icon name="trash" size={13} /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

{/* --- MANAGE EXAMS PANEL --- */}
        {activeView === 'manage' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-0.02em' }}>Manage Exams</h1>
                <p style={{ color: 'var(--ink-3)', margin: '4px 0 0', fontSize: 13.5 }}>Edit titles, sections, time limits, and passwords.</p>
              </div>
            </div>

            <div className="card" style={{ overflow: 'hidden', marginBottom: 20 }}>
            <div className="table-scroll">
            <table className="tbl">
            <thead>
              <tr>
              <th>Exam Title</th>
              <th>Target Section</th>
              <th>Status</th>
              <th>Time Limit</th>
              <th>Exam Password</th>
              <th>Actions</th>
            </tr>
            </thead>
           <tbody>
            {examsList.map((exam) => (
              <tr key={exam.id}>
                <td>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="text"
                      value={editingTitles[exam.id] ?? exam.title}
                      onChange={e => setEditingTitles(prev => ({ ...prev, [exam.id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && saveTitle(exam.id)}
                      className="input"
                      style={{ width: 200, padding: '7px 10px', fontSize: 13 }}
                    />
                    {(editingTitles[exam.id] ?? exam.title) !== exam.title && (
                      <button onClick={() => saveTitle(exam.id)} className="btn sm">Save</button>
                    )}
                  </div>
                </td>

               {/* Section Field */}
                <td>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      value={editingSections[exam.id] !== undefined ? editingSections[exam.id] : ''}
                      onChange={(e) => setEditingSections(prev => ({ ...prev, [exam.id]: e.target.value }))}
                      placeholder="e.g. Aero 101"
                      className="input"
                      style={{ width: 140, padding: '7px 10px', fontSize: 13 }}
                    />
                    <button onClick={() => saveSection(exam.id)} className="btn sm" style={{ opacity: editingSections[exam.id] !== (examsList.find(e => e.id === exam.id)?.target_section ?? '') ? 1 : 0.4 }}>Save</button>
                    {/* Co-instructor buttons per unique section name on this exam */}
                    {(exam.target_section || '').split(',').map(s => s.trim()).filter(Boolean).map(sec => (
                      <button
                        key={sec}
                        className="btn ghost sm"
                        onClick={() => { setSectionCoModal(sec); setSectionCoTarget(''); }}
                        style={{ fontSize: 11, padding: '3px 8px', width: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}
                        title={`Manage co-instructors for ${sec}`}
                      >
                        <Icon name="users" size={12} color="var(--navy)" />
                        {sec}
                        {(sectionCoMap[sec] || []).length > 0 && (
                          <span className="px-pill info" style={{ fontSize: 10, padding: '1px 5px' }}>{(sectionCoMap[sec] || []).length}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </td>

                {/* Toggle */}
                <td>
                  <button
                    onClick={() => toggleExamStatus(exam.id, exam.is_open)}
                    className={`px-pill ${exam.is_open ? 'ok' : 'muted'}`}
                    style={{ border: 'none', cursor: 'pointer' }}
                  >
                    {exam.is_open ? <><Icon name="dot" size={10} /> Open</> : <>Closed</>}
                  </button>
                </td>

                {/* Time */}
                <td>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="number"
                      value={editingTimes[exam.id] || ''}
                      onChange={(e) => handleTimeChange(exam.id, e.target.value)}
                      className="input"
                      style={{ width: 64, padding: '7px 10px', fontSize: 13 }}
                    />
                    <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>min</span>
                    <button onClick={() => saveTimeLimit(exam.id)} className="btn sm" style={{ opacity: editingTimes[exam.id] != (examsList.find(e => e.id === exam.id)?.duration_minutes ?? '') ? 1 : 0.4 }}>Save</button>
                  </div>
                </td>

                {/* Password */}
                <td>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="text"
                      value={editingPasswords[exam.id] !== undefined ? editingPasswords[exam.id] : ''}
                      onChange={(e) => setEditingPasswords(prev => ({ ...prev, [exam.id]: e.target.value }))}
                      placeholder="No password"
                      className="input"
                      style={{ width: 110, padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font-mono)' }}
                    />
                    <button onClick={() => savePassword(exam.id)} className="btn sm" style={{ opacity: editingPasswords[exam.id] !== (exam.exam_password || '') ? 1 : 0.4 }}>Save</button>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Icon name={exam.exam_password ? 'lock' : 'unlock'} size={10} />
                    {exam.exam_password ? 'Password set' : 'No password'}
                  </span>
                </td>

                {/* Actions */}
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => openDupModal(exam)} className="btn ghost sm"><Icon name="copy" size={13} /> Duplicate</button>
                    <button onClick={() => openShareModal(exam)} className="btn ghost sm" style={{ position: 'relative' }}>
                      <Icon name="users" size={13} /> Share
                      {(sharesMap[exam.id] || []).length > 0 && (
                        <span style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: '50%', background: 'var(--navy)', color: 'white', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {(sharesMap[exam.id] || []).length}
                        </span>
                      )}
                    </button>
                    <button onClick={() => openExamStats(exam.id)} className="btn ghost sm"><Icon name="bar-chart" size={13} /></button>
                    <button onClick={() => deleteExam(exam.id)} className="btn ghost sm" style={{ color: 'var(--bad)', borderColor: 'var(--bad-bd)' }}><Icon name="trash" size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
          </div>{/* end table-scroll */}
          </div>{/* end card */}

          {/* Shared With Me */}
          {sharedExamsList.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Icon name="users" size={16} color="var(--navy)" />
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--ink-1)' }}>Shared With Me</h4>
                <span className="px-pill brand">{sharedExamsList.length}</span>
              </div>
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="table-scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Exam Title</th>
                        <th>Section</th>
                        <th>Status</th>
                        <th>Shared By</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sharedExamsList.map(exam => {
                        const owner = instructorsList.find(i => i.id === exam.shared_by);
                        return (
                          <tr key={exam.share_id}>
                            <td><span style={{ fontWeight: 500 }}>{exam.title}</span></td>
                            <td>{exam.target_section || '—'}</td>
                            <td>
                              <span className={`px-pill ${exam.is_open ? 'ok' : 'muted'}`}>
                                {exam.is_open ? <><Icon name="dot" size={10} /> Open</> : <>Closed</>}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                                {owner?.full_name || owner?.email || 'Unknown Instructor'}
                              </span>
                            </td>
                            <td>
                              <button
                                onClick={() => { if (window.confirm('Remove this shared exam from your dashboard?')) removeSharedAccess(exam.share_id); }}
                                className="btn ghost sm"
                                style={{ color: 'var(--bad)', borderColor: 'var(--bad-bd)' }}
                              >
                                <Icon name="x" size={13} /> Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Create New Exam */}
          <div style={{ background: 'var(--navy-50)', border: '2px dashed var(--navy-200)', borderRadius: 'var(--r-lg)', padding: '20px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <h4 style={{ margin: 0, color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="plus" size={16} color="var(--navy)" /> Create New Exam</h4>
              <button onClick={downloadCSVTemplate} className="btn ghost sm"><Icon name="download" size={13} /> Download Template</button>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 2, minWidth: '200px' }}>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-2)' }}>Exam Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="e.g. Midterm – Air Navigation"
                  style={{ padding: '9px 12px', border: '1.5px solid var(--border)', borderRadius: '6px', width: '100%', fontSize: '14px' }}
                />
              </div>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '5px', fontSize: '13px', color: 'var(--text-2)' }}>Target Section</label>
                <input
                  type="text"
                  value={targetSection}
                  onChange={e => setTargetSection(e.target.value)}
                  placeholder="e.g. Aero 101"
                  style={{ padding: '9px 12px', border: '1.5px solid var(--border)', borderRadius: '6px', width: '100%', fontSize: '14px' }}
                />
              </div>
            </div>

            {/* CSV Upload row */}
            <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <label className="btn ghost sm" style={{ width: 'auto', cursor: 'pointer', ...(csvExamParsed ? { borderColor: 'var(--ok-bd)', color: 'var(--ok)', background: 'var(--ok-bg)' } : {}) }}>
                <Icon name={csvExamParsed ? 'check' : 'file-text'} size={14} />
                {csvExamParsed ? `${csvExamParsed.questions.length} questions loaded` : 'Upload Questions CSV (optional)'}
                <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleCsvFileSelect(e, setCsvExamParsed)} />
              </label>
              {csvExamParsed && (
                <button onClick={() => setCsvExamParsed(null)} style={{ background: 'none', border: 'none', color: 'var(--bad)', fontWeight: 700, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
              )}
              {csvExamParsed?.errors?.length > 0 && (
                <span style={{ color: 'var(--bad)', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="alert" size={13} color="var(--bad)" /> {csvExamParsed.errors.length} row error{csvExamParsed.errors.length !== 1 ? 's' : ''} — fix CSV and re-upload
                </span>
              )}
              {csvExamParsed && csvExamParsed.errors.length === 0 && (
                <span style={{ fontSize: '12px', color: 'var(--text-4)' }}>
                  {csvExamParsed.questions.filter(q => q.question_type !== 'essay').length} MC · {csvExamParsed.questions.filter(q => q.question_type === 'essay').length} Essay
                </span>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <button
                onClick={createExam}
                disabled={!newTitle.trim() || !targetSection.trim() || (csvExamParsed?.errors?.length > 0)}
                className="btn"
              >
                <Icon name="plus" size={15} />
                {csvExamParsed?.questions?.length > 0 ? `Create Exam + Import ${csvExamParsed.questions.length} Questions` : 'Create Exam'}
              </button>
            </div>
          </div>
          </div>
        )}

      {/* --- TAB 3: MANAGE STUDENTS --- */}
        {activeView === 'students' && (() => {
          // Sort by section then name
          const sortedStudents = [...studentsList].sort((a, b) => {
            const secCmp = (a.section || '￿').localeCompare(b.section || '￿');
            if (secCmp !== 0) return secCmp;
            return (a.full_name || '').localeCompare(b.full_name || '');
          });

          const filteredStudents = studentSectionFilter === 'All'
            ? sortedStudents
            : sortedStudents.filter(s =>
                (s.section || '').split(',').map(x => x.trim()).includes(studentSectionFilter)
              );

          // Unique sections for the filter dropdown (from the full list)
          const studentSections = ['All', ...[...new Set(
            studentsList.flatMap(s => (s.section || '').split(',').map(x => x.trim()).filter(Boolean))
          )].sort()];

          // Group filtered students by section for section headers
          const groups = [];
          let lastSection = null;
          filteredStudents.forEach(student => {
            const sec = student.section || '';
            if (sec !== lastSection) {
              groups.push({ type: 'header', section: sec || 'No Section' });
              lastSection = sec;
            }
            groups.push({ type: 'student', student });
          });

          return (
            <div>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-0.02em' }}>Students</h1>
                  <p style={{ color: 'var(--ink-3)', margin: '4px 0 0', fontSize: 13.5 }}>
                    {instructorSections.size > 0 ? `Sections: ${[...instructorSections].join(', ')} · ` : ''}{studentsList.length} student{studentsList.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <button className="btn ghost sm" onClick={downloadStudentCSVTemplate}>
                  <Icon name="download" size={13} /> Download Template
                </button>
              </div>

              {/* Section filter bar */}
              <div className="card" style={{ padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <label className="label" style={{ margin: 0, whiteSpace: 'nowrap' }}>Section</label>
                <select
                  value={studentSectionFilter}
                  onChange={e => { setStudentSectionFilter(e.target.value); setSelectedStudentIds(new Set()); }}
                  className="input"
                  style={{ width: 'auto', minWidth: 160, display: 'inline-block', padding: '7px 10px' }}
                >
                  {studentSections.map(sec => (
                    <option key={sec} value={sec}>{sec === 'All' ? 'All Sections' : sec}</option>
                  ))}
                </select>
                <span className="px-pill brand">{filteredStudents.length} student{filteredStudents.length !== 1 ? 's' : ''}</span>
                {studentSectionFilter !== 'All' && (
                  <button onClick={() => { setStudentSectionFilter('All'); setSelectedStudentIds(new Set()); }} className="btn ghost sm"><Icon name="x" size={12} /> Clear</button>
                )}
              </div>

              {/* Batch bar */}
              <div className="card" style={{ padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderColor: selectedStudentIds.size > 0 ? 'var(--navy-200)' : 'var(--line)', background: selectedStudentIds.size > 0 ? 'var(--navy-50)' : 'var(--surface)' }}>
                <span style={{ fontWeight: 600, color: 'var(--ink-2)', fontSize: 13, minWidth: 160 }}>
                  {selectedStudentIds.size > 0 ? `${selectedStudentIds.size} selected` : 'Select students to batch edit'}
                </span>
                <input
                  type="text"
                  value={batchSection}
                  onChange={e => setBatchSection(e.target.value)}
                  placeholder="New section name"
                  className="input"
                  style={{ flex: 1, minWidth: 180, padding: '7px 10px' }}
                />
                <button onClick={batchUpdateSection} disabled={isBatchSaving || selectedStudentIds.size === 0 || !batchSection.trim()} className="btn sm">
                  {isBatchSaving ? 'Saving…' : 'Apply to Selected'}
                </button>
                {selectedStudentIds.size > 0 && (
                  <>
                    <button onClick={batchDeleteStudents} disabled={isBatchSaving} className="btn sm danger"><Icon name="trash" size={13} /> Delete Selected</button>
                    <button onClick={() => setSelectedStudentIds(new Set())} className="btn ghost sm">Clear</button>
                  </>
                )}
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
              <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                        checked={filteredStudents.length > 0 && filteredStudents.every(s => selectedStudentIds.has(s.id))}
                        onChange={e => {
                          if (e.target.checked) setSelectedStudentIds(prev => new Set([...prev, ...filteredStudents.map(s => s.id)]));
                          else setSelectedStudentIds(prev => { const next = new Set(prev); filteredStudents.forEach(s => next.delete(s.id)); return next; });
                        }}
                      />
                    </th>
                    <th>Student Name</th>
                    <th>Section</th>
                    <th>Edit Section</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.length === 0 ? (
                    <tr><td colSpan="5" style={{ padding: '24px', textAlign: 'center', color: 'var(--ink-4)' }}>No students found.</td></tr>
                  ) : (
                    groups.map((item, idx) => {
                      if (item.type === 'header') {
                        return (
                          <tr key={`sec-${item.section}-${idx}`}>
                            <td colSpan="5" style={{ padding: '8px 14px', background: 'var(--navy-50)', borderTop: idx > 0 ? '1px solid var(--line)' : 'none', fontWeight: 700, fontSize: 11, color: 'var(--navy)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                              {item.section}
                            </td>
                          </tr>
                        );
                      }
                      const { student } = item;
                      const isChecked = selectedStudentIds.has(student.id);
                      return (
                        <tr
                          key={student.id}
                          style={{ background: isChecked ? 'var(--navy-50)' : undefined, cursor: 'pointer' }}
                          onClick={() => {
                            setSelectedStudentIds(prev => {
                              const next = new Set(prev);
                              if (next.has(student.id)) next.delete(student.id);
                              else next.add(student.id);
                              return next;
                            });
                          }}
                        >
                          <td onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              style={{ width: 16, height: 16, cursor: 'pointer' }}
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
                          <td style={{ fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--navy-100)', color: 'var(--navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                                {(student.full_name || '?').split(' ').slice(0,2).map(n => n[0]).join('').toUpperCase()}
                              </div>
                              {student.full_name || 'Unknown'}
                            </div>
                          </td>
                          <td><span className="px-pill brand">{student.section || '—'}</span></td>
                          <td onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input
                                type="text"
                                value={editingStudentSections[student.id] !== undefined ? editingStudentSections[student.id] : ''}
                                onChange={(e) => setEditingStudentSections(prev => ({ ...prev, [student.id]: e.target.value }))}
                                placeholder="e.g. Aero 101"
                                className="input"
                                style={{ width: 160, padding: '6px 10px', fontSize: 13 }}
                              />
                              <button onClick={() => saveStudentSection(student.id)} className="btn sm" style={{ opacity: editingStudentSections[student.id] !== student.section ? 1 : 0.4 }}>Save</button>
                            </div>
                          </td>
                          <td onClick={e => e.stopPropagation()}>
                            <button onClick={() => deleteStudent(student.id)} className="btn ghost sm" style={{ color: 'var(--bad)', borderColor: 'var(--bad-bd)' }}>
                              <Icon name="trash" size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              </div>{/* end table-scroll */}
              </div>{/* end card */}

              {/* CSV IMPORT CARD */}
              <div className="card" style={{ marginTop: 16, padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
                  <h4 style={{ margin: 0, color: 'var(--ink-1)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="upload" size={15} color="var(--navy)" /> Import Students from CSV
                  </h4>
                  <button className="btn ghost sm" onClick={downloadStudentCSVTemplate} style={{ width: 'auto' }}>
                    <Icon name="download" size={13} /> Download Template
                  </button>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ink-3)' }}>
                  CSV columns: <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3 }}>full_name, student_email, student_id, section</code> — duplicates (by email or Student ID) are skipped automatically.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <label
                    className="btn ghost sm"
                    style={{ width: 'auto', cursor: 'pointer', ...(studentCsvParsed ? { borderColor: 'var(--ok-bd)', color: 'var(--ok)', background: 'var(--ok-bg)' } : {}) }}
                  >
                    <Icon name={studentCsvParsed ? 'check' : 'file-text'} size={14} />
                    {studentCsvParsed ? `${studentCsvParsed.students.length} students ready` : 'Choose CSV file'}
                    <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => {
                      const file = e.target.files[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => setStudentCsvParsed(parseStudentCSV(ev.target.result));
                      reader.readAsText(file);
                      e.target.value = '';
                    }} />
                  </label>

                  {studentCsvParsed && studentCsvParsed.errors.length === 0 && (
                    <button
                      className="btn sm"
                      onClick={importStudentsFromCSV}
                      disabled={studentCsvImporting || studentCsvParsed.students.length === 0}
                      style={{ width: 'auto', opacity: studentCsvImporting ? 0.7 : 1 }}
                    >
                      {studentCsvImporting ? 'Importing…' : `Import ${studentCsvParsed.students.length} Student${studentCsvParsed.students.length !== 1 ? 's' : ''}`}
                    </button>
                  )}

                  {studentCsvParsed && (
                    <button
                      onClick={() => setStudentCsvParsed(null)}
                      style={{ background: 'none', border: 'none', color: 'var(--bad)', fontWeight: 700, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}
                    >×</button>
                  )}
                </div>

                {studentCsvParsed?.errors?.length > 0 && (
                  <div style={{ marginTop: 12, background: 'var(--bad-bg)', border: '1px solid var(--bad-bd)', borderRadius: 'var(--r-sm)', padding: '10px 14px' }}>
                    <p style={{ margin: '0 0 6px', fontWeight: 700, color: 'var(--bad)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="alert" size={14} color="var(--bad)" /> Fix these errors before importing:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--bad)', fontSize: 12 }}>
                      {studentCsvParsed.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              {/* ADD STUDENT FORM */}
              <div style={{ marginTop: 16, background: 'var(--navy-50)', border: '2px dashed var(--navy-200)', borderRadius: 'var(--r-lg)', padding: '20px 24px' }}>
                <h4 style={{ margin: '0 0 16px 0', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="user-plus" size={16} color="var(--navy)" /> Add New Student</h4>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: 2, minWidth: '160px' }}>
                    <label className="label">Full Name</label>
                    <input className="input" type="text" value={newStudentName} onChange={e => setNewStudentName(e.target.value)} placeholder="e.g. Juan dela Cruz" maxLength={120} />
                  </div>
                  <div style={{ flex: 2, minWidth: '180px' }}>
                    <label className="label">Student Email</label>
                    <input className="input" type="email" value={newStudentEmail} onChange={e => setNewStudentEmail(e.target.value)} placeholder="e.g. juan@patts.edu.ph" maxLength={254} />
                  </div>
                  <div style={{ flex: 1, minWidth: '130px' }}>
                    <label className="label">Student ID</label>
                    <input className="input" style={{ fontFamily: 'var(--font-mono)' }} type="text" value={newStudentCode} onChange={e => setNewStudentCode(e.target.value)} placeholder="e.g. 2021-1-1234" maxLength={30} />
                  </div>
                  <div style={{ flex: 1, minWidth: '130px' }}>
                    <label className="label">Section</label>
                    <input className="input" type="text" value={newStudentSection} onChange={e => setNewStudentSection(e.target.value)} placeholder="e.g. Aero 101" maxLength={60} list="instructor-sections-list" />
                    <datalist id="instructor-sections-list">
                      {[...instructorSections].map(sec => <option key={sec} value={sec} />)}
                    </datalist>
                  </div>
                </div>
                <div style={{ marginTop: '14px' }}>
                  <button className="btn" onClick={createStudent} disabled={isAddingStudent || !newStudentName.trim() || !newStudentEmail.trim() || !newStudentCode.trim() || !newStudentSection.trim()} style={{ opacity: isAddingStudent ? 0.7 : 1 }}>
                    <Icon name="user-plus" size={15} color="white" />
                    {isAddingStudent ? 'Adding…' : 'Add Student'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

{/* --- TAB 4: LIVE MONITOR --- */}
        {activeView === 'live' && (() => {
          // Hide sessions only when BOTH a result exists AND the session is not actively locked/being watched
          // Keeps students visible if they are still in the exam even if a stale result exists
          const activeSessions = liveSessions.filter(s => {
            const hasResult = results.some(r => r.student_id === s.student_id && r.exam_id === s.exam_id);
            // If locked, always keep visible so instructor can manage them
            if (s.status === 'locked') return true;
            return !hasResult;
          });
          const stuckCount = liveSessions.length - activeSessions.length;
          const forceSubmittable = activeSessions.filter(isSessionForceSubmittable);

          return (
            <div>
              {/* Force-submit warning banner */}
              {forceSubmittable.length > 0 && (
                <div style={{ background: 'var(--warn-bg, #FFF8E1)', border: '1.5px solid var(--warn-bd, #F9A825)', borderRadius: 'var(--r-lg)', padding: '12px 16px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="alert" size={16} color="#B8860B" />
                    <span style={{ fontWeight: 600, color: '#7B5800', fontSize: 14 }}>
                      {forceSubmittable.length} student{forceSubmittable.length !== 1 ? 's' : ''} need{forceSubmittable.length === 1 ? 's' : ''} force submission
                    </span>
                    <span style={{ color: '#A07000', fontSize: 13 }}>— time expired or exam closed</span>
                  </div>
                  <button
                    className="btn sm"
                    onClick={() => setForceSubmitConfirmList(forceSubmittable)}
                    style={{ background: '#F9A825', borderColor: '#F9A825', color: '#1a1000', width: 'auto', fontWeight: 700 }}
                  >
                    <Icon name="send" size={13} color="#1a1000" /> Force Submit All ({forceSubmittable.length})
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '10px' }}>
                <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className="px-pill live" style={{ fontSize: '12px' }}>{activeSessions.length} active</span>
                  Live Exam Monitor
                </h1>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span className="eyebrow">Sort:</span>
                  <button className={`btn ghost sm${liveSort === 'name' ? '' : ''}`} onClick={() => applyLiveSort('name')} style={liveSort === 'name' ? { background: 'var(--navy)', color: 'white', borderColor: 'var(--navy)' } : {}}>A–Z Name</button>
                  <button className="btn ghost sm" onClick={() => applyLiveSort('section')} style={liveSort === 'section' ? { background: 'var(--navy)', color: 'white', borderColor: 'var(--navy)' } : {}}>By Section</button>
                  {stuckCount > 0 && (
                    <button className="btn ghost sm" onClick={clearStuckSessions}>
                      <Icon name="x" size={14} /> Clear {stuckCount} Finished
                    </button>
                  )}
                </div>
              </div>
              <p style={{ color: 'var(--ink-3)', marginBottom: '16px', fontSize: '13px' }}>Order is locked once set — student data updates in place without shuffling rows.</p>

              <div className="card" style={{ overflow: 'hidden' }}>
              <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Exam Taking</th>
                    <th>Status</th>
                    <th>Answered</th>
                    <th>Violations</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSessions.length === 0 ? (
                    <tr><td colSpan="6" style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-3)' }}>No students currently taking an exam.</td></tr>
                  ) : (
                    activeSessions.map(session => (
                      <tr key={session.id} style={
                        session.status === 'locked' ? { background: 'var(--bad-bg)' }
                        : isSessionForceSubmittable(session) ? { background: 'var(--warn-bg, #FFFDE7)' }
                        : {}
                      }>
                        <td style={{ fontWeight: 600, color: 'var(--ink-1)' }}>{session.student_name}</td>
                        <td style={{ color: 'var(--navy)', fontWeight: 500 }}>{examsDict[session.exam_id] || '—'}</td>
                        <td>
                          {session.status === 'locked'
                            ? <span className="px-pill bad"><Icon name="lock" size={11} /> LOCKED</span>
                            : isSessionForceSubmittable(session)
                              ? <span className="px-pill" style={{ background: '#FFF3CD', color: '#856404', border: '1px solid #FFDA6A', fontSize: 11 }}>
                                  <Icon name="alert" size={11} color="#856404" /> TIMED OUT
                                </span>
                              : <span className="px-pill ok"><Icon name="dot" size={11} /> Active</span>}
                        </td>
                        <td style={{ fontWeight: 700, color: 'var(--ink-1)' }}>{session.answers_count}</td>
                        <td>
                          <div style={{ position: 'relative', display: 'inline-block' }}
                            onMouseEnter={e => {
                              if (session.violation_count > 0) {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setLiveViolationTooltip({ session, rect });
                              }
                            }}
                            onMouseLeave={() => setLiveViolationTooltip(null)}
                          >
                            <span
                              className={`px-pill ${session.violation_count >= 2 ? 'bad' : session.violation_count === 1 ? 'warn' : 'ok'}`}
                              style={session.violation_count > 0 ? { cursor: 'help', textDecoration: 'underline dotted', textUnderlineOffset: 3 } : {}}
                            >
                              {session.violation_count}
                              {session.violation_count > 0 && <Icon name="flag" size={10} style={{ marginLeft: 4 }} />}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {isSessionForceSubmittable(session) ? (
                              <button
                                className="btn sm"
                                onClick={() => setForceSubmitConfirmList([session])}
                                style={{ width: 'auto', background: '#F9A825', borderColor: '#F9A825', color: '#1a1000', fontWeight: 700 }}
                              >
                                <Icon name="send" size={13} color="#1a1000" /> Force Submit
                              </button>
                            ) : (
                              <button className={`btn sm ${session.status === 'locked' ? '' : 'danger'}`} onClick={() => toggleStudentLock(session.id, session.status)} style={{ width: 'auto' }}>
                                {session.status === 'locked' ? <><Icon name="unlock" size={13} /> Unlock</> : <><Icon name="lock" size={13} /> Lock</>}
                              </button>
                            )}
                            <button className="btn ghost sm" onClick={() => dismissSession(session.id)} style={{ width: 'auto' }}>
                              <Icon name="x" size={13} /> Dismiss
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>{/* end table-scroll */}
              </div>{/* end card */}
            </div>
          );
        })()}

      {/* --- TAB 5: ATTENDANCE --- */}
      {activeView === 'attendance' && (() => {
        const examObj = examsList.find(e => e.id === attendanceExam);

        // Show all instructor students — filter by section if one is selected,
        // otherwise scope to the selected exam's sections so the list isn't overwhelming.
        let eligibleStudents = studentsList;
        if (attendanceSection !== 'All') {
          // Specific section chosen: show those students regardless of which exam
          eligibleStudents = studentsList.filter(s =>
            s.section && s.section.split(',').map(x => x.trim()).includes(attendanceSection)
          );
        } else if (examObj?.target_section) {
          // "All" selected: scope to the exam's sections
          const examSections = examObj.target_section.split(',').map(s => s.trim().toLowerCase());
          eligibleStudents = studentsList.filter(s => {
            if (!s.section) return false;
            return s.section.split(',').map(x => x.trim().toLowerCase()).some(sec => examSections.includes(sec));
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

        // Collect sections from both exam targets AND student records
        // so every section a student belongs to is always filterable
        const allAttendanceSections = new Set([
          ...instructorSections,
          ...studentsList.flatMap(s =>
            (s.section || '').split(',').map(x => x.trim()).filter(Boolean)
          ),
        ]);
        const sectionOptions = allAttendanceSections.size > 0
          ? ['All', ...[...allAttendanceSections].sort()]
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
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>Attendance Overview</h1>
            </div>

            {/* Filters */}
            <div className="card" style={{ padding: '16px 20px', marginBottom: '20px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label className="label">Select Exam</label>
                <select className="input" style={{ width: 'auto', minWidth: '200px' }} value={attendanceExam} onChange={e => { setAttendanceExam(e.target.value); setAttendanceSection('All'); }}>
                  <option value="">— Choose an exam —</option>
                  {sharedExamsList.length > 0 ? (
                    <>
                      <optgroup label="My Exams">
                        {examsList.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                      </optgroup>
                      <optgroup label="Shared With Me">
                        {sharedExamsList.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                      </optgroup>
                    </>
                  ) : (
                    examsList.map(e => <option key={e.id} value={e.id}>{e.title}</option>)
                  )}
                </select>
              </div>
              {attendanceExam && (
                <div>
                  <label className="label">Filter by Section</label>
                  <select className="input" style={{ width: 'auto' }} value={attendanceSection} onChange={e => setAttendanceSection(e.target.value)}>
                    {sectionOptions.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                  </select>
                </div>
              )}
              {attendanceExam && eligibleStudents.length > 0 && (
                <button className="btn ghost sm" onClick={exportAttendanceCSV} style={{ marginBottom: 1 }}>
                  <Icon name="download" size={14} /> Export CSV
                </button>
              )}
            </div>

            {!attendanceExam ? (
              <p style={{ color: 'var(--ink-3)', textAlign: 'center', padding: '40px' }}>Select an exam above to see attendance.</p>
            ) : (
              <>
                {/* Summary pills */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  <span className="px-pill brand">Total: {eligibleStudents.length}</span>
                  <span className="px-pill ok">Done: {statusCounts.done}</span>
                  <span className="px-pill warn">Taking Exam: {statusCounts.active}</span>
                  <span className="px-pill bad">Locked: {statusCounts.locked}</span>
                  <span className="px-pill muted">Absent: {statusCounts.absent}</span>
                </div>

                {eligibleStudents.length === 0 ? (
                  <p style={{ color: 'var(--ink-3)', textAlign: 'center', padding: '20px' }}>No students found for this exam's section(s).</p>
                ) : (
                  <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="table-scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Student Name</th>
                        <th>Section</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligibleStudents.map((s, idx) => {
                        const st = getStatus(s.id);
                        const pillClass = { done: 'ok', active: 'warn', locked: 'bad', absent: 'muted' }[st] || 'muted';
                        const pillLabel = { done: 'Done', active: 'Taking Exam', locked: 'Locked', absent: 'Absent' }[st] || '—';
                        const rowBg = st === 'done' ? 'var(--ok-bg)' : st === 'locked' ? 'var(--bad-bg)' : st === 'active' ? 'var(--warn-bg)' : '';

                        return (
                          <tr key={s.id} style={rowBg ? { background: rowBg } : {}}>
                            <td style={{ color: 'var(--ink-4)', width: 40 }}>{idx + 1}</td>
                            <td style={{ fontWeight: 600 }}>{s.full_name || 'Unknown'}</td>
                            <td style={{ color: 'var(--ink-2)' }}>{s.section || '—'}</td>
                            <td><span className={`px-pill ${pillClass}`}>{pillLabel}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* --- TAB 6: QUESTION MANAGEMENT --- */}
      {activeView === 'questions' && (
        <div>
          <h1 style={{ margin: '0 0 20px', fontFamily: 'var(--font-display)' }}>Question Management</h1>

          {/* Exam selector */}
          <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
            <label className="label">Select Exam to Manage</label>
            <select className="input" style={{ maxWidth: '360px' }} value={qExamId} onChange={e => handleQExamChange(e.target.value)}>
              <option value="">— Choose an exam —</option>
              {sharedExamsList.length > 0 ? (
                <>
                  <optgroup label="My Exams">
                    {examsList.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                  </optgroup>
                  <optgroup label="Shared With Me">
                    {sharedExamsList.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                  </optgroup>
                </>
              ) : (
                examsList.map(e => <option key={e.id} value={e.id}>{e.title}</option>)
              )}
            </select>
          </div>

          {qExamId && (
            <>
              {/* Add / Edit Form */}
              <div className="card" style={{ padding: '20px 24px', marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--navy)' }}>
                  {editingQ
                    ? <><Icon name="pencil" size={15} color="var(--navy)" /> Editing Question #{qList.findIndex(q => q.id === editingQ.id) + 1}</>
                    : <><Icon name="plus" size={15} color="var(--navy)" /> Add New Question</>}
                </h4>

                {/* Question Type Toggle */}
                <div style={{ marginBottom: '16px' }}>
                  <label className="label">Question Type</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {[{ value: 'multiple_choice', label: 'Multiple Choice' }, { value: 'essay', label: 'Essay / Open-ended' }].map(({ value, label }) => (
                      <button key={value} type="button" className={`btn sm ${qForm.question_type === value ? '' : 'ghost'}`} onClick={() => setQForm(f => ({ ...f, question_type: value }))} style={{ width: 'auto' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label className="label">Question Text</label>
                  <textarea className="input" value={qForm.question_text} onChange={e => setQForm(f => ({ ...f, question_text: e.target.value }))} placeholder="Enter the question..." rows={3} style={{ resize: 'vertical' }} />
                </div>

                {/* Image / Figure */}
                <div style={{ marginBottom: '16px' }}>
                  <label className="label">Figure / Image <span style={{ fontWeight: 400, color: 'var(--ink-4)', letterSpacing: 0 }}>(optional)</span></label>
                  {qImagePreview ? (
                    <div>
                      <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', marginBottom: 8 }}>
                        <img
                          src={qImagePreview}
                          alt="Question figure preview"
                          style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain', display: 'block', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--line)', background: 'var(--surface-2)' }}
                        />
                        <button
                          type="button"
                          onClick={() => { setQImageFile(null); setQImagePreview(null); setQForm(f => ({ ...f, image_url: null })); }}
                          title="Remove image"
                          style={{ position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,.6)', border: 'none', color: 'white', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}
                        >×</button>
                      </div>
                      <label className="btn ghost sm" style={{ width: 'auto', cursor: 'pointer', display: 'inline-flex' }}>
                        <Icon name="image" size={13} /> Replace image
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (!f) return; setQImageFile(f); setQImagePreview(URL.createObjectURL(f)); e.target.value = ''; }} />
                      </label>
                    </div>
                  ) : (
                    <label className="btn ghost sm" style={{ width: 'auto', cursor: 'pointer', display: 'inline-flex' }}>
                      <Icon name="image" size={13} /> Upload image
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (!f) return; setQImageFile(f); setQImagePreview(URL.createObjectURL(f)); e.target.value = ''; }} />
                    </label>
                  )}
                </div>

                {qForm.question_type !== 'essay' && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                      {['a', 'b', 'c', 'd'].map((letter, i) => (
                        <div key={letter}>
                          <label className="label">
                            Choice {letter.toUpperCase()}
                            {Number(qForm.correct_answer) === i && <span className="px-pill ok" style={{ marginLeft: 8 }}>Correct</span>}
                          </label>
                          <input className="input" type="text" value={qForm[`choice_${letter}`]} onChange={e => setQForm(f => ({ ...f, [`choice_${letter}`]: e.target.value }))} placeholder={`Choice ${letter.toUpperCase()}...`} style={Number(qForm.correct_answer) === i ? { borderColor: 'var(--ok)', boxShadow: '0 0 0 3px var(--ok-bg)' } : {}} />
                        </div>
                      ))}
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                      <label className="label">Correct Answer</label>
                      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                        {['A', 'B', 'C', 'D'].map((letter, i) => (
                          <label key={letter} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: Number(qForm.correct_answer) === i ? 700 : 400, color: Number(qForm.correct_answer) === i ? 'var(--ok)' : 'var(--ink-2)' }}>
                            <input type="radio" name="correct_answer" value={i} checked={Number(qForm.correct_answer) === i} onChange={() => setQForm(f => ({ ...f, correct_answer: i }))} style={{ width: '16px', height: '16px' }} />
                            Choice {letter}
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {qForm.question_type === 'essay' && (
                  <div style={{ padding: '12px 16px', background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', borderRadius: 'var(--r-sm)', marginBottom: '16px', fontSize: '13px', color: 'var(--warn)' }}>
                    Students will type a free-form written answer. This question will not be auto-graded. Review answers in the Results tab.
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn sm" onClick={saveQuestion} disabled={qSaving || qImageUploading} style={{ width: 'auto', opacity: qSaving || qImageUploading ? 0.7 : 1 }}>
                    <Icon name="check" size={14} color="white" />
                    {qImageUploading ? 'Uploading image…' : qSaving ? 'Saving…' : editingQ ? 'Update Question' : 'Add Question'}
                  </button>
                  {editingQ && (
                    <button className="btn ghost sm" onClick={() => { setEditingQ(null); setQForm(emptyQ); setQImageFile(null); setQImagePreview(null); }} style={{ width: 'auto' }}>
                      <Icon name="x" size={14} /> Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* CSV Import Panel */}
              <div className="card" style={{ padding: '20px 24px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '8px' }}>
                  <h4 style={{ margin: 0, color: 'var(--ink-1)', display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="download" size={15} color="var(--navy)" /> Import Questions from CSV</h4>
                  <button className="btn ghost sm" onClick={downloadCSVTemplate} style={{ width: 'auto' }}>
                    <Icon name="download" size={13} /> Download Template
                  </button>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--ink-3)' }}>
                  CSV columns: <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3 }}>question_text, choice_a, choice_b, choice_c, choice_d, correct_answer</code> — leave choice_a blank for essay questions.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <label className={`btn ghost sm ${csvParsed ? 'ok' : ''}`} style={{ width: 'auto', cursor: 'pointer', ...(csvParsed ? { borderColor: 'var(--ok-bd)', color: 'var(--ok)', background: 'var(--ok-bg)' } : {}) }}>
                    <Icon name={csvParsed ? 'check' : 'file-text'} size={14} />
                    {csvParsed ? `${csvParsed.questions.length} questions ready` : 'Choose CSV file'}
                    <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleCsvFileSelect(e, setCsvParsed)} />
                  </label>

                  {csvParsed && (
                    <>
                      <span style={{ fontSize: '12px', color: 'var(--ink-3)' }}>
                        {csvParsed.questions.filter(q => q.question_type !== 'essay').length} MC · {csvParsed.questions.filter(q => q.question_type === 'essay').length} Essay
                      </span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: 600, color: csvReplaceMode ? 'var(--bad)' : 'var(--ink-2)' }}>
                        <input type="checkbox" checked={csvReplaceMode} onChange={e => setCsvReplaceMode(e.target.checked)} style={{ width: '15px', height: '15px' }} />
                        Replace existing questions
                      </label>
                      <button className="btn sm" onClick={() => importQuestionsFromCSV(qExamId, csvParsed.questions, csvReplaceMode)} disabled={csvImporting || csvParsed.questions.length === 0} style={{ width: 'auto', opacity: csvImporting ? 0.7 : 1 }}>
                        {csvImporting ? 'Importing…' : `Import ${csvParsed.questions.length} Questions`}
                      </button>
                      <button onClick={() => setCsvParsed(null)} style={{ background: 'none', border: 'none', color: 'var(--bad)', fontWeight: 700, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
                    </>
                  )}
                </div>

                {csvParsed?.errors?.length > 0 && (
                  <div style={{ marginTop: '12px', background: 'var(--bad-bg)', border: '1px solid var(--bad-bd)', borderRadius: 'var(--r-sm)', padding: '10px 14px' }}>
                    <p style={{ margin: '0 0 6px', fontWeight: 700, color: 'var(--bad)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="alert" size={14} color="var(--bad)" /> Fix these errors in your CSV before importing:</p>
                    <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--bad)', fontSize: '12px' }}>
                      {csvParsed.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              {/* Question List */}
              {qLoading ? (
                <p style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Loading questions...</p>
              ) : qList.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '20px' }}>No questions yet. Add one above or import from CSV.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--ink-2)', fontSize: '13px' }}>{qList.length} question{qList.length !== 1 ? 's' : ''} total</span>
                  </div>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {qList.map((q, idx) => (
                      <div key={q.id} className="card" style={{ padding: '16px 20px', ...(editingQ?.id === q.id ? { borderColor: 'var(--navy)', background: 'var(--navy-50)' } : {}) }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                          <div style={{ flex: 1 }}>
                            <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: 'var(--ink-1)', fontSize: '14px' }}>
                              <span style={{ color: 'var(--navy)', marginRight: '8px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{idx + 1}.</span>
                              {q.question_text}
                              {q.question_type === 'essay' && <span className="px-pill info" style={{ marginLeft: 10 }}>Essay</span>}
                            </p>
                            {q.image_url && (
                              <img
                                src={q.image_url}
                                alt="Figure"
                                style={{ maxHeight: 72, maxWidth: 160, objectFit: 'contain', display: 'block', borderRadius: 'var(--r-xs)', border: '1px solid var(--line)', background: 'var(--surface-2)', marginBottom: 6 }}
                              />
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            <button className="btn ghost sm" onClick={() => startEditQuestion(q)} style={{ width: 'auto' }}>
                              <Icon name="pencil" size={13} /> Edit
                            </button>
                            <button className="btn ghost sm danger" onClick={() => deleteQuestion(q.id)} style={{ width: 'auto', color: 'var(--bad)', borderColor: 'var(--bad-bd)' }}>
                              <Icon name="trash" size={13} color="var(--bad)" /> Delete
                            </button>
                          </div>
                        </div>
                        {q.question_type === 'essay' ? (
                          <div style={{ padding: '8px 12px', background: 'var(--info-bg)', border: '1px solid var(--info-bd)', borderRadius: 'var(--r-sm)', fontSize: '13px', color: 'var(--info)', fontStyle: 'italic' }}>
                            Open-ended — students type a written answer. Graded manually.
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                            {['a', 'b', 'c', 'd'].map((letter, i) => (
                              <div key={letter} style={{ padding: '6px 10px', borderRadius: 'var(--r-xs)', background: Number(q.correct_answer) === i ? 'var(--ok-bg)' : 'var(--surface-2)', border: `1px solid ${Number(q.correct_answer) === i ? 'var(--ok-bd)' : 'var(--line)'}`, fontSize: '13px', color: Number(q.correct_answer) === i ? 'var(--ok)' : 'var(--ink-2)', fontWeight: Number(q.correct_answer) === i ? 600 : 400 }}>
                                <strong>{letter.toUpperCase()}.</strong> {q[`choice_${letter}`]}{Number(q.correct_answer) === i && ' ✓'}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* --- TAB 7: TRANSFER EXAMS --- */}
      {activeView === 'transfer' && (
        <div>
          <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display)' }}>Transfer Exams</h1>
          <p style={{ margin: '0 0 24px', fontSize: '13px', color: 'var(--ink-3)' }}>
            Reassign your exams to another instructor. Students automatically follow — no student data changes.
          </p>

          {/* Step 1 — Destination */}
          <div style={{ marginBottom: '28px' }}>
            <p style={{ margin: '0 0 10px', fontWeight: 700, fontSize: '13px', color: 'var(--ink-1)' }}>
              Step 1 — Choose destination instructor
            </p>
            {instructorsList.length === 0 ? (
              <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', borderRadius: 'var(--r-sm)', padding: '14px 18px', fontSize: '13px', color: 'var(--warn)' }}>
                No other instructors found. Ask them to <strong>log in once</strong> using Instructor Login — they'll register automatically.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                {instructorsList.map(inst => (
                  <button
                    key={inst.id}
                    onClick={() => setTransferTarget(inst.id)}
                    style={{
                      padding: '10px 20px', borderRadius: 'var(--r-sm)', fontWeight: 600, fontSize: '14px', cursor: 'pointer', border: `2px solid ${transferTarget === inst.id ? 'var(--navy)' : 'var(--line)'}`,
                      background: transferTarget === inst.id ? 'var(--navy)' : 'var(--surface)',
                      color: transferTarget === inst.id ? 'white' : 'var(--ink-1)',
                      transition: 'all var(--t-1)',
                    }}
                  >
                    {inst.full_name}
                    <span style={{ display: 'block', fontSize: '11px', fontWeight: 400, opacity: 0.75 }}>{inst.email}</span>
                  </button>
                ))}
                <button className="btn ghost sm" onClick={fetchInstructors} style={{ width: 'auto' }}>
                  <Icon name="refresh" size={13} /> Refresh
                </button>
              </div>
            )}
          </div>

          {/* Step 2 — Select Exams */}
          <div style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: '13px', color: 'var(--ink-1)' }}>
                Step 2 — Select exams to transfer
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn ghost sm" onClick={() => setTransferExamIds(new Set(examsList.map(e => e.id)))} style={{ width: 'auto' }}>Select All</button>
                <button className="btn ghost sm" onClick={() => setTransferExamIds(new Set())} style={{ width: 'auto' }}>Clear</button>
              </div>
            </div>

            {examsList.length === 0 ? (
              <p style={{ color: 'var(--ink-3)', fontSize: '14px' }}>You have no exams to transfer.</p>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {examsList.map(exam => {
                  const checked = transferExamIds.has(exam.id);
                  const resultCount = results.filter(r => r.exam_id === exam.id).length;
                  return (
                    <label key={exam.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 18px', cursor: 'pointer', ...(checked ? { borderColor: 'var(--navy)', background: 'var(--navy-50)' } : {}) }}>
                      <input type="checkbox" checked={checked} onChange={() => setTransferExamIds(prev => { const next = new Set(prev); if (next.has(exam.id)) next.delete(exam.id); else next.add(exam.id); return next; })} style={{ width: '18px', height: '18px', flexShrink: 0, cursor: 'pointer' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--ink-1)' }}>{exam.title}</div>
                        <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '2px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                          <span>Section: <strong>{exam.target_section || '—'}</strong></span>
                          <span>{resultCount} result{resultCount !== 1 ? 's' : ''}</span>
                          <span className={`px-pill ${exam.is_open ? 'ok' : 'muted'}`} style={{ fontSize: '11px' }}>{exam.is_open ? 'Open' : 'Closed'}</span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Step 3 — Confirm */}
          {transferTarget && transferExamIds.size > 0 && (() => {
            const dest = instructorsList.find(i => i.id === transferTarget);
            return (
              <div className="card" style={{ padding: '20px 24px', borderColor: 'var(--navy)' }}>
                <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: '13px', color: 'var(--ink-1)' }}>
                  Step 3 — Confirm transfer
                </p>
                <p style={{ margin: '0 0 18px', fontSize: '14px', color: 'var(--ink-2)' }}>
                  You are transferring <strong>{transferExamIds.size} exam{transferExamIds.size !== 1 ? 's' : ''}</strong> to{' '}
                  <strong>{dest?.full_name || dest?.email}</strong>.
                  All questions and student results stay intact. Students in the transferred sections will move to their dashboard.
                </p>
                <button className="btn" onClick={transferExams} disabled={isTransferring} style={{ width: 'auto', opacity: isTransferring ? 0.7 : 1 }}>
                  <Icon name="arrow-up-right" size={15} color="white" />
                  {isTransferring ? 'Transferring…' : `Transfer ${transferExamIds.size} Exam${transferExamIds.size !== 1 ? 's' : ''} to ${dest?.full_name?.split(' ')[0] || 'Instructor'}`}
                </button>
              </div>
            );
          })()}
        </div>
      )}

        </div>{/* end panel content */}

      </main>

{/* ========================================= */}
      {/* MODAL: DUPLICATE EXAM                     */}
      {/* ========================================= */}
      {dupModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-2xl)', width: '100%', maxWidth: '500px', overflow: 'hidden', boxShadow: 'var(--sh-modal)' }}>

            {/* Header */}
            <div className="patts-header" style={{ padding: '24px 28px' }}>
              <h2 style={{ margin: 0, color: 'white', fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="copy" size={18} color="white" /> Duplicate Exam
              </h2>
              <p style={{ margin: '5px 0 0', color: 'rgba(255,255,255,.65)', fontSize: '13px' }}>
                Source: <strong style={{ color: 'var(--gold-bright)' }}>{dupModal.title}</strong>
              </p>
            </div>

            {/* Body */}
            <div style={{ padding: '28px', display: 'grid', gap: '18px' }}>

              {/* New title */}
              <div>
                <label className="label">New Exam Title</label>
                <input autoFocus className="input" type="text" value={dupTitle} onChange={e => setDupTitle(e.target.value)} />
              </div>

              {/* Target section */}
              <div>
                <label className="label">Target Section</label>
                <input className="input" type="text" value={dupSection} onChange={e => setDupSection(e.target.value)} placeholder="e.g. Aero 202" />
              </div>

              {/* Assign to */}
              <div>
                <label className="label" style={{ marginBottom: '10px' }}>Assign to</label>
                <div style={{ display: 'grid', gap: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: 'var(--r-sm)', cursor: 'pointer', background: dupAssignTo === 'self' ? 'var(--navy-50)' : 'var(--surface-2)', border: `2px solid ${dupAssignTo === 'self' ? 'var(--navy)' : 'var(--line)'}` }}>
                    <input type="radio" name="dupAssign" value="self" checked={dupAssignTo === 'self'} onChange={() => setDupAssignTo('self')} style={{ width: '16px', height: '16px' }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--ink-1)' }}>Keep for myself</div>
                      <div style={{ fontSize: '12px', color: 'var(--ink-3)' }}>Duplicate stays on your account</div>
                    </div>
                  </label>

                  {instructorsList.length === 0 ? (
                    <div style={{ padding: '12px 16px', background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', borderRadius: 'var(--r-sm)', fontSize: '13px', color: 'var(--warn)' }}>
                      No other instructors found. Ask them to log in once to register their account.
                    </div>
                  ) : (
                    instructorsList.map(inst => (
                      <label key={inst.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: 'var(--r-sm)', cursor: 'pointer', background: dupAssignTo === inst.id ? 'var(--navy-50)' : 'var(--surface-2)', border: `2px solid ${dupAssignTo === inst.id ? 'var(--navy)' : 'var(--line)'}` }}>
                        <input type="radio" name="dupAssign" value={inst.id} checked={dupAssignTo === inst.id} onChange={() => setDupAssignTo(inst.id)} style={{ width: '16px', height: '16px' }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--ink-1)' }}>{inst.full_name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--ink-3)' }}>{inst.email}</div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Footer buttons */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button className="btn ghost" onClick={() => setDupModal(null)} disabled={isDuplicating} style={{ flex: 1 }}>Cancel</button>
                <button className="btn" onClick={duplicateExam} disabled={isDuplicating || !dupTitle.trim()} style={{ flex: 2, opacity: isDuplicating || !dupTitle.trim() ? 0.5 : 1 }}>
                  <Icon name="copy" size={15} color="white" />
                  {isDuplicating ? 'Duplicating…' : 'Create Duplicate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

{/* ========================================= */}
      {/* MODAL: SHARE EXAM                          */}
      {/* ========================================= */}
      {shareModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-2xl)', width: '100%', maxWidth: '520px', overflow: 'hidden', boxShadow: 'var(--sh-modal)' }}>

            <div className="patts-header" style={{ padding: '24px 28px' }}>
              <h2 style={{ margin: 0, color: 'white', fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="users" size={18} color="white" /> Share Exam
              </h2>
              <p style={{ margin: '5px 0 0', color: 'rgba(255,255,255,.65)', fontSize: '13px' }}>
                <strong style={{ color: 'var(--gold-bright)' }}>{shareModal.title}</strong>
              </p>
            </div>

            <div style={{ padding: '28px', display: 'grid', gap: '20px' }}>

              {/* Current access list */}
              <div>
                <label className="label" style={{ marginBottom: 10 }}>Current Access</label>
                {(sharesMap[shareModal.id] || []).length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-4)', fontStyle: 'italic' }}>No other instructors have access yet.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {(sharesMap[shareModal.id] || []).map(s => {
                      const inst = instructorsList.find(i => i.id === s.shared_with);
                      return (
                        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }}>
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--navy)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                            {(inst?.full_name || '?')[0].toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{inst?.full_name || 'Unknown Instructor'}</div>
                            <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>{inst?.email || ''}</div>
                          </div>
                          <button
                            onClick={() => revokeShare(s.id, shareModal.id)}
                            className="btn ghost sm"
                            style={{ color: 'var(--bad)', borderColor: 'var(--bad-bd)', width: 'auto' }}
                          >
                            <Icon name="x" size={13} /> Revoke
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Add access */}
              <div>
                <label className="label" style={{ marginBottom: 10 }}>Add Access</label>
                {instructorsList.filter(i => !(sharesMap[shareModal.id] || []).some(s => s.shared_with === i.id)).length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-4)', fontStyle: 'italic' }}>
                    {instructorsList.length === 0 ? 'No other instructors are registered yet.' : 'All instructors already have access.'}
                  </p>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      value={shareTarget}
                      onChange={e => setShareTarget(e.target.value)}
                      className="input"
                      style={{ flex: 1 }}
                    >
                      <option value="">Select an instructor…</option>
                      {instructorsList
                        .filter(i => !(sharesMap[shareModal.id] || []).some(s => s.shared_with === i.id))
                        .map(i => (
                          <option key={i.id} value={i.id}>{i.full_name} — {i.email}</option>
                        ))}
                    </select>
                    <button
                      className="btn"
                      onClick={shareExam}
                      disabled={!shareTarget || isSharing}
                      style={{ width: 'auto', opacity: !shareTarget || isSharing ? 0.5 : 1, flexShrink: 0 }}
                    >
                      <Icon name="user-plus" size={14} color="white" />
                      {isSharing ? 'Sharing…' : 'Share'}
                    </button>
                  </div>
                )}
                <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--ink-4)' }}>
                  Shared instructors can view results, monitor live sessions, and manage questions for this exam.
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--line)', paddingTop: 16 }}>
                <button className="btn ghost" onClick={() => setShareModal(null)} style={{ width: 'auto' }}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}

{/* Loading overlay for question fetches */}
      {isLoadingQuestions && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.72)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
          <div style={{ background: 'var(--surface)', padding: '28px 48px', borderRadius: 'var(--r-xl)', textAlign: 'center', boxShadow: 'var(--sh-modal)', color: 'var(--ink-1)', fontSize: '16px', fontWeight: 600 }}>
            Loading questions…
          </div>
        </div>
      )}

{/* ========================================= */}
      {/* MODAL 1: INDIVIDUAL STUDENT ANSWER SHEET  */}
      {/* ========================================= */}
      {viewingStudent && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-2xl)', width: '90%', maxWidth: '800px', maxHeight: '88vh', overflowY: 'auto', position: 'relative', boxShadow: 'var(--sh-modal)' }}>
            {/* Modal header */}
            <div className="patts-header" style={{ padding: '24px 28px', position: 'sticky', top: 0, zIndex: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ margin: 0, color: 'white', fontSize: '18px' }}>{students[viewingStudent.student_id]?.name}'s Exam Paper</h2>
                  <div style={{ marginTop: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="px-pill" style={{ background: 'rgba(255,255,255,.15)', color: 'white', borderColor: 'transparent', fontSize: '13px' }}>
                      Score: <strong>{viewingStudent.score} / {viewingStudent.total_items}</strong>
                    </span>
                  </div>
                </div>
                <button className="btn ghost sm" onClick={() => setViewingStudent(null)} style={{ color: 'white', borderColor: 'rgba(255,255,255,.3)', background: 'rgba(255,255,255,.1)', width: 'auto' }}>
                  <Icon name="x" size={14} color="white" /> Close
                </button>
              </div>
            </div>

            <div style={{ padding: '24px 28px' }}>
              {viewingStudent.violation_logs && viewingStudent.violation_logs.length > 0 && (
                <div style={{ background: 'var(--bad-bg)', padding: '16px 20px', borderRadius: 'var(--r-md)', marginBottom: '20px', border: '1px solid var(--bad-bd)' }}>
                  <h3 style={{ color: 'var(--bad)', margin: '0 0 10px 0', fontSize: '14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="alert" size={15} color="var(--bad)" /> Security Incident Log
                  </h3>
                  <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--bad)', fontSize: '13px', lineHeight: '1.7' }}>
                    {viewingStudent.violation_logs.map((log, i) => {
                      const split = log.indexOf('] ');
                      const ts = split >= 0 ? log.substring(0, split + 1) : '';
                      const reason = split >= 0 ? log.substring(split + 2) : log;
                      return <li key={i}><strong style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{ts}</strong> {reason}</li>;
                    })}
                  </ul>
                </div>
              )}

              <div style={{ display: 'grid', gap: '12px' }}>
                {(examQuestionsCache[viewingStudent.exam_id] || []).map((q, idx) => {
                  const sAnswer = (viewingStudent.answers_json || {})[q.id];

                  if (q.question_type === 'essay') {
                    const essayText = sAnswer?.text;
                    return (
                      <div key={q.id} className="card" style={{ padding: '20px', borderLeft: '4px solid var(--info)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '12px' }}>
                          <p style={{ margin: 0, fontWeight: 600, flex: 1, color: 'var(--ink-1)' }}>{idx + 1}. {q.question_text}</p>
                          <span className="px-pill info" style={{ flexShrink: 0 }}>Essay</span>
                        </div>
                        {q.image_url && (
                          <img src={q.image_url} alt="Figure" style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain', display: 'block', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', background: 'var(--surface-2)', marginBottom: 12 }} />
                        )}
                        <div style={{ background: 'var(--info-bg)', border: '1px solid var(--info-bd)', borderRadius: 'var(--r-sm)', padding: '14px 16px', fontSize: '14px', color: essayText ? 'var(--ink-1)' : 'var(--ink-4)', fontStyle: essayText ? 'normal' : 'italic', lineHeight: '1.6', minHeight: '60px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {essayText || 'No answer provided.'}
                        </div>
                      </div>
                    );
                  }

                  const studentChoice = sAnswer !== undefined ? Number(sAnswer.chosen) : -1;
                  const correctChoice = Number(q.correct_answer);

                  return (
                    <div key={q.id} className="card" style={{ padding: '20px', borderLeft: studentChoice === correctChoice ? '4px solid var(--ok)' : '4px solid var(--bad)' }}>
                      <p style={{ margin: '0 0 10px 0', fontWeight: 600, color: 'var(--ink-1)' }}>{idx + 1}. {q.question_text}</p>
                      {q.image_url && (
                        <img src={q.image_url} alt="Figure" style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain', display: 'block', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', background: 'var(--surface-2)', marginBottom: 12 }} />
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        {['a', 'b', 'c', 'd'].map((letter, i) => {
                          const isCorrect = i === correctChoice;
                          const isStudentWrong = i === studentChoice && studentChoice !== correctChoice;
                          return (
                            <div key={letter} style={{ padding: '10px 12px', background: isCorrect ? 'var(--ok-bg)' : isStudentWrong ? 'var(--bad-bg)' : 'var(--surface-2)', border: `1.5px solid ${isCorrect ? 'var(--ok-bd)' : isStudentWrong ? 'var(--bad-bd)' : 'var(--line)'}`, borderRadius: 'var(--r-sm)', color: isCorrect ? 'var(--ok)' : isStudentWrong ? 'var(--bad)' : 'var(--ink-2)', fontSize: '13.5px' }}>
                              <strong>{letter.toUpperCase()}.</strong> {q[`choice_${letter}`]}
                              {isCorrect && <span style={{ marginLeft: 6, fontSize: '11px', fontWeight: 700 }}>✓ Correct</span>}
                              {isStudentWrong && <span style={{ marginLeft: 6, fontSize: '11px', fontWeight: 700 }}>✗ Picked</span>}
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
        </div>
      )}

      {/* ========================================= */}
      {/* MODAL 2: CLASS ITEM ANALYSIS (STATS)      */}
      {/* ========================================= */}
      {viewingStatsExam && (
        <div className="print-modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <div className="print-zone" style={{ background: 'var(--paper)', borderRadius: 'var(--r-2xl)', width: '90%', maxWidth: '900px', maxHeight: '88vh', overflowY: 'auto', boxShadow: 'var(--sh-modal)' }}>

            {/* Header */}
            <div className="patts-header" style={{ padding: '24px 28px', position: 'sticky', top: 0, zIndex: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <h2 style={{ margin: 0, color: 'white', fontSize: '18px' }}>Item Analysis & Statistics</h2>
                  <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,.6)', fontSize: '13px' }}>How many students chose each option.</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn ghost sm" onClick={printAnalysis} style={{ color: 'white', borderColor: 'rgba(255,255,255,.3)', background: 'rgba(255,255,255,.1)', width: 'auto' }}>
                    Save as PDF
                  </button>
                  <button className="btn ghost sm" onClick={() => setViewingStatsExam(null)} style={{ color: 'white', borderColor: 'rgba(255,255,255,.3)', background: 'rgba(255,255,255,.1)', width: 'auto' }}>
                    <Icon name="x" size={14} color="white" /> Close
                  </button>
                </div>
              </div>
            </div>

            <div style={{ padding: '24px 28px', display: 'grid', gap: '16px' }}>
              {(examQuestionsCache[viewingStatsExam] || []).map((q, idx) => {
                if (q.question_type === 'essay') {
                  return (
                    <div key={q.id} className="card" style={{ padding: '20px', borderLeft: '4px solid var(--info)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <p style={{ margin: 0, fontWeight: 600, flex: 1, color: 'var(--ink-1)' }}>{idx + 1}. {q.question_text}</p>
                        <span className="px-pill info" style={{ flexShrink: 0 }}>Essay</span>
                      </div>
                      {q.image_url && (
                        <img src={q.image_url} alt="Figure" style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain', display: 'block', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', background: 'var(--surface-2)', marginTop: 10 }} />
                      )}
                      <p style={{ margin: '8px 0 0', color: 'var(--ink-3)', fontSize: '13px' }}>Open-ended question — view individual answers in the Results tab.</p>
                    </div>
                  );
                }

                const examResults = results.filter(r => r.exam_id === viewingStatsExam);
                const totalAnswers = examResults.length;
                const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
                examResults.forEach(r => {
                  const aj = answersJsonCache[`${r.student_id}_${r.exam_id}`] || {};
                  const sAnswer = aj[q.id];
                  if (sAnswer !== undefined) counts[sAnswer.chosen]++;
                });

                return (
                  <div key={q.id} className="card" style={{ padding: '20px 24px', borderLeft: '4px solid var(--navy)' }}>
                    <p style={{ margin: '0 0 10px 0', fontWeight: 600, color: 'var(--ink-1)', fontSize: '14.5px' }}>{idx + 1}. {q.question_text}</p>
                    {q.image_url && (
                      <img src={q.image_url} alt="Figure" style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain', display: 'block', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', background: 'var(--surface-2)', marginBottom: 14 }} />
                    )}
                    <div style={{ display: 'grid', gap: '8px' }}>
                      {['a', 'b', 'c', 'd'].map((letter, i) => {
                        const count = counts[i];
                        const percentage = totalAnswers > 0 ? Math.round((count / totalAnswers) * 100) : 0;
                        const isCorrect = i === Number(q.correct_answer);
                        return (
                          <div key={letter} style={{ padding: '10px 12px', borderRadius: 'var(--r-sm)', background: isCorrect ? 'var(--ok-bg)' : 'var(--surface-2)', border: `1.5px solid ${isCorrect ? 'var(--ok-bd)' : 'var(--line)'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                              <span style={{ fontWeight: isCorrect ? 700 : 500, color: isCorrect ? 'var(--ok)' : 'var(--ink-2)', fontSize: '13.5px' }}>
                                <strong>{letter.toUpperCase()}.</strong> {q[`choice_${letter}`]}
                                {isCorrect && <span className="px-pill ok" style={{ marginLeft: 8, fontSize: '11px' }}>Correct</span>}
                              </span>
                              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink-2)', whiteSpace: 'nowrap', marginLeft: 12 }}>{count} ({percentage}%)</span>
                            </div>
                            <div style={{ background: 'var(--line)', height: '8px', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
                              <div style={{ width: `${percentage}%`, height: '100%', background: isCorrect ? 'var(--ok)' : 'var(--navy-500)', borderRadius: 'var(--r-pill)', transition: 'width 0.5s var(--ease-out)' }} />
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

      {/* Section Co-Instructor Modal */}
      {sectionCoModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-2xl)', width: '100%', maxWidth: 480, boxShadow: 'var(--sh-modal)', overflow: 'hidden' }}>
            <div className="patts-header" style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0, color: 'white', fontSize: 17 }}>Section Co-Instructors</h2>
                  <p style={{ margin: '3px 0 0', color: 'rgba(255,255,255,.6)', fontSize: 13 }}>
                    <strong style={{ color: 'var(--gold-bright)' }}>{sectionCoModal}</strong> — both instructors see all exams for this section
                  </p>
                </div>
                <button className="btn ghost sm" onClick={() => setSectionCoModal(null)} style={{ color: 'white', borderColor: 'rgba(255,255,255,.3)', background: 'rgba(255,255,255,.1)', width: 'auto' }}>
                  <Icon name="x" size={14} color="white" />
                </button>
              </div>
            </div>

            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Current co-instructors */}
              <div>
                <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 13, color: 'var(--ink-2)' }}>Current co-instructors</p>
                {(sectionCoMap[sectionCoModal] || []).length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 13, fontStyle: 'italic' }}>No co-instructors added yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(sectionCoMap[sectionCoModal] || []).map(row => {
                      const inst = instructorsList.find(i => i.id === row.instructor_id);
                      return (
                        <div key={row.instructor_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                          <div>
                            <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: 'var(--ink-1)' }}>{inst?.full_name || 'Unknown'}</p>
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>{inst?.email || ''}</p>
                          </div>
                          <button className="btn ghost sm" onClick={() => removeSectionCoInstructor(row)} style={{ color: 'var(--bad)', borderColor: 'var(--bad)', width: 'auto', fontSize: 12 }}>
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Add co-instructor */}
              {instructorsList.filter(i => !(sectionCoMap[sectionCoModal] || []).some(r => r.instructor_id === i.id)).length > 0 ? (
                <div>
                  <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 13, color: 'var(--ink-2)' }}>Add a co-instructor</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      className="input"
                      value={sectionCoTarget}
                      onChange={e => setSectionCoTarget(e.target.value)}
                      style={{ flex: 1, padding: '9px 12px', fontSize: 13 }}
                    >
                      <option value="">Select instructor…</option>
                      {instructorsList
                        .filter(i => !(sectionCoMap[sectionCoModal] || []).some(r => r.instructor_id === i.id))
                        .map(i => (
                          <option key={i.id} value={i.id}>{i.full_name} — {i.email}</option>
                        ))}
                    </select>
                    <button
                      className="btn sm"
                      onClick={addSectionCoInstructor}
                      disabled={!sectionCoTarget || isSectionCoSaving}
                      style={{ width: 'auto', whiteSpace: 'nowrap' }}
                    >
                      {isSectionCoSaving ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
                    They will see and be able to administer all exams targeting <strong>{sectionCoModal}</strong>.
                  </p>
                </div>
              ) : (
                <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 13, fontStyle: 'italic' }}>All other instructors already have access to this section.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Manual Score Entry Modal */}
      {manualScoreModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: 20 }}>
          <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-2xl)', width: '100%', maxWidth: 400, boxShadow: 'var(--sh-modal)', overflow: 'hidden' }}>
            <div className="patts-header" style={{ padding: '18px 24px' }}>
              <h2 style={{ margin: 0, color: 'white', fontSize: 16 }}>Enter Score Manually</h2>
              <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,.65)', fontSize: 13 }}>
                {manualScoreModal.student_name} — {manualScoreModal.exam_title}
              </p>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
                Answers weren't saved server-side for this student. Enter their score manually (out of <strong>{manualScoreModal.total_items}</strong>).
              </p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="number"
                  min={0}
                  max={manualScoreModal.total_items}
                  value={manualScoreValue}
                  onChange={e => setManualScoreValue(e.target.value)}
                  className="input"
                  style={{ width: 100, fontSize: 20, fontWeight: 700, textAlign: 'center' }}
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && saveManualScore()}
                />
                <span style={{ fontSize: 18, color: 'var(--ink-3)' }}>/ {manualScoreModal.total_items}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn ghost sm" onClick={() => setManualScoreModal(null)} style={{ width: 'auto' }}>Cancel</button>
                <button className="btn sm" onClick={saveManualScore} style={{ width: 'auto' }}>Save Score</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showPwModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: 20 }}>
          <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-2xl)', width: '100%', maxWidth: 420, boxShadow: 'var(--sh-modal)', overflow: 'hidden' }}>
            <div className="patts-header" style={{ padding: '20px 24px' }}>
              <h2 style={{ margin: 0, color: 'white', fontSize: 17, display: 'flex', alignItems: 'center', gap: 9 }}>
                <Icon name="lock" size={16} color="white" /> Change Password
              </h2>
              <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,.65)', fontSize: 13 }}>
                Update the password for your instructor account.
              </p>
            </div>
            <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="label">Current Password</label>
                <input className="input" type="password" autoComplete="current-password" value={pwCurrent}
                  onChange={e => { setPwCurrent(e.target.value); setPwError(''); }} autoFocus />
              </div>
              <div>
                <label className="label">New Password</label>
                <input className="input" type="password" autoComplete="new-password" value={pwNew}
                  onChange={e => { setPwNew(e.target.value); setPwError(''); }} placeholder="At least 8 characters" />
              </div>
              <div>
                <label className="label">Confirm New Password</label>
                <input className="input" type="password" autoComplete="new-password" value={pwConfirm}
                  onChange={e => { setPwConfirm(e.target.value); setPwError(''); }}
                  onKeyDown={e => e.key === 'Enter' && !isChangingPw && changePassword()} />
              </div>
              {pwError && (
                <div style={{ padding: '9px 12px', background: 'var(--bad-bg, #FDECEA)', border: '1px solid var(--bad, #E74C3C)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--bad, #C0392B)' }}>
                  {pwError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
                <button className="btn ghost sm" onClick={closePwModal} disabled={isChangingPw} style={{ width: 'auto' }}>Cancel</button>
                <button className="btn sm" onClick={changePassword} disabled={isChangingPw} style={{ width: 'auto' }}>
                  {isChangingPw ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Force Submit Confirmation Modal */}
      {forceSubmitConfirmList && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: 20 }}>
          <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-2xl)', width: '100%', maxWidth: 500, boxShadow: 'var(--sh-modal)', overflow: 'hidden' }}>
            <div style={{ background: '#B8860B', padding: '18px 24px' }}>
              <h2 style={{ margin: 0, color: 'white', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="send" size={16} color="white" /> Force Submit {forceSubmitConfirmList.length === 1 ? 'Exam' : `${forceSubmitConfirmList.length} Exams`}
              </h2>
              <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,.75)', fontSize: 13 }}>
                Scores will be calculated from answers already saved on the server.
              </p>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
                The following student{forceSubmitConfirmList.length !== 1 ? 's' : ''} will have their exam submitted immediately using their last saved answers. <strong>This cannot be undone.</strong>
              </p>
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {forceSubmitConfirmList.map(s => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: 'var(--ink-1)' }}>{s.student_name}</p>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>{examsDict[s.exam_id] || s.exam_id}</p>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{s.answers_count || 0} answered</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn ghost sm" onClick={() => setForceSubmitConfirmList(null)} disabled={isForceSubmitting} style={{ width: 'auto' }}>
                  Cancel
                </button>
                <button
                  className="btn sm"
                  onClick={() => doForceSubmit(forceSubmitConfirmList)}
                  disabled={isForceSubmitting}
                  style={{ background: '#F9A825', borderColor: '#F9A825', color: '#1a1000', width: 'auto', fontWeight: 700 }}
                >
                  {isForceSubmitting ? 'Submitting…' : `Submit ${forceSubmitConfirmList.length === 1 ? 'Exam' : 'All'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Violation log tooltip */}
      {liveViolationTooltip && (() => {
        const { session, rect } = liveViolationTooltip;
        // violation_log is written to live_sessions by the 5s pusher in ExamBoard
        // fall back to results.violation_logs for submitted/stuck sessions
        const result = results.find(r => r.student_id === session.student_id && r.exam_id === session.exam_id);
        const logs = (session.violation_log?.length ? session.violation_log : null)
          ?? result?.violation_logs
          ?? [];
        return (
          <div style={{
            position: 'fixed',
            top: rect.bottom + 8,
            left: Math.min(rect.left, window.innerWidth - 340),
            zIndex: 9999,
            width: 320,
            background: 'var(--navy-900)',
            color: 'white',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--sh-4)',
            padding: '14px 16px',
            pointerEvents: 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Icon name="flag" size={14} color="var(--gold-bright)" />
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gold-bright)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                {session.student_name}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'rgba(255,255,255,.5)' }}>
                {session.violation_count} violation{session.violation_count !== 1 ? 's' : ''}
              </span>
            </div>
            {logs.length > 0 ? (
              <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
                {logs.map((log, i) => {
                  const split = log.indexOf('] ');
                  const ts = split >= 0 ? log.substring(0, split + 1) : '';
                  const reason = split >= 0 ? log.substring(split + 2) : log;
                  return (
                    <li key={i} style={{ fontSize: '12.5px', lineHeight: 1.5 }}>
                      {ts && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,.4)', marginRight: 6 }}>{ts}</span>}
                      <span style={{ color: 'rgba(255,255,255,.85)' }}>{reason}</span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,.5)', fontStyle: 'italic' }}>
                Log will appear within 5 seconds of the first violation.
              </p>
            )}
          </div>
        );
      })()}

    </div>
  );
}