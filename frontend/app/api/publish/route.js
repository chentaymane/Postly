import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { query } from '../../../lib/db';
import { runForPlatform } from '../../../lib/pipeline';
import { PLATFORMS } from '../../../lib/platforms';
import { currentUserId } from '../../../lib/auth';

export const runtime = 'nodejs';
// Image generation can take ~30s; allow headroom (Vercel Hobby caps at 60s).
export const maxDuration = 60;

export async function POST(request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const theme = String(body.theme || '').trim();
  const platforms = Array.isArray(body.platforms) ? body.platforms : [];

  if (!theme) {
    return NextResponse.json({ error: 'theme is required' }, { status: 400 });
  }
  if (platforms.length === 0) {
    return NextResponse.json({ error: 'select at least one platform' }, { status: 400 });
  }

  const input = {
    theme,
    productName: String(body.productName || '').trim(),
    description: String(body.description || '').trim(),
    tone: String(body.tone || 'friendly and engaging').trim(),
    destinationUrl: String(body.destinationUrl || '').trim(),
  };

  const runId = crypto.randomUUID();

  // Load the stored connection for each requested platform.
  const { rows } = await query(
    `SELECT DISTINCT ON (platform)
            id, platform, account_name, account_id, access_token, provider, extra
       FROM social_connections
      WHERE status = 'connected' AND user_id = $2 AND platform = ANY($1::text[])
      ORDER BY platform, updated_at DESC`,
    [platforms, userId]
  );
  const byPlatform = Object.fromEntries(rows.map((r) => [r.platform, r]));

  // Run platforms in parallel — each has its own image/copy and logs its own row.
  const results = await Promise.all(
    platforms.map(async (platform) => {
      if (!PLATFORMS[platform]) {
        return { platform, ok: false, error: 'unknown platform' };
      }
      const conn = byPlatform[platform];
      if (!conn) {
        return { platform, ok: false, error: 'account not connected' };
      }
      try {
        return await runForPlatform({ runId, userId, platform, conn, input });
      } catch (e) {
        return { platform, ok: false, error: e.message };
      }
    })
  );

  return NextResponse.json({ run_id: runId, results });
}
