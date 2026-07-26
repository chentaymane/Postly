import './globals.css';
import { auth, signOut } from '../lib/auth';

export const metadata = {
  title: 'Postly — AI Social Publishing',
  description: 'Generate and publish AI marketing content to all your social platforms.',
};

export default async function RootLayout({ children }) {
  const session = await auth();
  const user = session?.user;

  async function doSignOut() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a className="brand" href="/">
            <span className="brand-mark">◆</span> Postly
          </a>
          {user ? (
            <nav className="topnav">
              <a href="/">Connections</a>
              <a href="/create">Create Post</a>
              <a href="/history">History</a>
              <span className="topnav-user">{user.email}</span>
              <form action={doSignOut} style={{ display: 'inline' }}>
                <button className="link-btn" type="submit">Sign out</button>
              </form>
            </nav>
          ) : (
            <nav className="topnav">
              <a href="/login">Sign in</a>
            </nav>
          )}
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
