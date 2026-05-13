import { useState } from 'react';
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

  // Admin States
  const [isAdminView, setIsAdminView] = useState(false);
  const [showPasswordScreen, setShowPasswordScreen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Handle our custom password form submission
  const handleAdminSubmit = (e) => {
    e.preventDefault(); // Stops the page from refreshing
    if (adminPassword === "pattsaero003") { // Your password here!
      setIsAdminView(true);
      setShowPasswordScreen(false);
      setAdminPassword('');
      setPasswordError('');
    } else {
      setPasswordError("❌ Incorrect Password!");
    }
  };

  // 1. Show the Instructor Dashboard if unlocked
  if (isAdminView) {
    return <AdminDashboard onLogout={() => setIsAdminView(false)} />;
  }

  // 2. Show the Custom Password Screen if they clicked the button
  if (showPasswordScreen) {
    return (
      <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <form onSubmit={handleAdminSubmit} style={{ background: 'white', padding: '40px', borderRadius: '8px', textAlign: 'center', color: '#333', maxWidth: '400px', width: '100%' }}>
          <h2 style={{ color: '#0A2342', marginTop: 0 }}>🔒 Instructor Portal</h2>
          <p>Please enter the admin password to continue.</p>
          
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="Enter Password"
            style={{ padding: '12px', margin: '15px 0', width: '90%', borderRadius: '4px', border: '2px solid #ccc', fontSize: '16px', textAlign: 'center' }}
            autoFocus
          />
          
          {passwordError && <p style={{ color: '#E74C3C', fontWeight: 'bold', margin: '0 0 15px 0' }}>{passwordError}</p>}
          
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '10px' }}>
            <button type="button" onClick={() => {setShowPasswordScreen(false); setPasswordError('');}} style={{ background: '#ccc', color: '#333' }}>
              Cancel
            </button>
            <button type="submit" style={{ background: '#0A2342', color: 'white' }}>
              Unlock
            </button>
          </div>
        </form>
      </div>
    );
  }

// --- THE NEW APP ROUTING LOGIC ---
  if (!student) {
    return <Login onLogin={setStudent} />;
  }
  // --- THE INSTRUCTOR PORTAL ROUTE ---
  if (student && student.role === 'admin') {
    return <AdminDashboard onLogout={() => { setStudent(null); setSelectedSection(null); }} />;
  }

  // If logged in, but hasn't picked a section yet
  if (student && !selectedSection) {
    return <SectionSelector 
      student={student} 
      onSelect={setSelectedSection} 
    />;
  }

// If logged in AND picked a section, but hasn't started an exam
  if (student && selectedSection && !selectedExam) {
    return <ExamList 
      student={student} 
      selectedSection={selectedSection} 
      onStartExam={setSelectedExam} 
      onLogout={() => { setStudent(null); setSelectedSection(null); }} 
    />;
  }

  // If an exam is actively running
  if (selectedExam) {
    return <ExamBoard 
      exam={selectedExam} 
      student={student} 
      onFinish={() => setSelectedExam(null)} 
    />;
  }
}