import { useState } from 'react';
import { supabase } from './supabase';

export default function Login({ onLogin }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('full_name', name.trim()) 
        .eq('student_code', code.trim());

      if (error) {
        console.error("Supabase Error:", error);
        throw error;
      }

      if (!data || data.length === 0) {
        setErrorMsg('❌ Invalid Name or Student Code. Please try again.');
      } 
      
      if (!data || data.length === 0) {
        setErrorMsg('❌ Invalid Name or Student Code. Please try again.');
      } else {
        const student = data[0]; // Isolate the specific student
        
        // 1. Generate the token and save to browser
        const newToken = crypto.randomUUID();
        localStorage.setItem('local_session_token', newToken);
        
        // 2. Save to database using student.id
        await supabase.from('users').update({ session_token: newToken }).eq('id', student.id);
        
        // 3. FINALLY, let them into the portal after saving is done!
        onLogin(student);
      }
      
    } catch (err) {
      console.error("Login Error:", err);
      setErrorMsg('⚠️ Database error. Check console for details.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container" style={{ maxWidth: '400px', margin: '100px auto', textAlign: 'center' }}>
      <h2 style={{ color: '#0A2342' }}>Student Portal</h2>
      <p style={{ marginBottom: '20px' }}>Enter your details to take your exam.</p>

      <form onSubmit={handleLogin}>
        <div style={{ marginBottom: '15px', textAlign: 'left' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Full Name:</label>
          <input 
            type="text" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            placeholder="e.g. Juan Dela Cruz" /* <-- UPDATED PLACEHOLDER */
            required
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: '20px', textAlign: 'left' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Student Code:</label>
          <input 
            type="text" 
            value={code} 
            onChange={(e) => setCode(e.target.value)} 
            placeholder="e.g. PATTS-01-123" /* <-- UPDATED PLACEHOLDER */
            required
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
          />
        </div>

        {errorMsg && (
          <div style={{ padding: '10px', background: '#fadbd8', color: '#c0392b', borderRadius: '4px', marginBottom: '15px', fontWeight: 'bold' }}>
            {errorMsg}
          </div>
        )}

        <button type="submit" disabled={isLoading} style={{ width: '100%', background: '#0A2342', color: 'white' }}>
          {isLoading ? 'Connecting...' : 'Log In'}
        </button>
      </form>
    </div>
  );
}