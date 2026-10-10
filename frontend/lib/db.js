// `pg` is CommonJS — default import keeps this loadable by both the Next
// bundler and plain `node` scripts.
import pg from 'pg';

const { Pool } = pg;

// Reuse a single pool across hot-reloads (dev) and warm lambdas (Vercel).
let pool = global.__postlyPool;
if (!pool) {
  const connectionString = process.env.DATABASE_URL;
  // Managed Postgres (Neon/Supabase) requires TLS; local does not.
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString || '');
  pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
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
  try {
    return await pool.query(text, params);
  } catch (e) {
    if (!DEAD_CONNECTION.test(String(e?.message || e?.code || ''))) throw e;
    return pool.query(text, params);
  }
}
