import { useState, useEffect, useMemo } from 'react';
import { selectAssessments } from './lib/assessments';
import { sectionsWithOpenPaper } from './lib/assessmentsCore';
import { studentSections } from './lib/sectionScope';
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
  // Every section they are enrolled in, whether or not a paper is open: lessons,
  // seatwork, scores and past papers to review all live behind this screen.
  const sections = useMemo(() => studentSections(student.section), [student.section]);
  const [openSections, setOpenSections] = useState(() => new Set());

  // Only a hint, so that on exam day a student in several sections can see which
  // one to enter. Nothing waits for it, and if it fails the tiles still work.
  useEffect(() => {
    if (sections.length < 2) return undefined;
    let cancelled = false;
    selectAssessments(q => q.eq('is_open', true))
      .then(papers => { if (!cancelled) setOpenSections(sectionsWithOpenPaper(papers)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sections.length]);

  // One section to choose from is no choice: go straight in.
  const onlySection = sections.length === 1 ? sections[0] : null;
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
        {onlySection ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-3)' }}>
            Loading…
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
                    {openSections.has(sec) && <span className="tile-open">Paper open</span>}
                    <Icon className="tile-ghost" name={look.icon} size={96} strokeWidth={1.1} />
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="card" style={{ padding: '24px 20px', textAlign: 'center' }}>
            <p style={{ margin: 0, color: 'var(--text-2)', fontWeight: 600, fontSize: 15 }}>No section yet</p>
            <p style={{ margin: '6px 0 0', color: 'var(--text-3)', fontSize: 13.5 }}>
              Ask your instructor to add you.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
