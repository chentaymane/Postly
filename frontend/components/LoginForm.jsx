'use client';

import { useState, useEffect, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PostlyLogo } from './BrandIcons';

const FEATURES = [
  'AI writes the caption, hashtags and CTA',
  'A matching promo image, generated for you',
  'One-click connect to every platform',
  'Every post logged, with real error details',
];

// Google requires their own mark and colours on a "Continue with Google"
// button, so this is the one icon here that does not take currentColor.
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

function LoginFormInner({ googleEnabled }) {
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  // Where the visitor was heading before the gate stopped them. Sending them
  // on afterwards is the difference between signing in and being interrupted.
  const next = params.get('next') || '/dashboard';

  // The landing page's two buttons differ only in this, so the form opens on
  // the tab the visitor actually asked for.
  useEffect(() => {
    if (params.get('mode') === 'signup') setMode('signup');
  }, [params]);

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

    router.push(next);
    router.refresh();
  }

  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <PostlyLogo />

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

          {googleEnabled && (
            <>
              <button type="button" className="btn btn-google btn-lg btn-block"
                      disabled={busy}
                      onClick={() => { setBusy(true); signIn("google", { callbackUrl: next }); }}>
                <GoogleMark />
                Continue with Google
              </button>
              <div className="auth-divider">or</div>
            </>
          )}

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

// useSearchParams opts this subtree into client rendering; the boundary keeps
// the route itself static instead of failing the build.
export default function LoginForm({ googleEnabled }) {
  return (
    <Suspense fallback={<div className="auth-shell" />}>
      <LoginFormInner googleEnabled={googleEnabled} />
    </Suspense>
  );
}
