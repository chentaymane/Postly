import { NextResponse } from 'next/server';
import { currentUserId } from '../../../lib/auth';
import { buildSchedule } from '../../../lib/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Everything coming up, written or not, for the Schedule page.
export async function GET(request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const days = Math.min(14, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 7));
  return NextResponse.json(await buildSchedule(userId, { days }));
}
