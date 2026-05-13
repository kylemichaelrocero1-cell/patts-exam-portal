import { useState } from 'react';
import { supabase } from './supabase';

export default function Login({ onLogin }) {
  // 1. Updated state variables to reflect the new login method
  const [email, setEmail] = useState('');
  const [studentId, setStudentId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');

    // --- INSTRUCTOR SECRET LOGIN ---
    // Replace these with whatever you want your admin username and password to be
    if (email.trim() === 'instructor@patts.edu.ph' && studentId.trim() === 'admin123') {
      onLogin({ id: 'admin-1', role: 'admin', full_name: 'Instructor' });
      return; 
    }

    try {
      // 2. Updated the database query to search for 'email' and 'student_id'
     // 2. Updated the database query to match your exact CSV headers
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('student_email', email.trim().toLowerCase()) // <--- Changed to student_email
        .eq('student_code', studentId.trim());           // <--- Changed to student_code
      if (error) {
        console.error("Supabase Error:", error);
        throw error;
      }

      if (!data || data.length === 0) {
        setErrorMsg('❌ Invalid Email or Student ID. Please try again.');
      } else {
        const student = data[0]; 
        
        // --- Clone Guard Logic ---
        const newToken = crypto.randomUUID();
        localStorage.setItem('local_session_token', newToken);
        await supabase.from('users').update({ session_token: newToken }).eq('id', student.id);
        
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
        {/* 3. Updated Email Input Field */}
        <div style={{ marginBottom: '15px', textAlign: 'left' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Student Email:</label>
          <input 
            type="email" /* Changed to type="email" so mobile keyboards show the "@" symbol */
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            placeholder="e.g. juan.delacruz@patts.edu.ph"
            required
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
          />
        </div>

        {/* 4. Updated Student ID Input Field */}
        <div style={{ marginBottom: '20px', textAlign: 'left' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Student ID:</label>
          <input 
            type="text" 
            value={studentId} 
            onChange={(e) => setStudentId(e.target.value)} 
            placeholder="e.g. 2021-1-1234"
            required
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
          />
        </div>

        {errorMsg && (
          <div style={{ padding: '10px', background: '#FADBD8', color: '#C0392B', borderRadius: '4px', marginBottom: '15px', fontWeight: 'bold' }}>
            {errorMsg}
          </div>
        )}

        <button type="submit" disabled={isLoading} style={{ width: '100%', background: '#0A2342', color: 'white', padding: '12px', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
          {isLoading ? 'Connecting...' : 'Log In'}
        </button>
      </form>
    </div>
  );
}