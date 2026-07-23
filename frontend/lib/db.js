import { Pool } from 'pg';

// Reuse a single pool across hot-reloads in dev.
let pool = global.__postlyPool;
if (!pool) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  global.__postlyPool = pool;
}

export function getPool() {
  return pool;
}

export async function query(text, params) {
  return pool.query(text, params);
}
