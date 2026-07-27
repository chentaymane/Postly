import { NextResponse } from 'next/server';
import { appBaseUrl } from '../../../../lib/platforms';
import { currentUserId } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import { listPinterestBoards } from '../../../../lib/zernio';

export const runtime = 'nodejs';

// Zernio appends its result params to our redirect_url:
//   success: ?postly_state=..&postly_platform=..&connected=pinterest
//            &profileId=..&accountId=..&username=..
//   failure: ?postly_state=..&error=...
export async function GET(request) {
  const base = appBaseUrl();
  const url = new URL(request.url);
  const fail = (msg) => NextResponse.redirect(`${base}/?error=${encodeURIComponent(msg.slice(0, 300))}`);

  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(`${base}/login`);

  // CSRF: our own state round-trips through the redirect_url query.
  const state = url.searchParams.get('postly_state');
  const cookieState = request.cookies.get('postly_zernio_state')?.value;
  if (!state || !cookieState || state !== cookieState) {
    return fail('invalid or expired connect state');
  }

  const platformKey = url.searchParams.get('postly_platform') || url.searchParams.get('connected') || 'pinterest';
  const oauthError = url.searchParams.get('error') || url.searchParams.get('error_description');
  if (oauthError) return fail(`${platformKey}: ${oauthError}`);

  // Zernio's redirect params vary from their docs (board-selection flow can
  // omit accountId entirely) — accept known aliases, then fall back to asking
  // their API for the newest account on this platform.
  let accountId =
    url.searchParams.get('accountId') ||
    url.searchParams.get('account_id') ||
    url.searchParams.get('accountID') ||
    url.searchParams.get('id');
  let username = url.searchParams.get('username');
  let profileId = url.searchParams.get('profileId') || url.searchParams.get('profile_id');

  if (!accountId) {
    try {
      const { listAccounts } = await import('../../../../lib/zernio');
      const accounts = await listAccounts();
      const candidates = accounts
        .filter((a) => a.platform === platformKey)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const newest = candidates[0];
      if (newest) {
        accountId = newest._id || newest.id;
        username = username || newest.displayName || newest.metadata?.userProfile?.username || null;
        profileId = profileId || newest.profileId?._id || newest.profileId || null;
      }
    } catch { /* fall through to the error below */ }
  }
  if (!accountId) return fail('Zernio did not return an account id');

  // Pinterest: fetch boards so the board picker works.
  const extra = { via: 'zernio', zernio_account_id: accountId, zernio_profile_id: profileId };
  if (platformKey === 'pinterest') {
    try {
      const boards = await listPinterestBoards(accountId);
      extra.boards = boards;
      extra.board_id = boards[0]?.id || null;
      extra.board_name = boards[0]?.name || null;
    } catch { /* board list is a nicety; connection still succeeds */ }
  }

  await query(
    `INSERT INTO social_connections
       (user_id, platform, account_name, account_id, access_token, provider, scopes, extra, status, updated_at)
     VALUES ($1,$2,$3,$4,NULL,'zernio',NULL,$5::jsonb,'connected',now())
     ON CONFLICT (user_id, platform, account_id) DO UPDATE SET
       account_name = EXCLUDED.account_name,
       provider = 'zernio',
       extra = EXCLUDED.extra,
       status = 'connected',
       updated_at = now()`,
    [userId, platformKey, username, accountId, JSON.stringify(extra)]
  );

  const res = NextResponse.redirect(`${base}/?connected=${encodeURIComponent(platformKey)}`);
  res.cookies.set('postly_zernio_state', '', { maxAge: 0, path: '/' });
  return res;
}
