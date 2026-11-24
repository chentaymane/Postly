// `pg` is CommonJS — default import keeps this loadable by both the Next
// bundler and plain `node` scripts.
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { Pool } = pg;

// Reuse a single pool across hot-reloads (dev) and warm lambdas (Vercel).
let pool = global.__postlyPool;
if (!pool) {
  const connectionString = process.env.POSTLY_PREVIEW_DATABASE_URL;
  if (connectionString && new URL(connectionString).hostname !== 'aws-0-us-east-2.pooler.supabase.com') {
    throw new Error('Unexpected preview database host.');
  }
  pool = new Pool({
    connectionString,
    ssl: { ca: readFileSync(join(process.cwd(), 'lib', 'supabase-root.crt'), 'utf8') },
    max: 3, // serverless: keep the pool small
    // Neon drops connections when its compute suspends, and a warm lambda
    // can sit on a pooled connection for longer than that. Letting idle ones
    // go quickly means a request rarely picks up a socket that is already
    // dead; keep-alive notices the ones that die while in use.
    idleTimeoutMillis: 10000,
    keepAlive: true,
  });
  // A connection that dies while idle in the pool emits 'error' on the pool.
  // Unhandled, that event takes the whole process down with it — one Neon
  // suspend would crash the function serving an unrelated request.
  pool.on('error', () => {});
  global.__postlyPool = pool;
}

export function getPool() {
  return pool;
}

// The socket was already gone when the query went out: the statement never
// reached the database, so sending it once more on a fresh connection is safe.
const DEAD_CONNECTION = /Connection terminated unexpectedly|Client has encountered a connection error|ECONNRESET|EPIPE/i;

export async function query(text, params) {
  if (!process.env.POSTLY_PREVIEW_DATABASE_URL) throw new Error('Preview database is not configured.');
  try {
    return await pool.query(text, params);
  } catch (e) {
    if (!DEAD_CONNECTION.test(String(e?.message || e?.code || ''))) throw e;
    return pool.query(text, params);
  }
}
