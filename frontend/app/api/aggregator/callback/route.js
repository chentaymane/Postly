import { NextResponse } from 'next/server';
import { appBaseUrl } from '../../../../lib/platforms';
import { currentUserId } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import { getAccount, listPinterestBoards } from '../../../../lib/socialapi';

export const runtime = 'nodejs';

// SocialAPI.ai redirects here after the user authorizes (or denies) on the
// platform: ?status=success&platform=...&state=...&account_id=acc_...
export async function GET(request) {
  const base = appBaseUrl();
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const stateParam = url.searchParams.get('state') || '';
  const accountId = url.searchParams.get('account_id');

  const fail = (msg) => NextResponse.redirect(`${base}/?error=${encodeURIComponent(msg.slice(0, 300))}`);

  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(`${base}/login`);

  // state carries "<random>:<postlyPlatformKey>"
  const [state, platformKey = ''] = stateParam.split(':');
  const cookieState = request.cookies.get('postly_agg_state')?.value;
  if (!state || !cookieState || state !== cookieState) {
    return fail('invalid or expired connect state');
  }

  if (status !== 'success') {
    const desc = url.searchParams.get('error_description') || url.searchParams.get('error') || 'connection cancelled';
    return fail(`${platformKey || 'connect'}: ${desc}`);
  }
  if (!accountId) return fail('aggregator did not return an account id');

  // Enrich with account details (username etc.) — best effort.
  let accountName = null;
  try {
    const detail = await getAccount(accountId);
    const acc = detail.account || detail;
    accountName = acc.username || acc.name || acc.display_name || null;
  } catch { /* non-fatal */ }

  // Pinterest: fetch boards so the dashboard board picker works.
  const extra = { via: 'socialapi', socialapi_account_id: accountId };
  if (platformKey === 'pinterest') {
    try {
      const b = await listPinterestBoards(accountId);
      const items = b.boards || b.items || b.data || [];
      const boards = items.map((x) => ({ id: String(x.id), name: x.name }));
      extra.boards = boards;
      extra.board_id = boards[0]?.id || null;
      extra.board_name = boards[0]?.name || null;
    } catch { /* board list is a nicety; connection still succeeds */ }
  }

  await query(
    `INSERT INTO social_connections
       (user_id, platform, account_name, account_id, access_token, provider, scopes, extra, status, updated_at)
     VALUES ($1,$2,$3,$4,NULL,'socialapi',NULL,$5::jsonb,'connected',now())
     ON CONFLICT (user_id, platform, account_id) DO UPDATE SET
       account_name = EXCLUDED.account_name,
       provider = 'socialapi',
       extra = EXCLUDED.extra,
       status = 'connected',
       updated_at = now()`,
    [userId, platformKey, accountName, accountId, JSON.stringify(extra)]
  );

  const res = NextResponse.redirect(
    `${base}/?connected=${encodeURIComponent(platformKey || 'account')}`
  );
  res.cookies.set('postly_agg_state', '', { maxAge: 0, path: '/' });
  return res;
}
