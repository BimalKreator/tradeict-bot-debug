import { promises as fs } from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'trading_bot.db');
const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const RETENTION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

let backupTimer: NodeJS.Timeout | null = null;
let isRunning = false;

async function createBackup() {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
  } catch (err) {
    console.error('[BackupJob] Failed to ensure backup directory:', err);
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `backup_${timestamp}.db`);

  try {
    await fs.copyFile(DB_PATH, backupPath);
    console.log(`[BackupJob] Created backup: ${backupPath}`);
  } catch (err) {
    console.error('[BackupJob] Failed to copy database:', err);
    return;
  }

  await cleanupOldBackups();
}

async function cleanupOldBackups() {
  try {
    const files = await fs.readdir(BACKUP_DIR);
    const now = Date.now();

    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(BACKUP_DIR, file);
        try {
          const stats = await fs.stat(filePath);
          if (now - stats.mtimeMs > RETENTION_MS) {
            await fs.unlink(filePath);
            console.log(`[BackupJob] Removed old backup: ${filePath}`);
          }
        } catch (err) {
          console.error('[BackupJob] Failed to inspect backup file:', err);
        }
      })
    );
  } catch (err) {
    console.error('[BackupJob] Failed to cleanup backups:', err);
  }
}

export function startBackupJob() {
  if (backupTimer || isRunning) {
    return;
  }

  isRunning = true;

  const runBackup = () => {
    createBackup().catch((err) => {
      console.error('[BackupJob] Unexpected error:', err);
    });
  };

  // Kick off immediately on start
  runBackup();

  backupTimer = setInterval(runBackup, BACKUP_INTERVAL_MS);
}
