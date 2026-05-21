import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export default function SectionSelector({ student, onSelect, onLogout }) {
  const [sections, setSections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const enrolledSections = student.section
    ? student.section.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  useEffect(() => {
    async function fetchSections() {
      try {
        const { data, error } = await supabase.from('exams').select('target_section').eq('is_open', true);
        if (error) throw error;
        if (data) {
          const openSections = new Set();
          data.forEach(e => {
            if (e.target_section)
              e.target_section.split(',').map(s => s.trim()).filter(Boolean).forEach(s => openSections.add(s));
          });
          setSections(enrolledSections.filter(s => openSections.has(s)).sort());
        }
      } catch {
        setFetchError(true);
      } finally {
        setIsLoading(false);
      }
    }
    fetchSections();
  }, [retryCount]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        background: 'linear-gradient(110deg, var(--navy-dark) 0%, var(--navy) 60%, var(--navy-mid) 100%)',
        borderBottom: '3px solid var(--gold)',
        padding: '16px 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        boxShadow: 'var(--s-md)',
      }}>
        <img src="/patts-logo.png" alt="PATTS College of Aeronautics" style={{ height: '44px', width: 'auto', objectFit: 'contain' }} />
        <button
          onClick={onLogout}
          style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.25)', color: 'white', padding: '8px 18px', borderRadius: 'var(--r-sm)', fontWeight: 600, fontSize: '13px', width: 'auto' }}
        >
          Log Out
        </button>
      </header>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 20px' }}>
        <div style={{ width: '100%', maxWidth: '560px' }}>

          {/* Welcome Card */}
          <div style={{
            background: 'var(--white)', borderRadius: 'var(--r-xl)', boxShadow: 'var(--s-lg)',
            overflow: 'hidden', marginBottom: '28px',
            border: '1px solid var(--border)',
          }}>
            <div style={{
              background: 'var(--navy-tint)', borderBottom: '1px solid var(--border)',
              padding: '22px 28px', display: 'flex', alignItems: 'center', gap: '14px',
            }}>
              <div style={{
                width: '48px', height: '48px', borderRadius: '50%',
                background: 'var(--navy)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '20px', flexShrink: 0,
                boxShadow: 'var(--s-sm)',
              }}>
                👤
              </div>
              <div>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.05em' }}>Welcome back</p>
                <h2 style={{ margin: '2px 0 0', color: 'var(--navy)', fontSize: '20px', fontWeight: 700 }}>
                  {student.full_name}
                </h2>
              </div>
            </div>
            <div style={{ padding: '18px 28px' }}>
              <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '14px' }}>
                Select your subject-section below to view your available examinations.
              </p>
            </div>
          </div>

          {/* Section Buttons */}
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-3)' }}>
              Loading sections…
            </div>
          ) : fetchError ? (
            <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-bd)', borderRadius: 'var(--r-lg)', padding: '28px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 14px', color: 'var(--danger)', fontWeight: 600 }}>⚠️ Could not connect to the server.</p>
              <button onClick={() => { setFetchError(false); setIsLoading(true); setRetryCount(c => c + 1); }}
                style={{ background: 'var(--danger)', color: 'white', width: 'auto', padding: '9px 20px' }}>
                Retry
              </button>
            </div>
          ) : sections.length > 0 ? (
            <div style={{ display: 'grid', gap: '12px' }}>
              {sections.map((sec, idx) => (
                <button
                  key={idx}
                  onClick={() => onSelect(sec)}
                  style={{
                    background: 'var(--white)',
                    color: 'var(--navy)',
                    border: '2px solid var(--border)',
                    padding: '18px 24px',
                    borderRadius: 'var(--r-lg)',
                    fontSize: '16px',
                    fontWeight: 600,
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxShadow: 'var(--s-xs)',
                    transition: 'all var(--t-fast)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--navy)';
                    e.currentTarget.style.background = 'var(--navy-tint)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = 'var(--s-md)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.background = 'var(--white)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'var(--s-xs)';
                  }}
                >
                  <span>📚 {sec}</span>
                  <span style={{ color: 'var(--gold)', fontSize: '18px' }}>→</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{
              background: 'var(--white)', borderRadius: 'var(--r-lg)', padding: '40px 28px',
              textAlign: 'center', boxShadow: 'var(--s-sm)', border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
              <p style={{ margin: 0, color: 'var(--text-2)', fontWeight: 600, fontSize: '16px' }}>No Open Exams</p>
              <p style={{ margin: '8px 0 0', color: 'var(--text-3)', fontSize: '14px' }}>
                {enrolledSections.length === 0
                  ? 'Your account has no section assigned. Please contact your instructor.'
                  : 'No exams are currently open for your section(s). Please wait for your instructor.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
