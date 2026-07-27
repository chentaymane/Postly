import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { appBaseUrl } from '../../../../../lib/platforms';
import { currentUserId } from '../../../../../lib/auth';
import {
  socialApiEnabled,
  SOCIALAPI_PLATFORMS,
  toSocialApiPlatform,
  createConnectLink,
} from '../../../../../lib/socialapi';

export const runtime = 'nodejs';

// Starts a one-click connect through SocialAPI.ai: asks the aggregator for an
// auth_url and sends the user there. SocialAPI handles the platform OAuth and
// redirects back to /api/aggregator/callback.
export async function GET(request, { params }) {
  const key = params.platform;
  const base = appBaseUrl();

  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(`${base}/login`);

  if (!socialApiEnabled() || !SOCIALAPI_PLATFORMS.has(key)) {
    return NextResponse.redirect(
      `${base}/?error=${encodeURIComponent(`${key} is not available via the aggregator`)}`
    );
  }

  const state = crypto.randomBytes(16).toString('hex');

  try {
    const { auth_url } = await createConnectLink({
      platform: toSocialApiPlatform(key),
      redirectUri: `${base}/api/aggregator/callback`,
      state: `${state}:${key}`,
    });
    if (!auth_url) throw new Error('aggregator returned no auth_url');

    const res = NextResponse.redirect(auth_url);
    res.cookies.set('postly_agg_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });
    return res;
  } catch (e) {
    return NextResponse.redirect(
      `${base}/?error=${encodeURIComponent(`${key}: ${e.message}`.slice(0, 300))}`
    );
  }
}
