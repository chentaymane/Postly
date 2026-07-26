// Applies lib/schema.sql to DATABASE_URL. Idempotent.
//   npm run db:setup

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));

// Load .env.local without adding a dependency.
try {
  const env = readFileSync(join(here, '..', '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env.local — rely on real env */ }

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (put it in frontend/.env.local)');
  process.exit(1);
}

const sql = readFileSync(join(here, '..', 'lib', 'schema.sql'), 'utf8');
const needsSsl = !/localhost|127\.0\.0\.1/.test(url);

const client = new pg.Client({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

try {
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`
  );
  console.log('Schema applied. Tables:', rows.map((r) => r.table_name).join(', '));
} catch (e) {
  console.error('Schema setup failed:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
