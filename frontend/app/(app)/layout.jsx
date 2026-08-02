import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth, signOut } from '../../lib/auth';
import { query } from '../../lib/db';
import { PostlyLogo } from '../../components/BrandIcons';
import NavLinks from '../../components/NavLinks';

// Chrome for the signed-in application pages.
export default async function AppLayout({ children }) {
  const session = await auth();
  const user = session?.user;

  // A brand new account has no keys, so nothing in the app can work yet —
  // send them to the wizard instead of a row of dead buttons. Checked here so
  // it covers every page at once.
  if (user?.id) {
    const path = headers().get('x-invoke-path') || headers().get('x-pathname') || '';
    if (!path.startsWith('/welcome')) {
      const { rows } = await query(
        'SELECT count(*)::int AS n FROM user_credentials WHERE user_id = $1',
        [Number(user.id)]
      );
      const hasEnvFallback = Boolean(process.env.GROQ_API_KEY);
      if (rows[0]?.n === 0 && !hasEnvFallback) redirect('/welcome');
    }
  }
  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();

  async function doSignOut() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <>
      <header className="topbar">
        <a href={user ? '/' : '/login'} aria-label="Postly home">
          <PostlyLogo />
        </a>

        {user ? (
          <nav className="topnav">
            <NavLinks />
            <div className="user-chip">
              <span className="avatar" aria-hidden="true">{initial}</span>
              <span className="user-email">{user.email}</span>
              <form action={doSignOut}>
                <button className="link-btn" type="submit">Sign out</button>
              </form>
            </div>
          </nav>
        ) : (
          <nav className="topnav">
            <a className="navlink" href="/login">Sign in</a>
          </nav>
        )}
      </header>

      <main className="container">{children}</main>

      <footer className="footer">
        <span>© {new Date().getFullYear()} Postly</span>
        <span className="footer-sep">·</span>
        <a href="/privacy">Privacy Policy</a>
        <span className="footer-sep">·</span>
        <a href="/terms">Terms of Service</a>
      </footer>
    </>
  );
}
