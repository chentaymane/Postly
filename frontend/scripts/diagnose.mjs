// Read-only operational audit. Never prints secrets or publishes content.
import nextEnv from '@next/env';
import pg from 'pg';
import { correctedScheduledAt } from '../lib/schedule.js';
nextEnv.loadEnvConfig(process.cwd());

const checks = {};
for (const name of ['DATABASE_URL', 'AUTH_SECRET', 'CRON_SECRET', 'APP_BASE_URL',
  'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY',
  'POSTLY_POLLINATIONS_KEY', 'RENDER_WORKER_TOKEN']) {
  const userKey = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY'].includes(name);
  checks[name] = process.env[name] ? 'configured' : userKey ? 'not set (may use per-user keys)' : 'not set';
}
console.log('Configuration (presence only):', checks);
let failed = false;
if (process.env.APP_BASE_URL) {
  try {
    const url = new URL('/login', process.env.APP_BASE_URL);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid URL');
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    console.log('App login:', response.status);
    if (!response.ok) failed = true;
  } catch { console.error('App login: unreachable; check APP_BASE_URL and hosting.'); failed = true; }
}
if (!process.env.DATABASE_URL) {
  console.error('Database: DATABASE_URL is missing.');
  process.exitCode = 1;
} else {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
    max: 1, connectionTimeoutMillis: 10000, query_timeout: 10000 });
  try {
    const heartbeat = await pool.query("SELECT key, updated_at, value->>'source' AS source FROM system_state WHERE key IN ('scheduler','scheduler:app') ORDER BY key");
    console.log('Scheduler heartbeat:'); console.table(heartbeat.rows);
    const queue = await pool.query(`SELECT platform, status, count(*)::int AS posts,
      count(*) FILTER (WHERE status = 'scheduled' AND scheduled_at < now())::int AS overdue
      FROM queued_posts GROUP BY platform,status ORDER BY platform,status`);
    console.log('Queue:'); console.table(queue.rows);
    const recent = await pool.query(`SELECT platform, max(updated_at) AS last_confirmed,
      count(*)::int AS confirmed FROM queued_posts WHERE remote_status = 'published' GROUP BY platform`);
    console.log('Platform confirmations:'); console.table(recent.rows);
    const autos = await pool.query(`SELECT id,enabled,format,platforms,times,timezone,last_run_status,last_run_at
      FROM automations ORDER BY id`);
    console.log('Automations:'); console.table(autos.rows);
    const slots = await pool.query(`SELECT q.id,q.platform,q.slot_key,q.scheduled_at,a.times,a.timezone
      FROM queued_posts q JOIN automations a ON a.id=q.automation_id AND a.user_id=q.user_id
      WHERE q.status='scheduled' AND q.delivery='postly' AND q.published_post_id IS NULL
        AND q.scheduled_at>now() AND a.enabled ORDER BY q.scheduled_at LIMIT 400`);
    const mismatches = slots.rows.map((post) => ({ id: post.id, platform: post.platform,
      scheduled: post.scheduled_at, expected: correctedScheduledAt(post, post), timezone: post.timezone }))
      .filter((post) => post.expected);
    if (mismatches.length) {
      console.log('Times differing from automation slots (review before changing; custom schedules may be intentional):');
      console.table(mismatches);
    }
  } catch (e) {
    console.error('Database audit failed:', e.code || 'connection/query error', '(check connectivity and run db:setup if the schema is missing).');
    failed = true;
  } finally { await pool.end(); }
  if (failed) process.exitCode = 1;
}
