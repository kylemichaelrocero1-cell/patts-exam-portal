import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import Icon from '../components/Icon';
import {
  SURVEY_ID, SURVEY_LABEL, SURVEY_PARAM, STEPS, ITEMS, SUBJECTS, PREP,
  cleanAnswers, tally, scaleAverage, shareOf, answerText, itemById,
} from '../lib/boardSurvey.js';
import { isMissingFunctionError } from '../lib/assessmentsCore.js';
import { formatName } from '../lib/personName';

// Dashboard → Board Survey. What the graduates said in the board exam survey
// (Survey tab, src/StudentSurvey.jsx): headline numbers, how well PATTS
// prepared them per subject, the mock exams, what they wish the faculty had
// done, what came out per subject, and every typed answer. Names show only
// for students who allowed it; the database leaves the rest out (sql/149).

const PAGE = 1000;
// The student-facing step titles, as the faculty read them.
const CARD_TITLE = { you: 'Who answered', last: 'For the next batch' };
// Not at all → Very well, light to dark.
const PREP_TONES = ['#E4B4AA', '#E9D3A1', '#7C9CC4', 'var(--navy)'];

const when = iso => new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const who = r => (r.student_name ? formatName(r.student_name) : 'Name hidden');
// Typed answers are the students' own words: one that starts like a formula
// (=, +, -, @) is opened by Excel as text, not run.
const csvCell = raw => {
  const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
const pct = v => (v === null ? '–' : `${v}%`);

function Bars({ item, list }) {
  const { rows } = tally(item, list);
  const max = Math.max(1, ...rows.map(r => r.n));
  return (
    <div>
      {rows.map(r => (
        <div key={r.id} className={`bs-bar${r.n ? '' : ' is-zero'}`}>
          <span style={{ overflowWrap: 'anywhere' }}>{r.label}</span>
          <span className="bs-track"><span style={{ width: `${(r.n / max) * 100}%` }} /></span>
          <span className="bs-n">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

function Notes({ item, rows }) {
  const notes = rows.filter(r => r.answers.text[item.id]);
  if (!notes.length) return null;
  return (
    <details className="bs-details">
      <summary>{item.q} ({notes.length})</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notes.map(r => (
          <div key={r.id} className="bs-note">
            {r.answers.text[item.id]}
            <div className="bs-note-by">
              {who(r)}
              {item.id === 'message' && r.answers.one.share && ` · Share: ${answerText(itemById('share'), r.answers)}`}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

/** Every question on a step: picks as bars, typed answers folded. */
function StepCard({ step, rows, list }) {
  const picks = step.items.filter(it => it.kind !== 'text' && it.id !== 'share');
  const texts = step.items.filter(it => it.kind === 'text');
  return (
    <div className="card bs-card">
      <h3 className="bs-h">{CARD_TITLE[step.id] || step.title}</h3>
      <div className="bs-grid" style={{ gap: 16 }}>
        {picks.map(it => (
          <div key={it.id}>
            <div className="bs-q">{it.q}</div>
            <Bars item={it} list={list} />
          </div>
        ))}
      </div>
      {texts.map(it => <Notes key={it.id} item={it} rows={rows} />)}
    </div>
  );
}

function PrepCard({ list }) {
  return (
    <div className="card bs-card">
      <h3 className="bs-h">How well PATTS prepared them</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: 'var(--ink-3)' }}>
        {PREP.map((o, i) => (
          <span key={o.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: PREP_TONES[i] }} />{o.label}
          </span>
        ))}
      </div>
      {SUBJECTS.map(s => {
        const item = itemById(`prep_${s.key}`);
        const { answered, rows } = tally(item, list);
        const avg = scaleAverage(item, list);
        return (
          <div key={s.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 140px) minmax(0, 1fr) 64px', gap: 10, alignItems: 'center', fontSize: 13 }}>
            <span style={{ fontWeight: 600 }} title={s.name}>{s.short}</span>
            <span className="bs-stack" title={rows.map(r => `${r.label}: ${r.n}`).join(' · ')}>
              {answered > 0 && rows.map((r, i) => <span key={r.id} style={{ width: `${(r.n / answered) * 100}%`, background: PREP_TONES[i] }} />)}
            </span>
            <span className="bs-n" title={`Average on a 1–4 scale, ${answered} answered`}>{avg === null ? '–' : `${avg.toFixed(1)} / 4`}</span>
          </div>
        );
      })}
    </div>
  );
}

function SubjectCard({ subject, rows, list }) {
  const item = itemById(`topics_${subject.key}`);
  const { answered, rows: topics } = tally(item, list);
  const ticked = topics.filter(t => t.n).sort((x, y) => y.n - x.n);
  const unticked = topics.filter(t => !t.n);
  return (
    <div className="card bs-card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h3 className="bs-h">{subject.name}</h3>
        <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{answered} answered</span>
      </div>
      {ticked.length > 0 && (
        <div style={{ maxWidth: 720 }}>
          {ticked.map(t => {
            const max = ticked[0].n;
            return (
              <div key={t.id} className="bs-bar">
                <span style={{ overflowWrap: 'anywhere' }}>{t.label}</span>
                <span className="bs-track"><span style={{ width: `${(t.n / max) * 100}%` }} /></span>
                <span className="bs-n">{t.n}</span>
              </div>
            );
          })}
        </div>
      )}
      {unticked.length > 0 && ticked.length > 0 && (
        <details className="bs-details">
          <summary style={{ color: 'var(--ink-3)' }}>Not ticked ({unticked.length})</summary>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>{unticked.map(t => t.label).join(' · ')}</p>
        </details>
      )}
      {STEPS.find(s => s.id === subject.key).items.filter(it => it.kind === 'text')
        .map(it => <Notes key={it.id} item={it} rows={rows} />)}
    </div>
  );
}

function Stat({ label, value, icon, chip }) {
  return (
    <div className="stat-cell">
      <span className={`chip chip-${chip}`}><Icon name={icon} size={18} /></span>
      <div>
        <div className="stat-cell-label">{label}</div>
        <div className="stat-cell-value">{value}</div>
      </div>
    </div>
  );
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'passed', label: 'Passed' },
  { id: 'not_passed', label: 'Did not pass' },
];

export default function BoardSurvey() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/?${SURVEY_PARAM}`;

  // Read on open and on Refresh (which bumps `reload`).
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = [];
        for (;;) {
          const { data, error: err } = await supabase
            .rpc('board_survey_responses_for_faculty', { p_survey: SURVEY_ID })
            .order('id', { ascending: true })
            .range(all.length, all.length + PAGE - 1);
          if (err) throw err;
          all.push(...(data || []));
          if (!data || data.length < PAGE) break;
        }
        all.sort((x, y) => Date.parse(y.updated_at) - Date.parse(x.updated_at));
        if (cancelled) return;
        setRows(all.map(r => ({ ...r, answers: cleanAnswers(r.answers) })));
        setError('');
      } catch (err) {
        if (cancelled) return;
        setRows([]);
        setError(isMissingFunctionError(err)
          ? 'The survey is not set up yet: run sql/149 in Supabase.'
          : 'Could not load the survey answers. Try Refresh.');
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  const shown = useMemo(
    () => (rows || []).filter(r => filter === 'all' || r.answers.one.result === filter),
    [rows, filter],
  );
  const list = useMemo(() => shown.map(r => r.answers), [shown]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt('Copy this link:', link); }
  };

  const downloadCsv = () => {
    if (!rows?.length) return;
    const stepTitle = Object.fromEntries(STEPS.map(s => [s.id, s.short || s.title]));
    const head = ['Name', 'Section', 'Finished', 'Updated', ...ITEMS.map(it => `${stepTitle[it.step]}: ${it.q}`)];
    const lines = rows.map(r => [
      r.student_name ? formatName(r.student_name) : '', r.section || '',
      r.completed_at ? 'yes' : 'no', r.updated_at,
      ...ITEMS.map(it => answerText(it, r.answers)),
    ].map(v => csvCell(String(v ?? ''))).join(','));
    const blob = new Blob(['﻿' + [head.map(csvCell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `board-survey-${SURVEY_ID}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const finished = (rows || []).filter(r => r.completed_at).length;
  const passed = (rows || []).filter(r => r.answers.one.result === 'passed').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card bs-card">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">Board exam survey · {SURVEY_LABEL}</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>
              {rows === null ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'response' : 'responses'} · ${finished} finished`}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4, overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)' }}>{link}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn ghost sm" onClick={copy}><Icon name="copy" size={14} /> {copied ? 'Copied' : 'Copy link'}</button>
            <button type="button" className="btn ghost sm" onClick={downloadCsv} disabled={!rows?.length}><Icon name="download" size={14} /> CSV</button>
            <button type="button" className="btn ghost sm" onClick={() => { setRows(null); setError(''); setReload(n => n + 1); }}><Icon name="refresh" size={14} /> Refresh</button>
          </div>
        </div>
        {error && <div className="sv-error" role="alert"><Icon name="alert" size={15} /> {error}</div>}
      </div>

      {rows !== null && rows.length === 0 && !error && (
        <div className="card bs-card" style={{ alignItems: 'center', padding: 36, color: 'var(--ink-4)' }}>
          <Icon name="message" size={30} />
          <button type="button" className="btn" onClick={copy}><Icon name="copy" size={14} /> {copied ? 'Copied' : 'Copy survey link'}</button>
        </div>
      )}

      {!!rows?.length && (
        <>
          <div className="mx-segments" role="group" aria-label="Result" style={{ alignSelf: 'flex-start' }}>
            {FILTERS.map(f => (
              <button key={f.id} type="button" aria-pressed={filter === f.id}
                className={filter === f.id ? 'is-on' : ''} onClick={() => setFilter(f.id)}>
                {f.label} <span>{f.id === 'all' ? rows.length : rows.filter(r => r.answers.one.result === f.id).length}</span>
              </button>
            ))}
          </div>

          <div className="stat-strip" style={{ display: 'grid' }}>
            <Stat label="Passed" value={`${passed} / ${rows.length}`} icon="trophy" chip="gold" />
            <Stat label="Mock exams helpful" value={pct(shareOf(itemById('mocks_helpful'), list, ['helpful', 'very']))} icon="practice" chip="navy" />
            <Stat label="Mocks added to preparedness" value={pct(shareOf(itemById('mocks_prepared'), list, ['a_lot', 'somewhat']))} icon="trend-up" chip="ok" />
            <Stat label="Would recommend PATTS" value={pct(shareOf(itemById('recommend'), list, ['yes']))} icon="graduation" chip="blue" />
          </div>

          {shown.length === 0 ? (
            <div className="card bs-card" style={{ alignItems: 'center', padding: 28, color: 'var(--ink-4)' }}>
              <Icon name="filter" size={26} />
            </div>
          ) : (
            <>
              <PrepCard list={list} />
              <StepCard step={STEPS.find(s => s.id === 'mocks')} rows={shown} list={list} />
              <StepCard step={STEPS.find(s => s.id === 'faculty')} rows={shown} list={list} />
              <StepCard step={STEPS.find(s => s.id === 'you')} rows={shown} list={list} />
              {SUBJECTS.map(s => <SubjectCard key={s.key} subject={s} rows={shown} list={list} />)}
              <StepCard step={STEPS.find(s => s.id === 'last')} rows={shown} list={list} />
            </>
          )}

          <div className="card bs-card">
            <h3 className="bs-h">Responses</h3>
            <div>
              {rows.map(r => (
                <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'center', fontSize: 13, padding: '7px 0', borderTop: '1px solid var(--line-soft)' }}>
                  <span style={{ fontWeight: 600, flex: '1 1 200px', minWidth: 0, color: r.student_name ? 'var(--ink-1)' : 'var(--ink-4)' }}>
                    {who(r)}{r.section && <span style={{ fontWeight: 400, color: 'var(--ink-4)' }}> · {r.section}</span>}
                  </span>
                  <span style={{ color: 'var(--ink-2)' }}>{answerText(itemById('result'), r.answers) || '—'}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, padding: '1px 8px', borderRadius: 99, background: r.completed_at ? 'var(--ok-bg)' : 'var(--surface-2)', color: r.completed_at ? 'var(--ok)' : 'var(--ink-3)' }}>
                    {r.completed_at ? 'Finished' : 'In progress'}
                  </span>
                  <span style={{ color: 'var(--ink-4)', fontVariantNumeric: 'tabular-nums' }}>{when(r.updated_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
