/*
  Login.jsx — PORTED VERSION
  ──────────────────────────────────────────────────────────────
  Drop into src/Login.jsx (replacing your current file).

  Compared to your current Login.jsx, this version:
   • Keeps ALL your Supabase auth logic untouched
   • Keeps the rate-limit / lockout state machine intact
   • Uses the new Icon component instead of emoji (🔒, ⏳, ⚠️)
   • Uses the new design tokens (--ink-1, --paper, --sh-2, etc.)
   • Adds a small "session bound to device" reassurance card
   • Uses Fraunces for the hero title

  Search for "PORTED:" comments to find every change.
*/

import { useState, useEffect } from 'react';
import { supabase, IS_DEMO } from './supabase';
import Icon from './components/Icon';   // PORTED: new icon component

const MAX_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 30;

export default function Login({ onLogin }) {
  const [loginMode, setLoginMode] = useState('student');
  // Prefilled in the demo build so a student can get straight in; empty in the
  // real build, where these must always be typed.
  const [email, setEmail] = useState(IS_DEMO ? 'juan.delacruz@demo.local' : '');
  const [credential, setCredential] = useState(IS_DEMO ? '2026-1-0001' : '');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [failedAttempts, setFailedAttempts] = useState(() =>
    parseInt(localStorage.getItem('login_failed_attempts') || '0', 10)
  );
  const [lockoutUntil, setLockoutUntil] = useState(() =>
    parseInt(localStorage.getItem('login_lockout_until') || '0', 10)
  );
  const [secondsLeft, setSecondsLeft] = useState(0);

  const isInstructor = loginMode === 'instructor';

  // Keep the demo prefill in step with the chosen role, so either tab is a
  // single click away from a working session.
  useEffect(() => {
    if (!IS_DEMO) return;
    if (loginMode === 'instructor') { setEmail('instructor@demo.local'); setCredential('demo'); }
    else { setEmail('juan.delacruz@demo.local'); setCredential('2026-1-0001'); }
  }, [loginMode]);
  const isLocked = lockoutUntil > Date.now();

  useEffect(() => {
    if (lockoutUntil <= Date.now()) { setSecondsLeft(0); return; }
    const tick = setInterval(() => {
      const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (remaining <= 0) { setSecondsLeft(0); clearInterval(tick); }
      else setSecondsLeft(remaining);
    }, 500);
    setSecondsLeft(Math.ceil((lockoutUntil - Date.now()) / 1000));
    return () => clearInterval(tick);
  }, [lockoutUntil]);

  const recordFailure = () => {
    const next = failedAttempts + 1;
    setFailedAttempts(next);
    localStorage.setItem('login_failed_attempts', String(next));
    if (next >= MAX_ATTEMPTS) {
      const until = Date.now() + LOCKOUT_SECONDS * 1000;
      setLockoutUntil(until);
      localStorage.setItem('login_lockout_until', String(until));
      localStorage.setItem('login_failed_attempts', '0');
      setFailedAttempts(0);
    }
  };

  const clearRateLimit = () => {
    setFailedAttempts(0); setLockoutUntil(0);
    localStorage.removeItem('login_failed_attempts');
    localStorage.removeItem('login_lockout_until');
  };

  // ── handleLogin — verbatim from your current Login.jsx ──
  const handleLogin = async (e) => {
    e.preventDefault();
    if (isLocked) return;
    setIsLoading(true);
    setErrorMsg('');

    try {
      if (isInstructor) {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password: credential.trim(),
        });
        if (authError || !authData?.user) {
          const msg = authError?.message || '';
          const isNetwork = msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network') || msg.toLowerCase().includes('connect');
          recordFailure();
          setErrorMsg(isNetwork
            ? 'Cannot reach the server. Check your internet or try again in a moment.'
            : 'Invalid instructor credentials. Please try again.');
          return;
        }
        try {
          await supabase.from('instructors').upsert({
            id: authData.user.id,
            email: authData.user.email,
            full_name: authData.user.user_metadata?.full_name || authData.user.email,
          }, { onConflict: 'id' });
        } catch { /* silent */ }
        clearRateLimit();
        onLogin({
          id: authData.user.id,
          role: 'admin',
          full_name: authData.user.user_metadata?.full_name || authData.user.email,
        });
        return;
      }

      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, section, student_email, student_code, session_token')
        .eq('student_email', email.trim().toLowerCase())
        .eq('student_code', credential.trim());

      if (error) {
        const msg = error.message || '';
        if (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network') || msg.toLowerCase().includes('connect')) {
          setErrorMsg('Cannot reach the server. Check your internet or try again in a moment.');
        } else {
          // Don't echo the raw Postgres/PostgREST message at students — it leaks
          // schema details and means nothing to them. It stays in the console.
          console.error('Login lookup failed:', error);
          setErrorMsg('Something went wrong on our end. Please try again in a moment.');
        }
        return;
      }

      if (!data || data.length === 0) {
        recordFailure();
        setErrorMsg('Invalid email or Student ID. Please check your credentials.');
        return;
      }

      const student = data[0];
      const newToken = crypto.randomUUID();
      localStorage.setItem('local_session_token', newToken);
      await supabase.from('users').update({ session_token: newToken }).eq('id', student.id);
      clearRateLimit();
      onLogin(student);
    } catch (err) {
      console.error('Login error:', err);
      setErrorMsg('Cannot reach the server. Check your internet and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // ═══════════════════════════════════════════════
  // PORTED: new JSX (everything below this line)
  // ═══════════════════════════════════════════════
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>

      {/* Hero band */}
      <div className="patts-header" style={{ padding: '36px 24px 80px', textAlign: 'center', position: 'relative' }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <img src="/patts-logo.png" alt="PATTS College of Aeronautics" style={{ height: 64, objectFit: 'contain' }} />
          {/* 40 uppercase characters at .12em tracking overflow a narrow phone,
              so cap the width and let it wrap onto two lines. */}
          <div className="eyebrow" style={{ color: 'var(--gold-bright)', fontSize: 11, maxWidth: 380, margin: '14px auto 0', lineHeight: 1.5 }}>
            Aeronautical Engineering Learning Portal
          </div>
          <h1 className="display" style={{ color: 'white', marginTop: 8, fontSize: 26 }}>
            Welcome back.
          </h1>
          <p style={{ margin: '6px auto 0', color: 'rgba(255,255,255,.7)', fontSize: 13.5, maxWidth: 380 }}>
            Sign in to access your lessons, seatwork and examinations.
          </p>
          {IS_DEMO && (
            <p style={{ margin: '10px auto 0', color: 'var(--gold-bright)', fontSize: 12.5, maxWidth: 420, lineHeight: 1.5 }}>
              Demo credentials are filled in for you — just press <strong>Log in</strong>.
              Instructor view: any email and password.
            </p>
          )}
        </div>
      </div>

      {/* Card overlapping the band */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '0 20px 40px', marginTop: -56, position: 'relative', zIndex: 1 }}>
        <form onSubmit={handleLogin} className="card" style={{
          width: '100%', maxWidth: 420, padding: 0, overflow: 'hidden', boxShadow: 'var(--s-lg)',
        }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', padding: 6, gap: 6, background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }}>
            {[
              { id: 'student', label: 'Student', icon: 'graduation' },
              { id: 'instructor', label: 'Instructor', icon: 'shield' },
            ].map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setLoginMode(t.id); setEmail(''); setCredential(''); setErrorMsg(''); }}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '10px 0', borderRadius: 'var(--r-sm)', border: 'none',
                  background: loginMode === t.id ? 'white' : 'transparent',
                  color: loginMode === t.id ? 'var(--navy)' : 'var(--ink-3)',
                  fontWeight: 600, fontSize: 13, cursor: 'pointer',
                  boxShadow: loginMode === t.id ? 'var(--s-xs)' : 'none',
                  transition: 'all var(--t-1)',
                }}
              >
                <Icon name={t.icon} size={15} />
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ padding: '28px 30px 30px' }}>
            <div className="eyebrow" style={{ fontSize: 10 }}>{isInstructor ? 'Faculty Access' : 'Student Access'}</div>
            <h3 style={{ margin: '4px 0 18px', fontSize: 18 }}>
              {isInstructor ? 'Instructor sign-in' : 'Enter your student credentials'}
            </h3>

            <div style={{ marginBottom: 14 }}>
              <label className="label">{isInstructor ? 'Faculty Email' : 'Student Email'}</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="juan.delacruz@patts.edu.ph"
                required
                disabled={isLocked || isLoading}
              />
            </div>

            <div style={{ marginBottom: 18 }}>
              <label className="label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{isInstructor ? 'Password' : 'Student ID'}</span>
                {!isInstructor && <span style={{ color: 'var(--ink-4)', fontWeight: 500 }}>Format: 2021-1-1234</span>}
              </label>
              <input
                className="input"
                type={isInstructor ? 'password' : 'text'}
                value={credential}
                onChange={e => setCredential(e.target.value)}
                placeholder={isInstructor ? '••••••••' : '2024-1-0421'}
                required
                disabled={isLocked || isLoading}
              />
            </div>

            {isLocked && (
              <div style={{
                padding: 12, borderRadius: 'var(--r-sm)', marginBottom: 14,
                background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)',
                color: 'var(--warn)', fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <Icon name="clock" size={16} />
                <span>Too many failed attempts. Try again in <strong>{secondsLeft}s</strong>.</span>
              </div>
            )}

            {errorMsg && !isLocked && (
              <div style={{
                padding: 12, borderRadius: 'var(--r-sm)', marginBottom: 14,
                background: 'var(--bad-bg)', border: '1px solid var(--bad-bd)',
                color: 'var(--bad)', fontSize: 13,
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <Icon name="alert" size={16} style={{ marginTop: 1 }} />
                <div>
                  <div style={{ fontWeight: 600 }}>{errorMsg}</div>
                  {failedAttempts > 0 && failedAttempts < MAX_ATTEMPTS && (
                    <div style={{ fontSize: 11.5, marginTop: 4, opacity: .85 }}>
                      {MAX_ATTEMPTS - failedAttempts} attempt{MAX_ATTEMPTS - failedAttempts !== 1 ? 's' : ''} remaining before lockout.
                    </div>
                  )}
                </div>
              </div>
            )}

            <button type="submit" disabled={isLoading || isLocked} className="btn lg" style={{ width: '100%' }}>
              {isLoading ? 'Connecting…' : isInstructor ? 'Sign in to dashboard' : 'Log in'}
              {!isLoading && <Icon name="arrow-right" size={16} />}
            </button>

            <div style={{
              marginTop: 18, padding: 12, background: 'var(--navy-50)',
              borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <Icon name="shield-check" size={16} color="var(--navy)" style={{ marginTop: 1 }} />
              <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                Sessions are tied to a single device. Closing your browser ends the attempt.
              </p>
            </div>
          </div>
        </form>
      </div>

      <p style={{ textAlign: 'center', margin: '20px 0 14px', fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.18em', fontWeight: 700 }}>
        KMR · PATTS COLLEGE OF AERONAUTICS
      </p>
    </div>
  );
}
