import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export default function SectionSelector({ student, onSelect }) {
  const [sections, setSections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchSections() {
      const { data } = await supabase.from('exams').select('target_section').eq('is_open', true);
      if (data) {
        const allSections = new Set();
        data.forEach(e => {
          if (e.target_section) {
            e.target_section.split(',').map(s => s.trim()).filter(Boolean).forEach(s => allSections.add(s));
          }
        });
        setSections([...allSections].sort());
      }
      setIsLoading(false);
    }
    fetchSections();
  }, []);

  const handleSelect = (clickedSection) => {
    // Splits the student's DB section in case they are enrolled in multiple (e.g., "Aero 1, Math 2")
    const validSections = student.section ? student.section.split(',').map(s => s.trim()) : [];

    if (validSections.includes(clickedSection) || student.section === clickedSection) {
      onSelect(clickedSection); // Let them in
    } else {
      alert(`❌ Access Denied: You are not enrolled in ${clickedSection}.`);
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '50px auto', textAlign: 'center', padding: '20px' }}>
      <h2 style={{ color: '#0A2342' }}>Welcome, {student.full_name}</h2>
      <p style={{ marginBottom: '30px', color: '#555' }}>Please select your subject-section to view available exams.</p>
      
      {isLoading ? <p>Loading sections...</p> : (
        <div style={{ display: 'grid', gap: '15px' }}>
          {sections.length > 0 ? sections.map((sec, idx) => (
            <button 
              key={idx} 
              onClick={() => handleSelect(sec)}
              style={{ padding: '15px', fontSize: '16px', background: '#3498DB', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              {sec}
            </button>
          )) : (
            <p>No exams are currently available for any sections.</p>
          )}
        </div>
      )}
    </div>
  );
}