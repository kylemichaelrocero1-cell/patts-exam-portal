import { useState, useEffect } from 'react';
import { supabase } from './supabase';

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL;
const MAX_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 30;

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [credential, setCredential] = useState(''); // student_code OR admin password
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Rate limiting state — persisted to sessionStorage so refresh doesn't reset it
  const [failedAttempts, setFailedAttempts] = useState(() =>
    parseInt(sessionStorage.getItem('login_failed_attempts') || '0', 10)
  );
  const [lockoutUntil, setLockoutUntil] = useState(() =>
    parseInt(sessionStorage.getItem('login_lockout_until') || '0', 10)
  );
  const [secondsLeft, setSecondsLeft] = useState(0);

  const isAdmin = email.trim().toLowerCase() === ADMIN_EMAIL?.toLowerCase();

  // Countdown timer during lockout
  useEffect(() => {
    if (lockoutUntil <= Date.now()) { setSecondsLeft(0); return; }
    const tick = setInterval(() => {
      const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setSecondsLeft(0);
        clearInterval(tick);
      } else {
        setSecondsLeft(remaining);
      }
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
    setFailedAttempts(0);
    setLockoutUntil(0);
    sessionStorage.removeItem('login_failed_attempts');
    sessionStorage.removeItem('login_lockout_until');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (lockoutUntil > Date.now()) return;

    setIsLoading(true);
    setErrorMsg('');

    try {
      if (isAdmin) {
        // Admin login — credentials verified by Supabase Auth (password never in source code)
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password: credential.trim(),
        });

        if (authError || !authData?.user) {
          recordFailure();
          setErrorMsg('❌ Invalid instructor credentials. Please try again.');
          return;
        }

        clearRateLimit();
        onLogin({ id: authData.user.id, role: 'admin', full_name: 'Instructor' });
        return;
      }

      // Student login — DB-based auth
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, section, student_email, student_code, session_token')
        .eq('student_email', email.trim().toLowerCase())
        .eq('student_code', credential.trim());

      if (error) throw error;

      if (!data || data.length === 0) {
        recordFailure();
        setErrorMsg('❌ Invalid Email or Student ID. Please try again.');
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
      setErrorMsg('⚠️ Connection error. Please check your internet and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const isLocked = lockoutUntil > Date.now();

  return (
    <div className="login-container" style={{ maxWidth: '420px', margin: '100px auto', textAlign: 'center', padding: '0 20px' }}>
      <h2 style={{ color: '#0A2342' }}>Student Portal</h2>
      <p style={{ marginBottom: '20px', color: '#555' }}>Enter your details to access your exam.</p>

      <form onSubmit={handleLogin}>
        <div style={{ marginBottom: '15px', textAlign: 'left' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
            {isAdmin ? 'Instructor Email:' : 'Student Email:'}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. juan.delacruz@patts.edu.ph"
            required
            disabled={isLocked || isLoading}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: '20px', textAlign: 'left' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
            {isAdmin ? 'Password:' : 'Student ID:'}
          </label>
          <input
            type={isAdmin ? 'password' : 'text'}
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
            placeholder={isAdmin ? 'Enter instructor password' : 'e.g. 2021-1-1234'}
            required
            disabled={isLocked || isLoading}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
          />
        </div>

        {isLocked && (
          <div style={{ padding: '12px', background: '#FFF3CD', color: '#856404', borderRadius: '4px', marginBottom: '15px', fontWeight: 'bold', border: '1px solid #FFEEBA' }}>
            Too many failed attempts. Try again in {secondsLeft}s.
          </div>
        )}

        {errorMsg && !isLocked && (
          <div style={{ padding: '10px', background: '#FADBD8', color: '#C0392B', borderRadius: '4px', marginBottom: '15px', fontWeight: 'bold' }}>
            {errorMsg}
            {failedAttempts > 0 && failedAttempts < MAX_ATTEMPTS && (
              <div style={{ fontSize: '12px', marginTop: '4px', color: '#922B21' }}>
                {MAX_ATTEMPTS - failedAttempts} attempt{MAX_ATTEMPTS - failedAttempts !== 1 ? 's' : ''} remaining before lockout.
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || isLocked}
          style={{ width: '100%', background: isLocked ? '#aaa' : '#0A2342', color: 'white', padding: '12px', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: isLocked ? 'not-allowed' : 'pointer' }}
        >
          {isLoading ? 'Connecting...' : isAdmin ? 'Instructor Login' : 'Log In'}
        </button>
      </form>
    </div>
  );
}
