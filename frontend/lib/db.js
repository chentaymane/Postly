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
  });
  global.__postlyPool = pool;
}

export function getPool() {
  return pool;
}

export async function query(text, params) {
  return pool.query(text, params);
}
