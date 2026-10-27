import { useState, useMemo } from 'react';
import Icon from '../components/Icon';
import { combinedScore } from '../lib/workedShape';
import { classRecordSheets, groupOf } from '../lib/classRecord';
import { workbookBytes } from '../lib/xlsx';
import { formatName } from '../lib/personName';

// One section at a time, answering the questions an instructor actually asks:
// who hasn't submitted, who is struggling, and how did the class do on each
// assessment. Everything is derived from data AdminDashboard already holds, so
// this view issues no queries of its own.
//
// Two sources of scores, not one. A paper with retakes on never writes to
// `results` — every sitting lands in `review_attempts` — so a section made up
// of mock exams used to read as "nothing submitted" no matter how many students
// had sat them. A retakeable paper shows its LATEST attempt, which is where the
// student actually stands today; the full history is in the Practice Results tab.

const PASS = 75;

// A score is not always a count of right answers. An item may be worth more
// than one point (sql/025), and a worked item is marked in its own columns
// (sql/024) — so a paper made entirely of worked items has a picked-item
// score of 0 out of 0, and reading THAT is why a whole class showed 0/0 here
// while their marks sat in the row beside it. combinedScore() is the one
// place that knows which numbers to use.
function scoreOf(row) {
  return row ? combinedScore(row) : null;
}


