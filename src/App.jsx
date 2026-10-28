import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import Login from './Login';
import StudentShell from './StudentShell';
import ExamBoard from './ExamBoard';
import SectionSelector from './SectionSelector';
import AdminDashboard from './AdminDashboard';
import { clearAllGates } from './lib/examGateKeys';
import { forgetStudentHome } from './lib/studentHome';
import { fetchAssessmentById, isAvailableNow } from './lib/assessments';

// The paper this tab has open, so a reload — the student's, or the portal's
// own after a deploy (lib/staleBuild.js) — goes straight back into it rather
// than dropping them on the home tabs to find it again. sessionStorage: it
// belongs to this tab and goes when the tab is closed.
const OPEN_PAPER_KEY = 'patts_open_paper';
const rememberPaper = (studentId, exam, set) => {
  try { sessionStorage.setItem(OPEN_PAPER_KEY, JSON.stringify({ studentId, examId: exam.id, set: set || null })); } catch { /* private mode */ }
};
const forgetPaper = () => { try { sessionStorage.removeItem(OPEN_PAPER_KEY); } catch { /* private mode */ } };
import './index.css';

export default function App() {
  const [student, setStudent] = useState(null);
  const [selectedExam, setSelectedExam] = useState(null);
  const [examSet, setExamSet] = useState(null);
  // The entry the instructor let in, for a paper that waits for that (sql/115):
  // { entry, askedAt, letInAt }. Only this page holds the entry id;
  // get_exam_questions() hands the paper to it alone.
  const [examAdmission, setExamAdmission] = useState(null);
  const [selectedSection, setSelectedSection] = useState(null);
  const [isRestoring, setIsRestoring] = useState(true);

  // Restore a session on page load.
  //
  // Instructors sign in through Supabase Auth, which persists its own session in
  // localStorage (persistSession defaults to true). Nothing here used to read it,
  // so a refresh dropped every instructor back on the login screen even though
  // their session was still valid — getSession() is what fixes that.
  //
  // Students are not in Supabase Auth; their session is our own localStorage blob.
  useEffect(() => {
    let cancelled = false;

    // Back into the paper this tab had open — only while its sitting is still
    // open on the server. A submitted practice paper must not quietly start a
    // new attempt because the tab was reloaded on its score screen.
    const reopenPaper = async (studentId) => {
      let open = null;
      try { open = JSON.parse(sessionStorage.getItem(OPEN_PAPER_KEY) || 'null'); } catch { /* private mode */ }
      if (!open?.examId || open.studentId !== studentId) return;
      try {
        const { data: sittings, error } = await supabase.from('live_sessions')
          .select('id').eq('student_id', studentId).eq('exam_id', open.examId)
          .neq('status', 'finished').limit(1);
        if (error || !sittings?.length) { forgetPaper(); return; }
        const exam = await fetchAssessmentById(open.examId);
        // Closed or out of its window since: the home tabs say so.
        if (!exam || !isAvailableNow(exam) || cancelled) return;
        // A paper the instructor lets each entry into: a reload is a new
        // entry, so it goes back through the waiting screen via Resume.
        if (exam.requires_admission) return;
        setSelectedExam(exam);
        setExamSet(open.set);
      } catch {
        // Offline or refused: the home tabs, where Resume is one tap away.
      }
    };

    (async () => {
      try {
        // getSession() can hit the network to refresh an expired token. On a bad
        // connection that would strand everyone — students included — on the
        // loading screen, so cap it and fall through to the normal login form.
        const { data: { session } } = await Promise.race([
          supabase.auth.getSession(),
          new Promise(resolve =>
            setTimeout(() => resolve({ data: { session: null } }), 3000)),
        ]);
        if (cancelled) return;
        if (session?.user) {
          // Shape must match what Login.jsx hands to onLogin for the admin path.
          setStudent({
            id: session.user.id,
            role: 'admin',
            full_name: session.user.user_metadata?.full_name || session.user.email,
          });
          return;
        }
      } catch {
        // No usable auth session — fall through to the student restore below.
      }

      if (cancelled) return;
      try {
        const saved = localStorage.getItem('patts_student_session');
        if (saved) {
          const { student: s, section } = JSON.parse(saved);
          if (s?.id && s?.full_name && !s.role) {
            setStudent(s);
            if (section) setSelectedSection(section);
            await reopenPaper(s.id);
          }
        }
      } catch {
        localStorage.removeItem('patts_student_session');
      }
    })().finally(() => {
      if (!cancelled) setIsRestoring(false);
    });

    return () => { cancelled = true; };
  }, []);

  // Persist student + section so refresh lands back at ExamList
  useEffect(() => {
    if (student && !student.role && selectedSection) {
      localStorage.setItem('patts_student_session', JSON.stringify({ student, section: selectedSection }));
    }
  }, [student, selectedSection]);

  const handleLogout = async () => {
    await supabase.auth.signOut(); // No-op for students (not signed into Supabase Auth)
    localStorage.removeItem('local_session_token');
    localStorage.removeItem('patts_student_session');
    // The password and briefing gates remember themselves in sessionStorage,
    // which belongs to the TAB, not to the login. On a shared lab machine the
    // next student inherits the tab — so a logout has to take the unlocks with
    // it. The keys are student-scoped as well; this is the second lock.
    clearAllGates();
    forgetStudentHome();
    forgetPaper();
    setStudent(null);
    setSelectedSection(null);
    setSelectedExam(null);
    setExamSet(null);
  };

  // getSession() is async — render nothing until it resolves, or a restored
  // instructor sees the login form flash before the dashboard appears.
  if (isRestoring) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--paper, #F7F8FA)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <img
          src="/patts-logo.png"
          alt="PATTS College of Aeronautics"
          style={{ height: 56, width: 'auto', objectFit: 'contain', opacity: 0.5 }}
        />
      </div>
    );
  }

  // Admin via Supabase Auth (student.role set in Login.jsx)
  if (student?.role === 'admin') {
    return <AdminDashboard instructorId={student.id} instructorName={student.full_name} onLogout={handleLogout} />;
  }

  if (!student) {
    return <Login onLogin={setStudent} />;
  }

  if (!selectedSection) {
    return (
      <SectionSelector
        student={student}
        onSelect={setSelectedSection}
        onLogout={handleLogout}
      />
    );
  }

  if (!selectedExam) {
    // StudentShell owns the header and the Lessons / Exams & Seatwork tabs, and
    // renders ExamList inside itself.
    return (
      <StudentShell
        student={student}
        selectedSection={selectedSection}
        onStartExam={(exam, set, admission) => { rememberPaper(student.id, exam, set); setSelectedExam(exam); setExamSet(set || null); setExamAdmission(admission || null); }}
        onLogout={handleLogout}
        onSwitchSection={setSelectedSection}
      />
    );
  }

  return (
    <ExamBoard
      exam={selectedExam}
      examSet={examSet}
      admission={examAdmission}
      student={student}
      onLogout={handleLogout}
      // What was just sat has to show on the home tabs, so their shared copy
      // goes — see src/lib/studentHome.js.
      onFinish={() => { forgetPaper(); forgetStudentHome(); setSelectedExam(null); setExamSet(null); setExamAdmission(null); }}
    />
  );
}
