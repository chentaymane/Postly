import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { appBaseUrl } from '../../../../../lib/platforms';
import { currentUserId } from '../../../../../lib/auth';
import {
  zernioEnabled,
  ZERNIO_PLATFORMS,
  ensureProfile,
  createConnectLink,
} from '../../../../../lib/zernio';

export const runtime = 'nodejs';

// One-click connect through Zernio (used for Pinterest). Zernio hosts the
// platform OAuth and redirects back to /api/zernio/callback with the result.
export async function GET(request, { params }) {
  const key = params.platform;
  const base = appBaseUrl();

  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(`${base}/login`);

  if (!zernioEnabled() || !ZERNIO_PLATFORMS.has(key)) {
    return NextResponse.redirect(
      `${base}/?error=${encodeURIComponent(`${key} is not available via Zernio`)}`
    );
  }

  try {
    const profileId = await ensureProfile();
    const state = crypto.randomBytes(16).toString('hex');
    const { authUrl } = await createConnectLink({
      platform: key,
      profileId,
      redirectUrl: `${base}/api/zernio/callback?postly_state=${state}&postly_platform=${key}`,
    });

    const res = NextResponse.redirect(authUrl);
    res.cookies.set('postly_zernio_state', state, {
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
