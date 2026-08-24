import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import Login from './Login';
import StudentShell from './StudentShell';
import ExamBoard from './ExamBoard';
import SectionSelector from './SectionSelector';
import AdminDashboard from './AdminDashboard';
import './index.css';

export default function App() {
  const [student, setStudent] = useState(null);
  const [selectedExam, setSelectedExam] = useState(null);
  const [examSet, setExamSet] = useState(null);
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
        onStartExam={(exam, set) => { setSelectedExam(exam); setExamSet(set || null); }}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <ExamBoard
      exam={selectedExam}
      examSet={examSet}
      student={student}
      onFinish={() => { setSelectedExam(null); setExamSet(null); }}
    />
  );
}
