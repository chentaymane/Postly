import { NextResponse } from 'next/server';

// Route gating at the edge.
//
// Before this, every app page rendered its shell to a signed-out visitor and
// only discovered the problem when its data fetch came back 401 — so the first
// thing a stranger saw was a broken dashboard rather than the product. The
// pages themselves still check, and every API route still checks: this is the
// outer gate, not the only one.
//
// The session cookie is only *presence*-checked here. Verifying the JWT needs
// the crypto that the edge runtime and Auth.js disagree about, and a forged
// cookie gains nothing — `auth()` runs again in the page and in every API
// route, where the signature is actually verified.

const PUBLIC_PATHS = new Set(['/', '/login', '/privacy', '/terms']);

// Marketing and auth pages a signed-in user should not linger on.
const REDIRECT_WHEN_SIGNED_IN = new Set(['/', '/login']);

const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  // Older Auth.js/NextAuth naming, so an existing session survives an upgrade.
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

function hasSession(request) {
  return SESSION_COOKIES.some((name) => request.cookies.get(name));
}

export function middleware(request) {
  const { pathname, search } = request.nextUrl;
  const signedIn = hasSession(request);

  if (REDIRECT_WHEN_SIGNED_IN.has(pathname) && signedIn) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (PUBLIC_PATHS.has(pathname) || signedIn) return NextResponse.next();

  // Remember where they were headed, so signing in finishes the journey rather
  // than dumping everyone on the dashboard.
  const login = new URL('/login', request.url);
  login.searchParams.set('next', pathname + (search || ''));
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // Everything except Next's own assets, the auth endpoints, the render and
    // cron endpoints (which authenticate with their own tokens, not a session),
    // and the click tracker (which must work for people who are not users).
    '/((?!api/auth|api/cron|api/render|api/scheduler|r/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|mp4|woff2?)$).*)',
  ],
};
