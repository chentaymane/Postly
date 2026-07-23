import './globals.css';

export const metadata = {
  title: 'Postly — AI Social Publishing',
  description: 'Generate and publish AI marketing content to all your social platforms.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a className="brand" href="/">
            <span className="brand-mark">◆</span> Postly
          </a>
          <nav className="topnav">
            <a href="/">Connections</a>
            <a href="/create">Create Post</a>
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
