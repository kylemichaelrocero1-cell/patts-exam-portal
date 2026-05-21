import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export default function SectionSelector({ student, onSelect, onLogout }) {
  const [sections, setSections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Student's enrolled sections derived from their profile
  const enrolledSections = student.section
    ? student.section.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  useEffect(() => {
    async function fetchSections() {
      const { data } = await supabase.from('exams').select('target_section').eq('is_open', true);
      if (data) {
        const openSections = new Set();
        data.forEach(e => {
          if (e.target_section) {
            e.target_section.split(',').map(s => s.trim()).filter(Boolean).forEach(s => openSections.add(s));
          }
        });
        // Only show sections the student is actually enrolled in AND that have open exams
        const available = enrolledSections.filter(s => openSections.has(s));
        setSections(available.sort());
      }
      setIsLoading(false);
    }
    fetchSections();
  }, []);

  return (
    <div style={{ maxWidth: '600px', margin: '50px auto', textAlign: 'center', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h2 style={{ color: '#0A2342', margin: 0 }}>Welcome, {student.full_name}</h2>
        {onLogout && (
          <button
            onClick={onLogout}
            style={{ background: '#E74C3C', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}
          >
            Log Out
          </button>
        )}
      </div>
      <p style={{ marginBottom: '30px', color: '#555' }}>Please select your subject-section to view available exams.</p>

      {isLoading ? <p>Loading sections...</p> : (
        <div style={{ display: 'grid', gap: '15px' }}>
          {sections.length > 0 ? sections.map((sec, idx) => (
            <button
              key={idx}
              onClick={() => onSelect(sec)}
              style={{ padding: '15px', fontSize: '16px', background: '#3498DB', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              {sec}
            </button>
          )) : (
            <p style={{ color: '#555' }}>
              {enrolledSections.length === 0
                ? 'Your account has no section assigned. Please contact your instructor.'
                : 'No exams are currently open for your section(s). Please wait for your instructor.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}