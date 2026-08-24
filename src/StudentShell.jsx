import { useState, lazy, Suspense } from 'react';
import Icon from './components/Icon';
import ExamList from './ExamList';

// Lazy for the same reason as the instructor side: this pulls in
// react-markdown + KaTeX (~600kB). A student who only ever sits exams should
// never download it, and on exam day the assessments tab must load fast.
const StudentLessons = lazy(() => import('./StudentLessons'));

const TABS = [
  { id: 'assessments', label: 'Exams & Seatwork', icon: 'clipboard' },
  { id: 'lessons',     label: 'Lessons',          icon: 'book' },
];

export default function StudentShell({ student, selectedSection, onStartExam, onLogout }) {
  const [tab, setTab] = useState('assessments');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header — owned by the shell so the tabs sit directly beneath it.
          ExamList suppresses its own header via `embedded`. */}
      <header className="header" style={{ borderRadius: 0, marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
          <img src="/patts-logo.png" alt="PATTS" style={{ height: 40, width: 'auto', objectFit: 'contain' }} />
          <p style={{ margin: 0, color: 'rgba(255,255,255,.8)', fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Welcome, <strong style={{ color: 'white' }}>{student.full_name}</strong>
            <span style={{ opacity: .7 }}> · {selectedSection}</span>
          </p>
        </div>
        <button
          onClick={onLogout}
          style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.25)', color: 'white', padding: '9px 20px', width: 'auto', fontSize: 13, fontWeight: 600, borderRadius: 'var(--r-sm)', flexShrink: 0 }}
        >
          Log Out
        </button>
      </header>

      {/* Tabs */}
      <div style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        gap: 4,
        padding: '0 24px',
        position: 'sticky',
        top: 0,
        zIndex: 20,
        overflowX: 'auto',
      }}>
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={active ? 'page' : undefined}
              style={{
                appearance: 'none',
                background: 'none',
                border: 0,
                borderBottom: `2.5px solid ${active ? 'var(--gold)' : 'transparent'}`,
                color: active ? 'var(--ink-1)' : 'var(--ink-3)',
                fontWeight: active ? 700 : 600,
                fontSize: 14,
                padding: '14px 16px',
                width: 'auto',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                whiteSpace: 'nowrap',
              }}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'assessments' ? (
        <ExamList
          embedded
          student={student}
          selectedSection={selectedSection}
          onStartExam={onStartExam}
          onLogout={onLogout}
        />
      ) : (
        <div style={{ padding: '32px 24px' }}>
          <Suspense fallback={<div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 40 }}>Loading lessons…</div>}>
            <StudentLessons student={student} selectedSection={selectedSection} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
