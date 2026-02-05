import { NextResponse } from 'next/server';
import { db } from '@/lib/db/sqlite';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export interface NotificationRow {
  id: number;
  type: string;
  message: string;
  created_at: string;
  is_read: number;
}

/**
 * GET: Fetch last 50 notifications, newest first.
 */
export async function GET() {
  try {
    const rows = db.db
      .prepare(
        `SELECT id, type, message, created_at, is_read
           FROM notifications
          ORDER BY created_at DESC
          LIMIT 50`
      )
      .all() as NotificationRow[];

    return NextResponse.json(rows);
  } catch (err) {
    console.error('[API /api/notifications] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}
