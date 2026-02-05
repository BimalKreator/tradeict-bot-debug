import { db } from './sqlite';

export type NotificationType = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

/**
 * Adds a notification to the persistent store.
 */
export function addNotification(type: NotificationType, message: string): void {
  try {
    const createdAt = new Date().toISOString();
    db.db
      .prepare(
        'INSERT INTO notifications (type, message, created_at, is_read) VALUES (?, ?, ?, 0)'
      )
      .run(type, message, createdAt);
  } catch (err) {
    console.error('[DB] addNotification failed:', err);
  }
}
