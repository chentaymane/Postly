import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { appBaseUrl } from '../../../../../lib/platforms';
import { currentUserId } from '../../../../../lib/auth';
import { credentialForNewConnection } from '../../../../../lib/credentials';
import { withUserKeys } from '../../../../../lib/keycontext';
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

  if (!ZERNIO_PLATFORMS.has(key)) {
    return NextResponse.redirect(
      `${base}/?error=${encodeURIComponent(`${key} is not available via Zernio`)}`
    );
  }

  // Free tiers cap accounts per key, so pick one that still has room. When all
  // of them are full the fix is to add another key, and saying so beats a
  // confusing provider error.
  const chosen = await credentialForNewConnection(userId, 'zernio');
  if (!chosen) {
    return NextResponse.redirect(`${base}/settings/keys?needs=zernio`);
  }
  if (chosen.full) {
    return NextResponse.redirect(
      `${base}/settings/keys?error=${encodeURIComponent(
        'All your Zernio keys are at their connected-account limit. Add another key to connect more accounts.'
      )}`
    );
  }

  try {
    return await withUserKeys(
      userId,
      async () => {
        const profileId = await ensureProfile();
        const state = crypto.randomBytes(16).toString('hex');
        const { authUrl } = await createConnectLink({
          platform: key,
          profileId,
          redirectUrl: `${base}/api/zernio/callback?postly_state=${state}&postly_platform=${key}`,
        });

        const res = NextResponse.redirect(authUrl);
        res.cookies.set('postly_zernio_state', state, {
          httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/',
        });
        // Remember which key opened this flow so the callback can bind the
        // resulting connection to it.
        res.cookies.set('postly_zernio_cred', String(chosen.credentialId ?? ''), {
          httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/',
        });
        return res;
      },
      { zernio: chosen.secret }
    );
  } catch (e) {
    return NextResponse.redirect(
      `${base}/?error=${encodeURIComponent(`${key}: ${e.message}`.slice(0, 300))}`
    );
  }
}
