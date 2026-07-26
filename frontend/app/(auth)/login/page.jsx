'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PostlyLogo } from '../../../components/BrandIcons';

const FEATURES = [
  'AI writes the caption, hashtags and CTA',
  'A matching promo image, generated for you',
  'One-click connect to every platform',
  'Every post logged, with real error details',
];

export default function LoginPage() {
  const [mode, setMode] = useState('signin');
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
      if (!res.ok) { setError(json.error || 'Sign up failed.'); setBusy(false); return; }
    }

    const result = await signIn('credentials', {
      email: form.email, password: form.password, redirect: false,
    });
    if (result?.error) { setError('Incorrect email or password.'); setBusy(false); return; }

    router.push('/');
    router.refresh();
  }

  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <PostlyLogo size={36} />

        <div className="auth-pitch">
          <h2>One idea in. Everywhere out.</h2>
          <p>Describe a product once — Postly creates the post and publishes it across your social accounts.</p>
          <ul className="auth-feats">
            {FEATURES.map((f) => (
              <li key={f}><span className="auth-tick">✓</span>{f}</li>
            ))}
          </ul>
        </div>

        <span style={{ fontSize: 12.5, opacity: 0.65, position: 'relative', zIndex: 1 }}>
          Pinterest · Instagram · Facebook · X · LinkedIn · TikTok
        </span>
      </aside>

      <section className="auth-form-side">
        <div className="auth-card">
          <h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="auth-sub">
            {isSignup
              ? 'Start publishing in a couple of minutes.'
              : 'Sign in to manage your connections and posts.'}
          </p>

          {error && <div className="notice err"><strong>!</strong><span>{error}</span></div>}

          <form className="form" onSubmit={submit}>
            {isSignup && (
              <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" value={form.name} onChange={(e) => update('name', e.target.value)}
                       placeholder="Your name" autoComplete="name" />
              </div>
            )}

            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required value={form.email}
                     onChange={(e) => update('email', e.target.value)}
                     placeholder="you@example.com" autoComplete="email" />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" required value={form.password}
                     onChange={(e) => update('password', e.target.value)}
                     placeholder={isSignup ? 'At least 8 characters' : '••••••••'}
                     autoComplete={isSignup ? 'new-password' : 'current-password'} />
            </div>

            <button className="btn btn-accent btn-lg btn-block" disabled={busy}>
              {busy ? <span className="spinner" /> : isSignup ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="auth-switch">
            {isSignup ? 'Already have an account?' : "Don't have an account?"}
            <button className="link-btn" onClick={() => { setMode(isSignup ? 'signin' : 'signup'); setError(null); }}>
              {isSignup ? 'Sign in' : 'Sign up free'}
            </button>
          </p>

          {isSignup && (
            <p className="auth-legal">
              By creating an account you agree to our{' '}
              <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
