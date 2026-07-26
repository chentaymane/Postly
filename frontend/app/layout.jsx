import './globals.css';

export const metadata = {
  title: 'Postly — AI Social Publishing',
  description:
    'Generate marketing copy and images with AI, then publish to all your social platforms in one click.',
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF6F6' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1030' },
  ],
};

// Root layout only owns the document shell. The chrome (header/footer) lives in
// the (app) group so full-bleed pages like sign-in can opt out of it.
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
