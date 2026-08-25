import { useState, useMemo } from 'react';
import Icon from '../components/Icon';

// Every sitting on an unlimited-retake paper. These never reach `results` —
// submit_assessment() routes them to review_attempts so practice cannot move a
// real average — which left the instructor with no way at all to see what a
// student had actually been practising. This is that view: one row per student
// per paper, expandable to the full attempt history.
//
// Like ClassReview, this issues no queries of its own; AdminDashboard already
// holds the attempts.

const PASS = 75;

function pct(score, total) {
  return total > 0 ? (score / total) * 100 : null;
}

function toneFor(p) {
  if (p === null) return 'var(--ink-4)';
  if (p >= PASS) return 'var(--ok)';
  if (p >= 50) return 'var(--warn)';
  return 'var(--bad)';
}

function fmtPct(p) {
  return p === null ? '–' : `${Math.round(p)}%`;
}

function fmtTime(seconds) {
  if (!seconds && seconds !== 0) return '—';
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className="card" style={{ padding: '14px 16px', flex: '1 1 150px', minWidth: 140 }}>
      <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: 3, color: tone || 'var(--ink-1)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function PracticeResults({ attempts, students, examsDict, examsList }) {
  const [paper, setPaper] = useState('All');
  const [section, setSection] = useState('All');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [open, setOpen] = useState(() => new Set());

  const titleFor = useMemo(() => {
    const m = { ...(examsDict || {}) };
    (examsList || []).forEach(e => { m[e.id] = e.title; });
    return m;
  }, [examsDict, examsList]);

  // One group per student per paper, attempts oldest → newest.
  const groups = useMemo(() => {
    const m = new Map();
    (attempts || []).forEach(a => {
      const key = `${a.student_id}|${a.assessment_id}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(a);
    });
    return [...m.entries()].map(([key, list]) => {
      const rows = [...list].sort((x, y) => x.attempt_no - y.attempt_no);
      const first = rows[0];
      const latest = rows[rows.length - 1];
      const best = rows.reduce((b, r) => (pct(r.score, r.total_items) ?? -1) > (pct(b.score, b.total_items) ?? -1) ? r : b, rows[0]);
      const info = (students || {})[first.student_id] || {};
      return {
        key,
        student_id: first.student_id,
        assessment_id: first.assessment_id,
        name: info.name || 'Unknown student',
        section: info.section || '—',
        title: titleFor[first.assessment_id] || 'Untitled paper',
        rows,
        first, latest, best,
        firstPct: pct(first.score, first.total_items),
        latestPct: pct(latest.score, latest.total_items),
        bestPct: pct(best.score, best.total_items),
        lastSat: latest.submitted_at,
      };
    });
  }, [attempts, students, titleFor]);

  const papers = useMemo(() => {
    const ids = [...new Set(groups.map(g => g.assessment_id))];
    return ids.map(id => ({ id, title: titleFor[id] || 'Untitled paper' }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [groups, titleFor]);

  const sections = useMemo(() => {
    const set = new Set();
    groups.forEach(g => (g.section || '').split(',').map(s => s.trim()).filter(Boolean).forEach(s => set.add(s)));
    return ['All', ...[...set].sort()];
  }, [groups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = groups.filter(g =>
      (paper === 'All' || g.assessment_id === paper) &&
      (section === 'All' || (g.section || '').split(',').map(s => s.trim()).includes(section)) &&
      (!q || g.name.toLowerCase().includes(q))
    );
    const c = [...list];
    if (sort === 'recent') c.sort((a, b) => new Date(b.lastSat) - new Date(a.lastSat));
    if (sort === 'name') c.sort((a, b) => a.name.localeCompare(b.name) || a.title.localeCompare(b.title));
    if (sort === 'attempts') c.sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
    if (sort === 'latest_asc') c.sort((a, b) => (a.latestPct ?? 1e9) - (b.latestPct ?? 1e9));
    if (sort === 'latest_desc') c.sort((a, b) => (b.latestPct ?? -1) - (a.latestPct ?? -1));
    return c;
  }, [groups, paper, section, query, sort]);

  const totalAttempts = filtered.reduce((a, g) => a + g.rows.length, 0);
  const studentCount = new Set(filtered.map(g => g.student_id)).size;
  const latestPcts = filtered.map(g => g.latestPct).filter(p => p !== null);
  const avgLatest = latestPcts.length ? latestPcts.reduce((a, b) => a + b, 0) / latestPcts.length : null;
  const improved = filtered.filter(g => g.rows.length > 1 && g.latestPct !== null && g.firstPct !== null && g.latestPct > g.firstPct).length;
  const repeated = filtered.filter(g => g.rows.length > 1).length;

  const toggle = (key) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // One line per attempt — the raw history, not the collapsed view.
  const exportCSV = () => {
    const head = ['Student', 'Section', 'Assessment', 'Attempt', 'Score', 'Total', 'Percent', 'Time taken (s)', 'Submitted'];
    const lines = [head.join(',')];
    filtered.forEach(g => g.rows.forEach(r => {
      const p = pct(r.score, r.total_items);
      lines.push([
        g.name, g.section, g.title, r.attempt_no, r.score, r.total_items,
        p === null ? '' : p.toFixed(1), r.time_taken_seconds ?? '',
        r.submitted_at ? new Date(r.submitted_at).toISOString() : '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `practice_attempts_${paper === 'All' ? 'all_papers' : (titleFor[paper] || 'paper').replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-0.02em', margin: 0 }}>Practice Results</h1>
          <p style={{ color: 'var(--ink-3)', margin: '4px 0 0', fontSize: 13.5 }}>
            Every sitting on a paper with unlimited retakes — who took what, how many times, and whether they are improving.
          </p>
        </div>
        <button className="btn ghost sm" onClick={exportCSV} disabled={filtered.length === 0}>
          <Icon name="download" size={14} /> Export CSV
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--ink-3)' }}>
          No practice attempts yet. A paper only records here once you switch retakes on for it in Manage Exams
          and a student sits it.
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="card" style={{ padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label className="label">Paper</label>
              <select className="input" style={{ width: 'auto', minWidth: 200, display: 'inline-block' }}
                value={paper} onChange={e => setPaper(e.target.value)}>
                <option value="All">All papers</option>
                {papers.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Section</label>
              <select className="input" style={{ width: 'auto', minWidth: 160, display: 'inline-block' }}
                value={section} onChange={e => setSection(e.target.value)}>
                {sections.map(s => <option key={s} value={s}>{s === 'All' ? 'All sections' : s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Student</label>
              <input className="input" style={{ width: 'auto', minWidth: 170, display: 'inline-block' }}
                placeholder="Search by name" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <div>
              <label className="label">Sort by</label>
              <select className="input" style={{ width: 'auto', minWidth: 180, display: 'inline-block' }}
                value={sort} onChange={e => setSort(e.target.value)}>
                <option value="recent">Most recent first</option>
                <option value="name">Name (A–Z)</option>
                <option value="attempts">Most attempts first</option>
                <option value="latest_asc">Latest score (lowest first)</option>
                <option value="latest_desc">Latest score (highest first)</option>
              </select>
            </div>
            <span className="px-pill brand" style={{ marginLeft: 'auto' }}>
              {filtered.length} row{filtered.length !== 1 ? 's' : ''} · {totalAttempts} attempt{totalAttempts !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Headline numbers */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <Stat label="Students practising" value={studentCount} sub={`${filtered.length} student–paper pairs`} />
            <Stat label="Attempts" value={totalAttempts} sub={`${repeated} sat more than once`} />
            <Stat label="Average (latest)" value={avgLatest === null ? '–' : `${avgLatest.toFixed(1)}%`}
              sub="latest attempt only" tone={toneFor(avgLatest)} />
            <Stat label="Improved" value={improved} sub={`of ${repeated} who retook`}
              tone={improved ? 'var(--ok)' : 'var(--ink-4)'} />
          </div>

          {/* One row per student per paper */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}></th>
                    <th>Student</th>
                    <th>Section</th>
                    <th>Assessment</th>
                    <th style={{ textAlign: 'right' }}>Attempts</th>
                    <th style={{ textAlign: 'right' }}>First</th>
                    <th style={{ textAlign: 'right' }}>Latest</th>
                    <th style={{ textAlign: 'right' }}>Best</th>
                    <th style={{ textAlign: 'right' }}>Last sat</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan="9" style={{ padding: 22, textAlign: 'center', color: 'var(--ink-4)' }}>
                      Nothing matches those filters.
                    </td></tr>
                  ) : filtered.map(g => {
                    const isOpen = open.has(g.key);
                    const moved = g.rows.length > 1 && g.latestPct !== null && g.firstPct !== null
                      ? g.latestPct - g.firstPct : null;
                    return [
                      <tr key={g.key} onClick={() => toggle(g.key)} style={{ cursor: 'pointer' }}>
                        <td style={{ color: 'var(--ink-4)' }}>
                          <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                        </td>
                        <td style={{ fontWeight: 600 }}>{g.name}</td>
                        <td style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{g.section}</td>
                        <td>{g.title}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{g.rows.length}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}>{fmtPct(g.firstPct)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: toneFor(g.latestPct) }}>
                          {fmtPct(g.latestPct)}
                          {moved !== null && Math.round(moved) !== 0 && (
                            <span style={{ fontSize: 10.5, marginLeft: 4, color: moved > 0 ? 'var(--ok)' : 'var(--bad)' }}>
                              {moved > 0 ? '▲' : '▼'}{Math.abs(Math.round(moved))}
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: toneFor(g.bestPct) }}>{fmtPct(g.bestPct)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--ink-3)', fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtDate(g.lastSat)}</td>
                      </tr>,
                      isOpen && (
                        <tr key={`${g.key}-open`}>
                          <td colSpan="9" style={{ background: 'var(--surface-2)', padding: '10px 16px 14px' }}>
                            <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 700, marginBottom: 6 }}>
                              Attempt history
                            </div>
                            <table style={{ width: '100%' }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: 'left' }}>Attempt</th>
                                  <th style={{ textAlign: 'right' }}>Score</th>
                                  <th style={{ textAlign: 'right' }}>Percent</th>
                                  <th style={{ textAlign: 'right' }}>Time taken</th>
                                  <th style={{ textAlign: 'right' }}>Submitted</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.rows.map(r => {
                                  const p = pct(r.score, r.total_items);
                                  return (
                                    <tr key={r.attempt_no}>
                                      <td style={{ fontFamily: 'var(--font-mono)' }}>#{r.attempt_no}</td>
                                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r.score}/{r.total_items}</td>
                                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: toneFor(p) }}>{fmtPct(p)}</td>
                                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}>{fmtTime(r.time_taken_seconds)}</td>
                                      <td style={{ textAlign: 'right', color: 'var(--ink-3)', fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtDate(r.submitted_at)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p style={{ fontSize: 12, color: 'var(--ink-4)', margin: '10px 2px 0' }}>
            Practice attempts are kept out of the Results tab on purpose — they are not graded records and must not
            move a real average. Class Review shows the latest attempt for these papers.
          </p>
        </>
      )}
    </div>
  );
}
