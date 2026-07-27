import { NextResponse } from 'next/server';
import { PLATFORMS, redirectUri, appBaseUrl } from '../../../../../lib/platforms';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  const key = params.platform;
  const base = appBaseUrl();

  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(`${base}/login`);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  const fail = (msg) => NextResponse.redirect(`${base}/?error=${encodeURIComponent(msg)}`);

  if (oauthError) return fail(`${key}: ${oauthError}`);
  const p = PLATFORMS[key];
  if (!p || !p.enabled) return fail('platform not available');

  // CSRF state check
  const cookieState = request.cookies.get(`postly_oauth_state_${key}`)?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return fail('invalid or expired OAuth state');
  }

  try {
    let conn;
    if (key === 'pinterest') {
      conn = await connectPinterest(p, code);
    } else if (p.kind === 'instagram_login') {
      conn = await connectInstagram(p, code);
    } else if (p.kind === 'meta') {
      conn = await connectMeta(p, code, key);
    } else {
      return fail(`${key} connect not implemented yet`);
    }

    await upsertConnection({ ...conn, user_id: userId });
    const res = NextResponse.redirect(`${base}/?connected=${encodeURIComponent(p.name)}`);
    res.cookies.set(`postly_oauth_state_${key}`, '', { maxAge: 0, path: '/' });
    return res;
  } catch (e) {
    return fail(`${key}: ${e.message}`.slice(0, 300));
  }
}

async function connectPinterest(p, code) {
  const clientId = process.env[p.clientIdEnv];
  const clientSecret = process.env[p.clientSecretEnv];
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const tokenRes = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri('pinterest'),
    }),
  });
  const token = await tokenRes.json();
  if (!tokenRes.ok || !token.access_token) {
    throw new Error(token.message || token.error || 'token exchange failed');
  }

  const bearer = { Authorization: `Bearer ${token.access_token}` };

  // Account info
  let username = null;
  try {
    const u = await fetch('https://api.pinterest.com/v5/user_account', { headers: bearer });
    const uj = await u.json();
    username = uj.username || null;
  } catch { /* non-fatal */ }

  // Boards (default to the first)
  let boards = [];
  try {
    const b = await fetch('https://api.pinterest.com/v5/boards?page_size=25', { headers: bearer });
    const bj = await b.json();
    boards = (bj.items || []).map((x) => ({ id: x.id, name: x.name }));
  } catch { /* non-fatal */ }

  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : null;

  return {
    platform: 'pinterest',
    account_name: username,
    account_id: username || 'pinterest_account',
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    token_expires_at: expiresAt,
    scopes: token.scope || p.scopes.join(','),
    extra: {
      boards,
      board_id: boards[0]?.id || null,
      board_name: boards[0]?.name || null,
    },
  };
}

