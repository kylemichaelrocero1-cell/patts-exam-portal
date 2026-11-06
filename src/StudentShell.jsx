import { useState, lazy, Suspense } from 'react';
import Icon from './components/Icon';
import ExamList from './ExamList';
import { formatName } from './lib/personName.js';
import { studentSections } from './lib/sectionScope';

// Lazy for the same reason as the instructor side: this pulls in
// react-markdown + KaTeX (~600kB). A student who only ever sits exams should
// never download it, and on exam day the assessments tab must load fast.
const StudentLessons = lazy(() => import('./StudentLessons'));
const StudentSummary = lazy(() => import('./StudentSummary'));

const TABS = [
  { id: 'summary',  label: 'Summary',  icon: 'home' },
  { id: 'lessons',  label: 'Lessons',  icon: 'book' },
  { id: 'seatwork', label: 'Seatwork', icon: 'clipboard-check' },
  { id: 'exams',    label: 'Exams',    icon: 'exam' },
];

function Loading({ label }) {
  return (
    <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 40 }}>
      Loading {label}…
    </div>
  );
}

export default function StudentShell({ student, selectedSection, onStartExam, onLogout, onSwitchSection }) {
  const [tab, setTab] = useState('summary');
  // Every section the student is enrolled in. With more than one, a switch
  // sits under the header: picking a section used to be final until the
  // student logged out and back in.
  const sections = studentSections(student.section);
  if (selectedSection && !sections.includes(selectedSection)) sections.unshift(selectedSection);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header — owned by the shell so the tabs sit directly beneath it.
          ExamList suppresses its own header via `embedded`. */}
      <header className="header" style={{ borderRadius: 0, marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
          <img src="/patts-logo.png" alt="PATTS" style={{ height: 34, width: 'auto', objectFit: 'contain' }} />
          <p className="shell-welcome" style={{ margin: 0, color: 'rgba(255,255,255,.8)', fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <strong style={{ color: 'white', fontWeight: 600 }}>{formatName(student.full_name)}</strong>
          </p>
        </div>
        <button
          onClick={onLogout}
          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.28)', color: 'white', padding: '6px 14px', width: 'auto', fontSize: 13, fontWeight: 600, borderRadius: 'var(--r-sm)', flexShrink: 0 }}
        >
          Log Out
        </button>
      </header>

      {/* One bar from a tablet up, tabs left and section right. On a phone the
          bar dissolves (display: contents), so only the tabs stick. */}
      <div className="student-bar">
      {onSwitchSection && sections.length > 1 && (
        <div className="section-switch">
          <label htmlFor="section-switch-select" className="sr-only">Section</label>
          <select
            id="section-switch-select"
            className="input"
            value={selectedSection}
            onChange={e => onSwitchSection(e.target.value)}
          >
            {sections.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {/* Tabs */}
      <div className="student-tabs">
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={active ? 'page' : undefined}
              className={`student-tab${active ? ' is-on' : ''}`}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
            </button>
          );
        })}
      </div>
      </div>

      {/* ExamList is mounted per-kind rather than shared, so switching tabs
          resets its internal state cleanly and each list only ever shows one
          kind. `key` forces the remount. */}
      {(tab === 'seatwork' || tab === 'exams') && (
        <ExamList
          key={`${tab}-${selectedSection}`}
          embedded
          kind={tab === 'seatwork' ? 'seatwork' : 'exam'}
          student={student}
          selectedSection={selectedSection}
          onStartExam={onStartExam}
          onLogout={onLogout}
        />
      )}

      {tab === 'summary' && (
        <div className="student-main">
          <Suspense fallback={<Loading label="summary" />}>
            <StudentSummary
              student={student}
              selectedSection={selectedSection}
              onGoToTab={setTab}
            />
          </Suspense>
        </div>
      )}

      {tab === 'lessons' && (
        <div className="student-main">
          <Suspense fallback={<Loading label="lessons" />}>
            <StudentLessons student={student} selectedSection={selectedSection} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
