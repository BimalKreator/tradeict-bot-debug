import { NextResponse } from 'next/server';
import { db } from '@/lib/db/sqlite';

export const dynamic = 'force-dynamic';

/**
 * POST: Mark all notifications as read.
 */
export async function POST() {
  try {
    db.db.prepare('UPDATE notifications SET is_read = 1').run();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API /api/notifications/mark-read] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to mark as read' },
      { status: 500 }
    );
  }
}
