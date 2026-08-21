import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth, signOut } from '../../lib/auth';
import { query } from '../../lib/db';
import { PostlyLogo } from '../../components/BrandIcons';
import { SidebarNav, DrawerNav } from '../../components/NavLinks';
import ThemeToggle from '../../components/ThemeToggle';
import SchedulerPulse from '../../components/SchedulerPulse';
import { isAdminUser } from '../../lib/admin';

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

  // Drafts waiting for approval are the one thing that needs chasing, so the
  // count rides on the nav rather than waiting to be discovered on the page.
  let badges = {};
  if (user?.id) {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM queued_posts
        WHERE user_id = $1 AND status IN ('draft','failed','unconfirmed')`,
      [Number(user.id)]
    );
    badges = { '/review': rows[0]?.n || 0 };
  }

  // Decided on the server; the link is a convenience, not the gate.
  const isAdmin = user?.id ? await isAdminUser(Number(user.id)) : false;

  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();

  async function doSignOut() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  if (!user) {
    return (
      <div className="content">
        <header className="topbar" style={{ display: 'flex' }}>
          <a href="/login" aria-label="Postly home"><PostlyLogo /></a>
          <div className="topbar-actions">
            <ThemeToggle />
            <a className="btn btn-outline btn-sm" href="/login">Sign in</a>
          </div>
        </header>
        <main className="container">{children}</main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <a href="/dashboard" aria-label="Postly home"><PostlyLogo /></a>
        </div>

        <nav aria-label="Main">
          <SidebarNav badges={badges} isAdmin={isAdmin} />
        </nav>

        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">{initial}</span>
            <span className="user-meta">
              <span className="user-email" title={user.email}>{user.email}</span>
              <form action={doSignOut}>
                <button className="link-btn" type="submit">Sign out</button>
              </form>
            </span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <a href="/dashboard" aria-label="Postly home"><PostlyLogo /></a>
          <div className="topbar-actions">
            <ThemeToggle />
            <form action={doSignOut}>
              <button className="btn btn-ghost btn-sm" type="submit">Sign out</button>
            </form>
            <DrawerNav badges={badges} isAdmin={isAdmin} />
          </div>
        </header>

        <main className="container">{children}</main>
        <SiteFooter />
      </div>

      {/* Keeps posts going out on time when the host throttles the cron. */}
      <SchedulerPulse />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="footer">
      <span>© {new Date().getFullYear()} Postly</span>
      <span className="footer-sep">·</span>
      <a href="/privacy">Privacy Policy</a>
      <span className="footer-sep">·</span>
      <a href="/terms">Terms of Service</a>
    </footer>
  );
}
