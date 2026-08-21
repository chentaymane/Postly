import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';
import { isAdminUser } from '../../../../../lib/admin';

export const runtime = 'nodejs';

// Deletes a user and, by cascade, everything they own: connections, API keys,
// automations, posts and click history.
//
// This is irreversible and there is no soft-delete to fall back on, so it
// refuses more than it accepts: an operator cannot delete themselves (that
// would lock the instance out of its own admin page), and cannot delete
// another admin without first removing them from ADMIN_EMAILS — which needs
// deployment access, not a click.
export async function DELETE(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  if (!(await isAdminUser(userId))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const targetId = Number(params.id);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ error: 'invalid user id' }, { status: 400 });
  }
  if (targetId === userId) {
    return NextResponse.json(
      { error: 'you cannot delete your own account from here' },
      { status: 400 }
    );
  }
  if (await isAdminUser(targetId)) {
    return NextResponse.json(
      { error: 'that account is an admin — remove it from ADMIN_EMAILS first' },
      { status: 400 }
    );
  }

  // Report what is about to be destroyed, so the confirmation in the UI can be
  // specific and the response can say what actually went.
  const { rows: before } = await query(
    `SELECT u.email,
            (SELECT count(*)::int FROM queued_posts q WHERE q.user_id = u.id) AS posts,
            (SELECT count(*)::int FROM social_connections s WHERE s.user_id = u.id) AS connections
       FROM users u WHERE u.id = $1`,
    [targetId]
  );
  if (before.length === 0) return NextResponse.json({ error: 'user not found' }, { status: 404 });

  await query('DELETE FROM users WHERE id = $1', [targetId]);

  return NextResponse.json({
    ok: true,
    deleted: { id: targetId, ...before[0] },
  });
}
