import { handlers } from '../../../../lib/auth';

// pg is not edge-compatible, and authorize() queries Postgres.
export const runtime = 'nodejs';

export const { GET, POST } = handlers;
