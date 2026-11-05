import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import Icon from './components/Icon';   // PORTED: new icon component

const MAX_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 30;

export default function Login({ onLogin }) {
  const [loginMode, setLoginMode] = useState('student');
  const [email, setEmail] = useState('');
  const [credential, setCredential] = useState('');
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
        .select('id, full_name, section, student_email, student_code, course')
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

      // The token is the student's proof of identity at every gate
      // (student_from_token, sql/020), and it only works if BOTH halves agree:
      // the copy in this browser and the copy on their row. Writing
      // localStorage first and never checking the update meant a failed write
      // left the two out of step — the student looked logged in, then hit
      // "your session has expired" at the exam password and had no way to
      // understand why. So the row is written FIRST, and a failure stops the
      // login instead of producing a session that cannot open anything.
      const newToken = crypto.randomUUID();
      const { error: tokenError } = await supabase.from('users')
        .update({ session_token: newToken }).eq('id', student.id);
      if (tokenError) {
        console.error('Could not start a session for this student:', tokenError);
        setErrorMsg('Could not start your session. Please try again in a moment.');
        return;
      }
      localStorage.setItem('local_session_token', newToken);
      clearRateLimit();
      onLogin(student);
    } catch (err) {
      console.error('Login error:', err);
      setErrorMsg('Cannot reach the server. Check your internet and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login">
      <div className="login-band flow-band">
        <img className="login-logo" src="/patts-logo.png" alt="PATTS College of Aeronautics" />
        <div>
          <h1>Aeronautical Engineering Learning Portal</h1>
        </div>
      </div>

      <div className="login-side">
        <form onSubmit={handleLogin} className="card login-form">
          {/* Mode toggle */}
          <div className="login-modes">
            {[
              { id: 'student', label: 'Student', icon: 'graduation' },
              { id: 'instructor', label: 'Instructor', icon: 'shield' },
            ].map(t => (
              <button
                key={t.id}
                type="button"
                className={`login-mode${loginMode === t.id ? ' is-on' : ''}`}
                aria-pressed={loginMode === t.id}
                onClick={() => { setLoginMode(t.id); setEmail(''); setCredential(''); setErrorMsg(''); }}
              >
                <Icon name={t.icon} size={16} />
                {t.label}
              </button>
            ))}
          </div>

          <div className="login-body">
            <div style={{ marginBottom: 14 }}>
              <label className="label">{isInstructor ? 'Faculty Email' : 'Student Email'}</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="juan.delacruz@patts.edu.ph"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                disabled={isLocked || isLoading}
              />
            </div>

            <div style={{ marginBottom: 18 }}>
              <label className="label">{isInstructor ? 'Password' : 'Student ID'}</label>
              <input
                className="input"
                type={isInstructor ? 'password' : 'text'}
                value={credential}
                onChange={e => setCredential(e.target.value)}
                placeholder={isInstructor ? '••••••••' : '2024-1-0421'}
                autoComplete={isInstructor ? 'current-password' : 'off'}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
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

            <div className="login-note">
              <Icon name="shield-check" size={16} color="var(--navy)" style={{ marginTop: 1 }} />
              <p>
                One device at a time. Answers auto-save.
              </p>
            </div>
          </div>
        </form>
        <p className="login-foot">KMR · PATTS College of Aeronautics</p>
      </div>
    </div>
  );
}