// Instagram API with Instagram Login: the user authenticates with Instagram
// directly, so no Facebook Page is required. Publishing then goes through
// graph.instagram.com with the Instagram user token.
async function connectInstagram(p, code) {
  const clientId = process.env[p.clientIdEnv];
  const clientSecret = process.env[p.clientSecretEnv];

  // 1. code -> short-lived Instagram user token
  const tokenRes = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri('instagram'),
      code,
    }),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) {
    throw new Error(token?.error_message || token?.error?.message || 'token exchange failed');
  }

  // 2. upgrade to a long-lived (60-day) token
  let accessToken = token.access_token;
  let expiresAt = null;
  try {
    const llRes = await fetch(
      `https://graph.instagram.com/access_token?${new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: clientSecret,
        access_token: accessToken,
      })}`
    );
    const ll = await llRes.json();
    if (llRes.ok && ll.access_token) {
      accessToken = ll.access_token;
      if (ll.expires_in) {
        expiresAt = new Date(Date.now() + ll.expires_in * 1000).toISOString();
      }
    }
  } catch { /* keep the short-lived token rather than failing the connect */ }

  // 3. identify the account
  let username = null;
  let igUserId = token.user_id ? String(token.user_id) : null;
  try {
    const meRes = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=user_id,username&access_token=${encodeURIComponent(accessToken)}`
    );
    const me = await meRes.json();
    if (meRes.ok) {
      username = me.username || null;
      igUserId = me.user_id ? String(me.user_id) : igUserId;
    }
  } catch { /* non-fatal: fall back to the id from the token response */ }

  if (!igUserId) throw new Error('could not determine the Instagram account id');

  return {
    platform: 'instagram',
    account_name: username,
    account_id: igUserId,
    access_token: accessToken,
    refresh_token: null,
    token_expires_at: expiresAt,
    scopes: p.scopes.join(','),
    extra: { api: 'instagram_login', ig_user_id: igUserId, ig_username: username },
  };
}

// Facebook + Instagram. Exchanges the code for a user token, upgrades it to a
// long-lived one, then stores the Page token (Page tokens derived from a
// long-lived user token do not expire) plus any linked IG Business account.
async function connectMeta(p, code, key) {
  const clientId = process.env[p.clientIdEnv];
  const clientSecret = process.env[p.clientSecretEnv];
  const graph = 'https://graph.facebook.com/v21.0';

  // 1. code -> short-lived user token
  const tokenRes = await fetch(
    `${p.tokenUrl}?${new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(key),
      code,
    })}`
  );
  const token = await tokenRes.json();
  if (!tokenRes.ok || !token.access_token) {
    throw new Error(token?.error?.message || 'token exchange failed');
  }

  // 2. upgrade to a long-lived (~60 day) user token
  let userToken = token.access_token;
  try {
    const llRes = await fetch(
      `${graph}/oauth/access_token?${new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: clientId,
        client_secret: clientSecret,
        fb_exchange_token: userToken,
      })}`
    );
    const ll = await llRes.json();
    if (llRes.ok && ll.access_token) userToken = ll.access_token;
  } catch { /* keep the short-lived token rather than failing the connect */ }

  // 3. list Pages and any linked Instagram Business accounts
  const pagesRes = await fetch(
    `${graph}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(userToken)}`
  );
  const pagesJson = await pagesRes.json();
  if (!pagesRes.ok) {
    throw new Error(pagesJson?.error?.message || 'could not list Pages');
  }

  const pages = (pagesJson.data || []).map((pg) => ({
    id: pg.id,
    name: pg.name,
    access_token: pg.access_token,
    ig_user_id: pg.instagram_business_account?.id || null,
    ig_username: pg.instagram_business_account?.username || null,
  }));

  if (pages.length === 0) {
    throw new Error(
      'no Facebook Page found on this account. Create a Page (and for Instagram, link a Business/Creator account to it), then reconnect.'
    );
  }

  if (key === 'instagram') {
    const withIg = pages.find((pg) => pg.ig_user_id);
    if (!withIg) {
      throw new Error(
        'no Instagram Business account is linked to your Facebook Page. In Meta Business settings, convert your Instagram account to Business/Creator and link it to the Page, then reconnect.'
      );
    }
    return {
      platform: 'instagram',
      account_name: withIg.ig_username,
      account_id: withIg.ig_user_id,
      access_token: withIg.access_token, // Page token publishes on IG's behalf
      refresh_token: null,
      token_expires_at: null,
      scopes: p.scopes.join(','),
      extra: {
        ig_user_id: withIg.ig_user_id,
        ig_username: withIg.ig_username,
        page_id: withIg.id,
        page_name: withIg.name,
      },
    };
  }

  const page = pages[0];
  return {
    platform: 'facebook',
    account_name: page.name,
    account_id: page.id,
    access_token: page.access_token,
    refresh_token: null,
    token_expires_at: null,
    scopes: p.scopes.join(','),
    extra: {
      page_id: page.id,
      page_name: page.name,
      ig_user_id: page.ig_user_id,
      ig_username: page.ig_username,
      // Stored without tokens so the UI can offer a Page picker later.
      pages: pages.map(({ id, name }) => ({ id, name })),
    },
  };
}

async function upsertConnection(c) {
  await query(
    `INSERT INTO social_connections
       (user_id, platform, account_name, account_id, access_token, refresh_token, token_expires_at, scopes, extra, status, updated_at)
     VALUES ($9,$1,$2,$3,$4,$5,$6,$7,$8::jsonb,'connected',now())
     ON CONFLICT (user_id, platform, account_id) DO UPDATE SET
       account_name = EXCLUDED.account_name,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       scopes = EXCLUDED.scopes,
       extra = EXCLUDED.extra,
       status = 'connected',
       updated_at = now()`,
    [
      c.platform,
      c.account_name,
      c.account_id,
      c.access_token,
      c.refresh_token,
      c.token_expires_at,
      c.scopes,
      JSON.stringify(c.extra || {}),
      c.user_id,
    ]
  );
}
