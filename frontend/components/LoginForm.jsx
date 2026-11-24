'use client';

import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { PostlyLogo } from './BrandIcons';

const FEATURES = [
  'AI writes the caption, hashtags and CTA',
  'A matching promo image, generated for you',
  'One-click connect to every platform',
  'Every post logged, with real error details',
];

function LoginFormInner() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const params = useSearchParams();

  // Where the visitor was heading before the gate stopped them. Sending them
  // on afterwards is the difference between signing in and being interrupted.
  const next = params.get('next') || '/admin';

  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      let redirectTo = '/admin';
      try {
        const url = new URL(next, window.location.origin);
        if (url.origin === window.location.origin && url.protocol === window.location.protocol) redirectTo = url.href;
      } catch { /* Use the dashboard for an invalid return URL. */ }
      const result = await signIn('credentials', {
        email: form.email, password: form.password, redirect: false, redirectTo,
      });
      if (result?.error === 'CredentialsSignin') {
        setError('Incorrect email or password.');
      } else if (!result?.ok || result.error || !result.url) {
        throw new Error('Sign-in unavailable');
      } else {
        window.location.assign(redirectTo);
      }
    } catch {
      setError('Could not reach the account service. Please try again shortly.');
    } finally {
      setBusy(false);
    }
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
          <h1>Postly admin preview</h1>
          <p className="auth-sub">Sign in to view the separate preview database.</p>

          {error && <div className="notice err"><strong>!</strong><span>{error}</span></div>}

          <form className="form" onSubmit={submit}>


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
                     placeholder="••••••••"
                     autoComplete="current-password" />
            </div>

            <button className="btn btn-accent btn-lg btn-block" disabled={busy}>
              {busy ? <span className="spinner" /> : 'Sign in'}
            </button>
          </form>


        </div>
      </section>
    </div>
  );
}

// useSearchParams opts this subtree into client rendering; the boundary keeps
// the route itself static instead of failing the build.
export default function LoginForm() {
  return (
    <Suspense fallback={<div className="auth-shell" />}>
      <LoginFormInner />
    </Suspense>
  );
}