function toneFor(p) {
  if (p === null) return 'var(--ink-4)';
  if (p >= PASS) return 'var(--ok)';
  if (p >= 50) return 'var(--warn)';
  return 'var(--bad)';
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

// Where the student stands now: the most recent sitting.
function latestAttempt(attempts) {
  return attempts.reduce((best, a) => (!best || a.attempt_no > best.attempt_no ? a : best), null);
}

export default function ClassReview({ studentsList, results, practiceAttempts, examsList }) {
  const [section, setSection] = useState('');
  const [sort, setSort] = useState('name');
  // Archived papers (last term's prelims) stay out unless asked for — here
  // and in the class record alike.
  const [showArchived, setShowArchived] = useState(false);
  const [retakes, setRetakes] = useState('best');
  const [scope, setScope] = useState('section');

  // Sections this instructor actually teaches, from their own assessments.
  const sections = useMemo(() => {
    const set = new Set();
    (examsList || []).forEach(e =>
      (e.target_section || '').split(',').map(s => s.trim()).filter(Boolean).forEach(s => set.add(s))
    );
    return [...set].sort();
  }, [examsList]);

  const active = section || sections[0] || '';

  // Roster: match membership of the comma list, never the whole string.
  const roster = useMemo(() => (studentsList || []).filter(s =>
    (s.section || '').split(',').map(x => x.trim()).includes(active)
  ), [studentsList, active]);

  // The assessments aimed at this section.
  const items = useMemo(() => (examsList || []).filter(e =>
    (e.target_section || '').split(',').map(x => x.trim()).includes(active)
    && (showArchived || !e.archived_at)
  ), [examsList, active, showArchived]);
  const archivedHere = (examsList || []).filter(e =>
    e.archived_at && (e.target_section || '').split(',').map(x => x.trim()).includes(active)).length;

  // The class record (src/lib/classRecord.js), written as an .xlsx here in
  // the browser: Excel opens it, and Google Sheets imports it.
  const downloadClassRecord = () => {
    const chosen = scope === 'all' ? sections : [active];
    const sheets = classRecordSheets({
      sections: chosen, students: studentsList || [], papers: examsList || [],
      results: results || [], practiceAttempts: practiceAttempts || [],
      retakes, includeArchived: showArchived,
    });
    const blob = new Blob([workbookBytes({ sheets })],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const label = scope === 'all' ? 'all_sections' : active.replace(/[^A-Za-z0-9-]+/g, '_');
    a.download = `class_record_${label}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // student_id -> exam_id -> { score, total_items, is_practice, attempts }
  const byStudent = useMemo(() => {
    const m = new Map();
    const put = (studentId, examId, row) => {
      if (!m.has(studentId)) m.set(studentId, new Map());
      m.get(studentId).set(examId, row);
    };

    // Practice first, so a graded result always wins if a paper somehow has both.
    const grouped = new Map(); // `${student}|${assessment}` -> attempt rows
    (practiceAttempts || []).forEach(a => {
      const key = `${a.student_id}|${a.assessment_id}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(a);
    });
    grouped.forEach(list => {
      const { student_id, assessment_id } = list[0];
      const shown = latestAttempt(list);
      put(student_id, assessment_id, { ...shown, is_practice: true, attempts: list.length });
    });

    (results || []).forEach(r => put(r.student_id, r.exam_id, { ...r, is_practice: false, attempts: 1 }));
    return m;
  }, [results, practiceAttempts]);

  const rows = useMemo(() => roster.map(s => {
    const mine = byStudent.get(s.student_id ?? s.id) || new Map();
    const taken = items.filter(i => mine.has(i.id));
    const pcts = taken.map(i => scoreOf(mine.get(i.id))?.pct).filter(p => p !== null && p !== undefined);
    const avg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
    return {
      id: s.student_id ?? s.id,
      name: s.full_name || 'Unknown',
      results: mine,
      submitted: taken.length,
      missing: items.length - taken.length,
      avg,
    };
  }), [roster, items, byStudent]);

  const sorted = useMemo(() => {
    const c = [...rows];
    if (sort === 'name') c.sort((a, b) => a.name.localeCompare(b.name));
    // Nulls last on both score sorts — "hasn't submitted" is not a low score.
    if (sort === 'avg_asc') c.sort((a, b) => (a.avg ?? 1e9) - (b.avg ?? 1e9));
    if (sort === 'avg_desc') c.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
    if (sort === 'missing') c.sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name));
    return c;
  }, [rows, sort]);

  const graded = rows.filter(r => r.avg !== null);
  const classAvg = graded.length ? graded.reduce((a, r) => a + r.avg, 0) / graded.length : null;
  const atRisk = graded.filter(r => r.avg < PASS).length;
  const notStarted = rows.filter(r => r.submitted === 0).length;
  const expected = rows.length * items.length;
  const submitted = rows.reduce((a, r) => a + r.submitted, 0);

  if (sections.length === 0) {
    return (
      <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--ink-3)' }}>
        No sections yet — create an exam or seatwork with a target section first.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-0.02em', margin: 0 }}>Class Review</h1>
        <p style={{ color: 'var(--ink-3)', margin: '4px 0 0', fontSize: 13.5 }}>
          One section at a time — who is behind, who is struggling, and how each assessment went.
        </p>
      </div>

      {/* Controls */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label className="label">Section</label>
          <select className="input" style={{ width: 'auto', minWidth: 180, display: 'inline-block' }}
            value={active} onChange={e => setSection(e.target.value)}>
            {sections.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Sort students by</label>
          <select className="input" style={{ width: 'auto', minWidth: 180, display: 'inline-block' }}
            value={sort} onChange={e => setSort(e.target.value)}>
            <option value="name">Name (A–Z)</option>
            <option value="avg_asc">Lowest average first</option>
            <option value="avg_desc">Highest average first</option>
            <option value="missing">Most missing first</option>
          </select>
        </div>
        {(archivedHere > 0 || showArchived) && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-3)', cursor: 'pointer', paddingBottom: 8 }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Include archived papers{!showArchived ? ` (${archivedHere})` : ''}
          </label>
        )}
        <span className="px-pill brand" style={{ marginLeft: 'auto' }}>
          {rows.length} student{rows.length !== 1 ? 's' : ''} · {items.length} assessment{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Class record download */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Class record</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
            An Excel file: a student a row, each paper in points, grouped into quizzes, seatworks,
            assignments and exams, with subtotals and a total you can weight. Opens in Excel; in Google Sheets use File → Import.
          </div>
        </div>
        <div>
          <label className="label">Sections</label>
          <select className="input" style={{ width: 'auto', minWidth: 150, display: 'inline-block' }} value={scope} onChange={e => setScope(e.target.value)}>
            <option value="section">{active} only</option>
            <option value="all">All my sections ({sections.length})</option>
          </select>
        </div>
        <div>
          <label className="label">Papers with retakes</label>
          <select className="input" style={{ width: 'auto', minWidth: 140, display: 'inline-block' }} value={retakes} onChange={e => setRetakes(e.target.value)}>
            <option value="best">Best attempt</option>
            <option value="latest">Latest attempt</option>
          </select>
        </div>
        <button className="btn sm" style={{ width: 'auto' }} onClick={downloadClassRecord}>
          <Icon name="download" size={14} /> Download .xlsx
        </button>
      </div>

      {/* Headline numbers */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <Stat label="Class average" value={classAvg === null ? '–' : `${classAvg.toFixed(1)}%`}
          sub={graded.length ? `${graded.length} with scores` : 'no scores yet'}
          tone={toneFor(classAvg)} />
        <Stat label="Below 75%" value={atRisk} sub="needs attention"
          tone={atRisk ? 'var(--bad)' : 'var(--ok)'} />
        <Stat label="Nothing submitted" value={notStarted} sub="students"
          tone={notStarted ? 'var(--warn)' : 'var(--ok)'} />
        <Stat label="Turned in" value={expected ? `${Math.round((submitted / expected) * 100)}%` : '–'}
          sub={`${submitted} of ${expected}`} />
      </div>

      {/* Per-assessment breakdown */}
      <h2 style={{ fontSize: 11.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 700, margin: '0 0 10px' }}>
        By assessment
      </h2>
      <div className="card" style={{ overflow: 'hidden', marginBottom: 24 }}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Assessment</th><th>Type</th>
                <th style={{ textAlign: 'right' }}>Submitted</th>
                <th style={{ textAlign: 'right' }}>Average</th>
                <th style={{ textAlign: 'right' }}>Pass rate</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan="5" style={{ padding: 22, textAlign: 'center', color: 'var(--ink-4)' }}>
                  Nothing targeted at this section yet.
                </td></tr>
              ) : items.map(it => {
                const rs = rows.map(r => r.results.get(it.id)).filter(Boolean);
                const ps = rs.map(r => scoreOf(r)?.pct).filter(p => p !== null && p !== undefined);
                const a = ps.length ? ps.reduce((x, y) => x + y, 0) / ps.length : null;
                const pr = ps.length ? (ps.filter(p => p >= PASS).length / ps.length) * 100 : null;
                return (
                  <tr key={it.id}>
                    <td style={{ fontWeight: 600 }}>{it.title}</td>
                    <td>
                      {/* The class record's grouping (src/lib/classRecord.js), so a quiz
                          or an assignment is not called an exam. */}
                      <span className="px-pill" style={{
                        background: groupOf(it) === 'Exams' ? 'var(--gold-pale)' : 'var(--navy-tint)',
                        color: groupOf(it) === 'Exams' ? 'var(--gold-700)' : 'var(--navy)',
                        border: '1px solid var(--line)',
                      }}>
                        {{ Quizzes: 'Quiz', Seatworks: 'Seatwork', Assignments: 'Assignment', Exams: 'Exam',
                          'Practice & review': 'Practice', Other: it.kind === 'seatwork' ? 'Seatwork' : 'Paper' }[groupOf(it)]}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{rs.length}/{rows.length}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: toneFor(a) }}>
                      {a === null ? '–' : `${a.toFixed(1)}%`}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: toneFor(pr) }}>
                      {pr === null ? '–' : `${Math.round(pr)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Student × assessment grid */}
      <h2 style={{ fontSize: 11.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 700, margin: '0 0 10px' }}>
        By student
      </h2>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: 'var(--surface-2)', zIndex: 1 }}>Student</th>
                {items.map(it => (
                  <th key={it.id} title={it.title} style={{ textAlign: 'center', minWidth: 78, maxWidth: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11.5 }}>
                    {it.title}
                  </th>
                ))}
                <th style={{ textAlign: 'right' }}>Avg</th>
                <th style={{ textAlign: 'right' }}>Missing</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={items.length + 3} style={{ padding: 22, textAlign: 'center', color: 'var(--ink-4)' }}>
                  No students in this section.
                </td></tr>
              ) : sorted.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600, position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>{formatName(r.name)}</td>
                  {items.map(it => {
                    const res = r.results.get(it.id);
                    const m = scoreOf(res);
                    const p = m ? m.pct : null;
                    return (
                      <td key={it.id} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12.5, color: toneFor(p) }}>
                        {res ? (p === null ? `${m.score}/${m.total}` : `${Math.round(p)}%`) : '—'}
                        {res && res.attempts > 1 && (
                          <span title={`Latest of ${res.attempts} attempts`} style={{ color: 'var(--ink-4)', fontSize: 10.5, marginLeft: 3 }}>
                            ×{res.attempts}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: toneFor(r.avg) }}>
                    {r.avg === null ? '–' : `${Math.round(r.avg)}%`}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.missing > 0
                      ? <span className="px-pill" style={{ background: 'var(--warn-bg)', color: '#7B5800', border: '1px solid var(--warn-bd)' }}>{r.missing}</span>
                      : <Icon name="check" size={14} color="var(--ok)" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--ink-4)', margin: '10px 2px 0' }}>
        — means not submitted. Averages count only graded submissions, so an
        unsubmitted assessment does not read as a zero. On a paper with retakes
        on, the score shown is the student's latest attempt and ×n is how many
        times they have sat it — the full history is in Practice Results.
      </p>
    </div>
  );
}
