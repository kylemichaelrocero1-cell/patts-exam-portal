// The last screen before a sitting starts.
//
// Almost every violation the monitor records is a student who did not know
// their device was going to do it: a notification steals focus, the screen
// sleeps, a cached tab is restored on top. The proctoring rules do not bend for
// any of that, so the only fair thing is to say plainly, once, what will be
// counted and what to turn off first. It is a checklist, not a quiz — nothing
// here is verifiable from the browser, and pretending otherwise would just
// block students over a check we cannot actually make.

const RULES = [
  {
    icon: '🔕',
    title: 'Silence every notification',
    body: 'Turn on Do Not Disturb / Focus. A banner from Messenger, email or Viber takes the focus off this page and is logged as a violation.',
  },
  {
    icon: '⏾',
    title: 'Stop the screen from sleeping',
    body: 'Switch off auto-lock, auto-sleep and the screensaver. If the screen locks while you are thinking, coming back counts against you.',
  },
  {
    icon: '🔋',
    title: 'Charge the device, or plug it in',
    body: 'A device that dies mid-exam ends the sitting where it stands. Only what has been saved is submitted.',
  },
  {
    icon: '🕵️',
    title: 'Use a private / incognito window',
    body: 'A normal window can restore old tabs, autofill, or pop up an extension over the exam. A fresh private window will not.',
  },
  {
    icon: '🗂️',
    title: 'Close every other tab and app',
    body: 'This portal should be the only thing open. Switching to anything else — even for a second — is recorded, and four violations lock your paper until your instructor clears it.',
  },
  {
    icon: '📶',
    title: 'Sit somewhere with a stable connection',
    body: 'Your answers save every few seconds. A connection that drops in and out risks losing the most recent ones.',
  },
  {
    icon: '🚫',
    title: 'Do not refresh, minimise or go back',
    body: 'Refreshing is counted as a violation. Use the Submit button when you are finished — nothing else ends the exam safely.',
  },
];

export default function ExamReadinessModal({ exam, onAcknowledge, onCancel }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onCancel?.(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="readiness-title"
    >
      <div style={{ background: 'var(--white)', borderRadius: 'var(--r-xl)', maxWidth: 560, width: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--s-xl)' }}>
        <div style={{ background: 'linear-gradient(110deg, var(--navy-dark), var(--navy))', padding: '24px 28px', borderBottom: '3px solid var(--gold)', flexShrink: 0 }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>⚠️</div>
          <h2 id="readiness-title" style={{ color: 'white', margin: 0, fontSize: 18, fontWeight: 700 }}>
            Before you begin
          </h2>
          <p style={{ color: 'rgba(244,208,63,.85)', margin: '6px 0 0', fontSize: 13, fontWeight: 500 }}>
            {exam?.title}
          </p>
        </div>

        <div style={{ padding: '20px 28px', overflowY: 'auto', flex: 1 }}>
          <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
            This exam is proctored. Your device is watched for anything that takes you off this
            page, and every incident reaches your instructor with a timestamp. Set the following up
            <strong> now</strong> — once the timer starts, fixing it counts as a violation too.
          </p>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {RULES.map(rule => (
              <li key={rule.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '11px 13px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface-2, #F7F8FA)' }}>
                <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 1.4, flexShrink: 0 }}>{rule.icon}</span>
                <span>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5, color: 'var(--navy)' }}>{rule.title}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.55 }}>{rule.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ padding: '16px 28px 22px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, flexShrink: 0 }}>
          <button type="button" onClick={onCancel}
            style={{ flex: 1, background: 'var(--surface-2)', color: 'var(--text-2)', border: '1.5px solid var(--border)' }}>
            Not yet
          </button>
          <button type="button" onClick={onAcknowledge} autoFocus
            style={{ flex: 2, background: 'var(--navy)', color: 'white', fontWeight: 700 }}>
            I understand — continue
          </button>
        </div>
      </div>
    </div>
  );
}
