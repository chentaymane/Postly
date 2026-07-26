import { NextResponse } from 'next/server';
import { PLATFORMS, redirectUri, appBaseUrl } from '../../../../../lib/platforms';
import { query } from '../../../../../lib/db';

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  const key = params.platform;
  const base = appBaseUrl();
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
    } else {
      return fail(`${key} connect not implemented yet`);
    }

    await upsertConnection(conn);
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

async function upsertConnection(c) {
  await query(
    `INSERT INTO social_connections
       (platform, account_name, account_id, access_token, refresh_token, token_expires_at, scopes, extra, status, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'connected',now())
     ON CONFLICT (platform, account_id) DO UPDATE SET
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
    ]
  );
}
