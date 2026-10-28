// The last screen before a sitting starts.
//
// Almost every violation the monitor records is a student who did not know
// their device was going to do it: a notification steals focus, the screen
// sleeps, a cached tab is restored on top. The proctoring rules do not bend for
// any of that, so the only fair thing is to say plainly, once, what will be
// counted and what to turn off first. It is a checklist, not a quiz — nothing
// here is verifiable from the browser, and pretending otherwise would just
// block students over a check we cannot actually make.

import Icon from './Icon';

const RULES = [
  {
    icon: 'bell-off',
    title: 'Silence every notification',
    body: 'Turn on Do Not Disturb / Focus. A banner from Messenger, email or Viber takes the focus off this page and is logged as a violation.',
  },
  {
    icon: 'message',
    title: 'Turn off chat heads and bubbles',
    body: 'Messenger chat heads, Android bubbles and any floating chat window must be off before you start — in Messenger\'s settings, and on Android under Settings → Notifications → Bubbles (on Samsung: Floating notifications). Anything opened over the exam hides the paper and is recorded as a violation.',
  },
  {
    icon: 'moon',
    title: 'Stop the screen from sleeping',
    body: 'Switch off auto-lock, auto-sleep and the screensaver. If the screen locks while you are thinking, coming back counts against you.',
  },
  {
    icon: 'battery',
    title: 'Charge the device, or plug it in',
    body: 'A device that dies mid-exam ends the sitting where it stands. Only what has been saved is submitted.',
  },
  {
    icon: 'eye-off',
    title: 'Use a private / incognito window',
    body: 'A normal window can restore old tabs, autofill, or pop up an extension over the exam. A fresh private window will not.',
  },
  {
    icon: 'layers',
    title: 'Close every other tab and app',
    body: 'This portal should be the only thing open. Switching to anything else — even for a second — is recorded, and four violations lock your paper until your instructor clears it.',
  },
  {
    icon: 'wifi',
    title: 'Sit somewhere with a stable connection',
    body: 'Your answers save every few seconds. A connection that drops in and out risks losing the most recent ones.',
  },
  {
    icon: 'smartphone',
    title: 'On a phone, keep the page at normal size',
    body: 'If this page looks tiny, turn off "Desktop site" (iPhone: tap aA → Request Mobile Website) and set the zoom to 100%. Previous, Next and the question list are in the bar at the bottom of the screen.',
  },
  {
    icon: 'ban',
    title: 'Do not refresh, minimise or go back',
    body: 'Refreshing is counted as a violation. Use the Submit button when you are finished — nothing else ends the exam safely.',
  },
];

// The set a student tapped, said back to them before the paper opens: on a
// paper in sets (sql/116) the first set opened is the one they sit, and
// eight buttons side by side on a phone are easy to mis-tap.
export function ChosenSet({ exam, setChoice }) {
  if (!exam?.set_labels?.length || !setChoice) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <span style={{ display: 'inline-block', background: 'var(--gold-bright, #F4D03F)', color: 'var(--navy-dark, #061829)',
        fontWeight: 800, fontSize: 15, padding: '4px 14px', borderRadius: 999, letterSpacing: '.02em' }}>
        Set {setChoice}
      </span>
      <p style={{ color: 'rgba(255,255,255,.75)', margin: '6px 0 0', fontSize: 12 }}>
        Not your set? Cancel and choose again. Once the paper opens, the set cannot be changed.
      </p>
    </div>
  );
}

export default function ExamReadinessModal({ exam, setChoice, onAcknowledge, onCancel }) {
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
          <span aria-hidden="true" style={{
            width: 40, height: 40, borderRadius: 12, marginBottom: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(244,208,63,.14)', border: '1px solid rgba(244,208,63,.35)',
          }}>
            <Icon name="shield-check" size={21} color="var(--gold-bright, #F4D03F)" />
          </span>
          <h2 id="readiness-title" style={{ color: 'white', margin: 0, fontSize: 18, fontWeight: 700 }}>
            Before you begin
          </h2>
          <p style={{ color: 'rgba(244,208,63,.85)', margin: '6px 0 0', fontSize: 13, fontWeight: 500 }}>
            {exam?.title}
          </p>
          <ChosenSet exam={exam} setChoice={setChoice} />
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
                <span aria-hidden="true" style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--navy-tint, #EAF0F8)', color: 'var(--navy)',
                }}>
                  <Icon name={rule.icon} size={16} />
                </span>
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
