import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db/sqlite';

const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');

async function getLastBackupTimestamp(): Promise<string> {
  try {
    const files = await fs.readdir(BACKUP_DIR);
    if (files.length === 0) {
      return 'No backups found';
    }

    let latestTime = 0;

    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(BACKUP_DIR, file);
        try {
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs > latestTime) {
            latestTime = stats.mtimeMs;
          }
        } catch {
          // ignore stat errors for individual files
        }
      })
    );

    if (latestTime === 0) {
      return 'No backups found';
    }

    return new Date(latestTime).toISOString();
  } catch (err) {
    console.error('[API /api/health] Failed to inspect backups:', err);
    return 'Unknown';
  }
}

export async function GET() {
  try {
    const activeRow = db.db
      .prepare('SELECT COUNT(*) as count FROM active_trades WHERE status = \'ACTIVE\'')
      .get() as { count: number };

    const settings = db.db
      .prepare('SELECT auto_entry_enabled FROM bot_settings WHERE id = 1')
      .get() as { auto_entry_enabled: number } | undefined;

    const lastBackup = await getLastBackupTimestamp();

    return NextResponse.json({
      status: 'running',
      uptime: process.uptime(),
      active_trades_count: activeRow?.count ?? 0,
      auto_entry: settings ? settings.auto_entry_enabled === 1 : false,
      last_backup: lastBackup,
    });
  } catch (err) {
    console.error('[API /api/health] Error:', err);
    return NextResponse.json(
      {
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
