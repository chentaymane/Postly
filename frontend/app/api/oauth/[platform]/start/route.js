import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { PLATFORMS, redirectUri, appBaseUrl } from '../../../../../lib/platforms';
import { currentUserId } from '../../../../../lib/auth';

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  const key = params.platform;
  const p = PLATFORMS[key];
  const base = appBaseUrl();

  // Connections belong to a user, so require a session before starting OAuth.
  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(`${base}/login`);

  if (!p || !p.enabled) {
    return NextResponse.redirect(`${base}/?error=${encodeURIComponent('platform not available')}`);
  }
  const clientId = process.env[p.clientIdEnv];
  if (!clientId) {
    return NextResponse.redirect(`${base}/?error=${encodeURIComponent(key + ' app not configured')}`);
  }

  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = new URL(p.authorizeUrl);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri(key));
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', p.scopes.join(p.scopeSeparator || ' '));
  authUrl.searchParams.set('state', state);

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set(`postly_oauth_state_${key}`, state, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return res;
}
