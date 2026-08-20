import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

// Self-hosted by next/font: no request to Google at runtime, and the metrics
// are known up front so switching from the fallback causes no layout shift.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata = {
  title: 'Postly — AI Social Publishing',
  description:
    'Generate marketing copy and images with AI, then publish to all your social platforms in one click.',
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBFBF7' },
    { media: '(prefers-color-scheme: dark)', color: '#0F1108' },
  ],
};

// Applies the saved theme before first paint. Without this the page renders in
// the system theme and then corrects itself, which is a visible white flash for
// anyone who chose dark on a light-mode machine.
const THEME_BOOTSTRAP = `
try {
  var t = localStorage.getItem('postly-theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch (e) {}
`;

// Root layout only owns the document shell. The chrome (sidebar/footer) lives
// in the (app) group so full-bleed pages like sign-in can opt out of it.
export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        {children}
        {/* Vercel Web Analytics: page views and visitor counts, no cookies and
            no cross-site identifiers. It compiles to nothing outside Vercel, so
            a self-hosted fork carries no tracking it did not ask for. */}
        <Analytics />
      </body>
    </html>
  );
}
