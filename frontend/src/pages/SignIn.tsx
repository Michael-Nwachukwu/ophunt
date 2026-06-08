import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';

type Step = 'form' | 'sent' | 'error';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await apiFetch('/api/auth/send-magic-link', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        setStep('sent');
      } else {
        const data = await res.json() as { error?: string };
        setErrorMsg(data.error || 'Something went wrong');
        setStep('error');
      }
    } catch {
      setErrorMsg('Could not reach server — check your connection');
      setStep('error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{ minHeight: '100vh', background: '#fffaf0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}
    >
      <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '40px' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#ff4d8b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '20px', fontWeight: 500, color: '#fff', letterSpacing: '-1px' }}>O</span>
        </div>
        <span style={{ fontSize: '22px', fontWeight: 600, color: '#0a0a0a', letterSpacing: '-0.5px' }}>OpHunt</span>
      </Link>

      <div
        style={{ width: '100%', maxWidth: '400px', background: '#fff', border: '1px solid rgba(10,10,10,0.08)', borderRadius: '20px', padding: '36px 32px' }}
      >
        {step === 'sent' ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>📬</div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0a0a0a', margin: '0 0 8px' }}>Check your inbox</h1>
            <p style={{ fontSize: '14px', color: '#666', margin: '0 0 24px', lineHeight: 1.6 }}>
              We sent a sign-in link to <strong>{email}</strong>. Click it to continue — link expires in 15 minutes.
            </p>
            <button
              onClick={() => { setStep('form'); setEmail(''); }}
              style={{ fontSize: '13px', color: '#ff4d8b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0a0a0a', margin: '0 0 6px' }}>Sign in</h1>
            <p style={{ fontSize: '14px', color: '#666', margin: '0 0 28px' }}>
              No password needed — we'll email you a link.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={loading}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '12px 14px', fontSize: '15px',
                  border: '1.5px solid rgba(10,10,10,0.15)', borderRadius: '12px',
                  background: '#fafafa', outline: 'none',
                  fontFamily: 'inherit', color: '#0a0a0a',
                }}
              />
              {step === 'error' && (
                <p style={{ margin: 0, fontSize: '13px', color: '#cc2222' }}>{errorMsg}</p>
              )}
              <button
                type="submit"
                disabled={loading || !email.trim()}
                style={{
                  background: '#ff4d8b', color: '#fff', border: 'none',
                  borderRadius: '12px', padding: '12px', fontSize: '15px',
                  fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading || !email.trim() ? 0.6 : 1,
                  fontFamily: 'inherit',
                }}
              >
                {loading ? 'Sending…' : 'Send sign-in link'}
              </button>
            </form>

            <p style={{ fontSize: '12px', color: '#999', marginTop: '20px', textAlign: 'center', lineHeight: 1.5 }}>
              By signing in you agree to our terms. We'll only email you for sign-in and your weekly digest.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
