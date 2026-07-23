import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';

export const runtime = 'nodejs';

// Maps a platform key to its n8n webhook path.
const WEBHOOK_PATH = {
  pinterest: 'postly-pinterest',
  facebook: 'postly-generate',
};

export async function POST(request) {
  const body = await request.json();
  const base = process.env.N8N_WEBHOOK_BASE || 'http://localhost:5678/webhook';
  const platforms = Array.isArray(body.platforms) ? body.platforms : [];

  if (!body.theme || platforms.length === 0) {
    return NextResponse.json({ error: 'theme and at least one platform are required' }, { status: 400 });
  }

  const results = [];

  for (const key of platforms) {
    const path = WEBHOOK_PATH[key];
    if (!path) {
      results.push({ platform: key, ok: false, error: 'no workflow wired for this platform yet' });
      continue;
    }

    // Pull the stored token for this platform (most recently connected).
    const { rows } = await query(
      `SELECT access_token, extra->>'board_id' AS board_id
         FROM social_connections
        WHERE platform = $1 AND status = 'connected'
        ORDER BY updated_at DESC LIMIT 1`,
      [key]
    );
    if (rows.length === 0) {
      results.push({ platform: key, ok: false, error: 'account not connected' });
      continue;
    }

    const payload = {
      theme: body.theme,
      productName: body.productName || '',
      description: body.description || '',
      tone: body.tone || '',
      destinationUrl: body.destinationUrl || '',
      platforms: [key],
    };
    if (key === 'pinterest') {
      payload.pinterestAccessToken = rows[0].access_token;
      payload.pinterestBoardId = rows[0].board_id || '';
    }

    try {
      const res = await fetch(`${base}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
      const ok = res.ok && parsed.status !== 'fail';
      results.push({
        platform: key,
        ok,
        post_id: parsed.post_id || null,
        error: ok ? null : (parsed.error || parsed.raw || `HTTP ${res.status}`),
      });
    } catch (e) {
      results.push({ platform: key, ok: false, error: e.message });
    }
  }

  return NextResponse.json({ results });
}
