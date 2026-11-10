// Read-only check of the connected account and the provider's latest outcomes.
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const { query, getPool } = await import('../lib/db.js');
const { secretForCredential } = await import('../lib/credentials.js');
const { withUserKeys, keyFor } = await import('../lib/keycontext.js');
const platform = process.argv[2] || 'instagram';
try {
  const { rows: connections } = await query(`SELECT id,user_id,platform,provider,account_id,account_name,credential_id,extra
    FROM social_connections WHERE platform=$1 AND status='connected'`, [platform]);
  for (const conn of connections) {
    if (conn.provider !== 'zernio') { console.log('This audit currently supports Zernio connections.'); continue; }
    const secret = await secretForCredential(conn.credential_id, 'zernio', conn.user_id);
    await withUserKeys(conn.user_id, async () => {
      const key = await keyFor('zernio');
      if (!key) throw new Error('The publishing credential could not be loaded.');
      const read = async (path) => {
        const res = await fetch(`https://api.zernio.com/v1${path}`, {
          headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(`Provider returned HTTP ${res.status}`);
        return res.json();
      };
      const json = await read('/accounts');
      const accounts = json.accounts || json.data || (Array.isArray(json) ? json : []);
      const accountId = String(conn.extra?.zernio_account_id || conn.account_id);
      const account = accounts.find((a) => String(a._id || a.id) === accountId);
      console.log('Connected account:', {
        platform: conn.platform, storedName: conn.account_name,
        foundAtProvider: Boolean(account), username: account?.username,
        displayName: account?.displayName, active: account?.isActive,
        status: account?.status, needsReconnect: account?.needsReconnect,
      });
      const { rows: posts } = await query(`SELECT id,published_post_id,platform_post_url FROM queued_posts
        WHERE user_id=$1 AND platform=$2 AND published_post_id IS NOT NULL ORDER BY id DESC LIMIT 3`, [conn.user_id, platform]);
      for (const post of posts) {
        const result = await read(`/posts/${encodeURIComponent(post.published_post_id)}`);
        const p = result.post || result;
        const target = p.platforms?.find((t) => t.platform === platform);
        console.log('Recent delivery:', { localId: post.id, providerStatus: p.status,
          targetStatus: target?.status, targetAccountMatches: String(target?.accountId?._id || target?.accountId || '') === accountId,
          url: target?.platformPostUrl || post.platform_post_url,
          error: target?.error || target?.errorMessage || null,
          publishedAt: target?.publishedAt || p.publishedAt || null,
        });
      }
    }, secret ? { zernio: secret } : {});
  }
  if (!connections.length) { console.log('No connected account for', platform); process.exitCode = 1; }
} catch (e) { console.error('Delivery audit:', e.message); process.exitCode = 1; }
finally { await getPool().end(); }
