import { useState } from 'react';
import { supabase } from './supabase';
import Login from './Login';
import ExamList from './ExamList';
import ExamBoard from './ExamBoard';
import SectionSelector from './SectionSelector';
import AdminDashboard from './AdminDashboard';
import './index.css';

export default function App() {
  const [student, setStudent] = useState(null);
  const [selectedExam, setSelectedExam] = useState(null);
  const [examSet, setExamSet] = useState(null);
  const [selectedSection, setSelectedSection] = useState(null);

  const handleLogout = async () => {
    await supabase.auth.signOut(); // No-op for students (not signed into Supabase Auth)
    localStorage.removeItem('local_session_token');
    setStudent(null);
    setSelectedSection(null);
    setSelectedExam(null);
    setExamSet(null);
  };

  // Admin via Supabase Auth (student.role set in Login.jsx)
  if (student?.role === 'admin') {
    return <AdminDashboard onLogout={handleLogout} />;
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
    return (
      <ExamList
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
