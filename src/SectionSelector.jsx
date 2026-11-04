import { useState, useEffect } from 'react';
import { selectAssessments, isAvailableNow, availabilityState } from './lib/assessments';
import { formatName, givenName } from './lib/personName.js';
import Icon from './components/Icon';

// A colour and a glyph per subject family, so a long list can be scanned by eye
// rather than read. Anything else falls back to the blue book.
function sectionLook(name) {
  if (/^aeng/i.test(name)) return { tone: 'navy', icon: 'airfoil' };
  if (/^math/i.test(name)) return { tone: 'gold', icon: 'mathematics' };
  if (/^esci/i.test(name)) return { tone: 'steel', icon: 'structures' };
  if (/pre-?board/i.test(name)) return { tone: 'deep', icon: 'trophy' };
  return { tone: 'blue', icon: 'book' };
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning,' : h < 18 ? 'Good afternoon,' : 'Good evening,';
}

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
        // Through the assessments reader, not the legacy exams table: mock
        // exams exist only in assessments, so querying exams meant a section
        // whose only material is mock exams — Pre-Boards PATTS — never showed
        // up here, and the student could not get past this screen.
        const data = await selectAssessments(q => q.eq('is_open', true));
        if (data) {
          const openSections = new Set();
          data.forEach(e => {
            // A paper scheduled for later still counts: the section should be
            // reachable so the student can see what is coming.
            if (!isAvailableNow(e) && availabilityState(e) !== 'scheduled') return;
            if (e.target_section)
              e.target_section.split(',').map(s => s.trim()).filter(Boolean).forEach(s => openSections.add(s));
          });
          const enrolled = student.section
            ? student.section.split(',').map(s => s.trim()).filter(Boolean)
            : [];
          setSections(enrolled.filter(s => openSections.has(s)).sort());
        }
      } catch {
        setFetchError(true);
      } finally {
        setIsLoading(false);
      }
    }
    fetchSections();
  }, [retryCount, student.section]);

  // One section to choose from is no choice: go straight in.
  const onlySection = !isLoading && !fetchError && sections.length === 1 ? sections[0] : null;
  useEffect(() => {
    if (onlySection) onSelect(onlySection);
  }, [onlySection, onSelect]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header className="header" style={{ borderRadius: 0, marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
          <img src="/patts-logo.png" alt="PATTS College of Aeronautics" style={{ height: 34, width: 'auto', objectFit: 'contain' }} />
          <p className="shell-welcome" style={{ margin: 0, color: 'white', fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {formatName(student.full_name)}
          </p>
        </div>
        <button
          onClick={onLogout}
          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.28)', color: 'white', padding: '6px 14px', width: 'auto', fontSize: 13, fontWeight: 600, borderRadius: 'var(--r-sm)', flexShrink: 0 }}
        >
          Log Out
        </button>
      </header>

      <div className="student-main home-wrap">
        {isLoading || onlySection ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-3)' }}>
            Loading sections…
          </div>
        ) : fetchError ? (
          <div className="card" style={{ padding: '20px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 12px', color: 'var(--danger)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Icon name="alert" size={17} /> Could not connect to the server.</p>
            <button className="btn sm" onClick={() => { setFetchError(false); setIsLoading(true); setRetryCount(c => c + 1); }} style={{ width: 'auto' }}>
              Retry
            </button>
          </div>
        ) : sections.length > 0 ? (
          <>
            <div className="greet">
              <p>{greeting()}</p>
              <h1>{givenName(student.full_name) || 'there'}</h1>
            </div>
            {/* Tiles, so a student in many sections sees them all at once. */}
            <div className="section-grid">
              {sections.map(sec => {
                const look = sectionLook(sec);
                return (
                  <button key={sec} className={`section-tile tile-${look.tone}`} onClick={() => onSelect(sec)}>
                    <span className="tile-chip"><Icon name={look.icon} size={20} /></span>
                    <span className="tile-go"><Icon name="arrow-right" size={15} /></span>
                    <span className="tile-name">{sec}</span>
                    <Icon className="tile-ghost" name={look.icon} size={96} strokeWidth={1.1} />
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="card" style={{ padding: '24px 20px', textAlign: 'center' }}>
            <p style={{ margin: 0, color: 'var(--text-2)', fontWeight: 600, fontSize: 15 }}>No open exams</p>
            <p style={{ margin: '6px 0 0', color: 'var(--text-3)', fontSize: 13.5 }}>
              {enrolledSections.length === 0
                ? 'Your account has no section yet. Ask your instructor to add you.'
                : 'Wait for your instructor to open one.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
