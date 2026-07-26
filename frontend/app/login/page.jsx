'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const isSignup = mode === 'signup';
  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    if (isSignup) {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'sign up failed');
        setBusy(false);
        return;
      }
    }

    const result = await signIn('credentials', {
      email: form.email,
      password: form.password,
      redirect: false,
    });

    if (result?.error) {
      setError('Incorrect email or password.');
      setBusy(false);
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">
          <span className="brand-mark">◆</span> Postly
        </h1>
        <p className="auth-sub">
          {isSignup ? 'Create an account to connect your social profiles.' : 'Sign in to your account.'}
        </p>

        {error && <div className="notice err">{error}</div>}

        <form className="form" onSubmit={submit}>
          {isSignup && (
            <div className="field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => update('name', e.target.value)}
                     placeholder="Your name" autoComplete="name" />
            </div>
          )}

          <div className="field">
            <label>Email</label>
            <input type="email" required value={form.email}
                   onChange={(e) => update('email', e.target.value)}
                   placeholder="you@example.com" autoComplete="email" />
          </div>

          <div className="field">
            <label>Password</label>
            <input type="password" required value={form.password}
                   onChange={(e) => update('password', e.target.value)}
                   placeholder={isSignup ? 'At least 8 characters' : '••••••••'}
                   autoComplete={isSignup ? 'new-password' : 'current-password'} />
          </div>

          <button className="btn btn-accent btn-block" disabled={busy}>
            {busy ? <span className="spinner" /> : isSignup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="auth-switch">
          {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button className="link-btn" onClick={() => { setMode(isSignup ? 'signin' : 'signup'); setError(null); }}>
            {isSignup ? 'Sign in' : 'Sign up'}
          </button>
        </p>
      </div>
    </div>
  );
}
