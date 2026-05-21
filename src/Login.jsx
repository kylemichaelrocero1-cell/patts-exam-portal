import { useState, useEffect } from 'react';
import { supabase } from './supabase';

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL;
const MAX_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 30;

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [credential, setCredential] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [failedAttempts, setFailedAttempts] = useState(() =>
    parseInt(sessionStorage.getItem('login_failed_attempts') || '0', 10)
  );
  const [lockoutUntil, setLockoutUntil] = useState(() =>
    parseInt(sessionStorage.getItem('login_lockout_until') || '0', 10)
  );
  const [secondsLeft, setSecondsLeft] = useState(0);

  const isAdmin = email.trim().toLowerCase() === ADMIN_EMAIL?.toLowerCase();
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
    sessionStorage.setItem('login_failed_attempts', String(next));
    if (next >= MAX_ATTEMPTS) {
      const until = Date.now() + LOCKOUT_SECONDS * 1000;
      setLockoutUntil(until);
      sessionStorage.setItem('login_lockout_until', String(until));
      sessionStorage.setItem('login_failed_attempts', '0');
      setFailedAttempts(0);
    }
  };

  const clearRateLimit = () => {
    setFailedAttempts(0); setLockoutUntil(0);
    sessionStorage.removeItem('login_failed_attempts');
    sessionStorage.removeItem('login_lockout_until');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (isLocked) return;
    setIsLoading(true);
    setErrorMsg('');

    try {
      if (isAdmin) {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password: credential.trim(),
        });
        if (authError || !authData?.user) {
          recordFailure();
          setErrorMsg('Invalid instructor credentials. Please try again.');
          return;
        }
        clearRateLimit();
        onLogin({ id: authData.user.id, role: 'admin', full_name: 'Instructor' });
        return;
      }

      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, section, student_email, student_code, session_token')
        .eq('student_email', email.trim().toLowerCase())
        .eq('student_code', credential.trim());

      if (error) throw error;

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
      setErrorMsg('Connection error. Please check your internet and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', background: 'var(--bg)' }}>
      <div className="login-container" style={{ width: '100%', maxWidth: '420px' }}>

        {/* School Header */}
        <div style={{
          background: 'linear-gradient(110deg, var(--navy-dark) 0%, var(--navy) 60%, var(--navy-mid) 100%)',
          padding: '32px 36px 28px',
          textAlign: 'center',
          borderBottom: '3px solid var(--gold)',
        }}>
          <img
            src="/patts-logo.png"
            alt="PATTS College of Aeronautics"
            style={{ height: '72px', width: 'auto', margin: '0 auto 6px', display: 'block', objectFit: 'contain' }}
          />
          <p style={{ margin: '8px 0 0', color: 'rgba(244,208,63,0.85)', fontSize: '12.5px', fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase' }}>
            Online Examination Portal
          </p>
        </div>

        {/* Form Body */}
        <div style={{ padding: '32px 36px 36px' }}>
          <p style={{ margin: '0 0 24px', color: 'var(--text-3)', fontSize: '14px', textAlign: 'center' }}>
            {isAdmin ? 'Sign in with your instructor credentials.' : 'Enter your student email and ID to begin.'}
          </p>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '13px', color: 'var(--text-2)', marginBottom: '6px' }}>
                {isAdmin ? 'Instructor Email' : 'Student Email'}
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="e.g. juan.delacruz@patts.edu.ph"
                required
                disabled={isLocked || isLoading}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '13px', color: 'var(--text-2)', marginBottom: '6px' }}>
                {isAdmin ? 'Password' : 'Student ID'}
              </label>
              <input
                type={isAdmin ? 'password' : 'text'}
                value={credential}
                onChange={e => setCredential(e.target.value)}
                placeholder={isAdmin ? 'Enter instructor password' : 'e.g. 2021-1-1234'}
                required
                disabled={isLocked || isLoading}
              />
            </div>

            {isLocked && (
              <div style={{
                padding: '12px 16px', borderRadius: 'var(--r-sm)', marginBottom: '16px',
                background: 'var(--warning-bg)', border: '1px solid var(--warning-bd)',
                color: 'var(--warning)', fontSize: '13.5px', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span>⏳</span>
                <span>Too many failed attempts. Try again in <strong>{secondsLeft}s</strong>.</span>
              </div>
            )}

            {errorMsg && !isLocked && (
              <div style={{
                padding: '12px 16px', borderRadius: 'var(--r-sm)', marginBottom: '16px',
                background: 'var(--danger-bg)', border: '1px solid var(--danger-bd)',
                color: 'var(--danger)', fontSize: '13.5px', fontWeight: 500,
              }}>
                ⚠️ {errorMsg}
                {failedAttempts > 0 && failedAttempts < MAX_ATTEMPTS && (
                  <div style={{ fontSize: '12px', marginTop: '4px', opacity: .8 }}>
                    {MAX_ATTEMPTS - failedAttempts} attempt{MAX_ATTEMPTS - failedAttempts !== 1 ? 's' : ''} remaining before lockout.
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || isLocked}
              style={{
                background: isAdmin ? 'linear-gradient(135deg, var(--navy-mid), var(--navy))' : 'linear-gradient(135deg, var(--navy), var(--navy-dark))',
                color: 'white',
                padding: '13px',
                fontSize: '15px',
                borderRadius: 'var(--r-sm)',
                border: 'none',
                boxShadow: isLocked ? 'none' : 'var(--s-sm)',
              }}
            >
              {isLoading ? 'Connecting…' : isAdmin ? 'Sign In as Instructor' : 'Log In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
