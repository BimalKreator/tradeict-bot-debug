import { db } from '@/lib/db/sqlite';

export interface CanEnterResult {
  allowed: boolean;
  reason?: string;
}

export function canEnterTrade(symbol: string): CanEnterResult {
  // 1. Fetch Settings
  // Note: Accessing the underlying better-sqlite3 instance via db.db based on previous patterns
  const settings = db.db
    .prepare('SELECT auto_entry_enabled FROM bot_settings WHERE id = 1')
    .get() as { auto_entry_enabled: number } | undefined;

  if (!settings || !settings.auto_entry_enabled) {
    return { allowed: false, reason: 'Auto Entry Disabled in Settings' };
  }

  // 2. Check Slot Availability (Max 3)
  const activeCount = db.db
    .prepare("SELECT COUNT(*) as count FROM active_trades WHERE status = 'ACTIVE'")
    .get() as { count: number };

  if (activeCount.count >= 3) {
    return { allowed: false, reason: 'All 3 Slots Occupied' };
  }

  // 3. Check for Duplicate Token (by symbol and base)
  const base = symbol.includes('/') ? symbol.split('/')[0] : symbol;
  const full = symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`;
  const rows = db.db
    .prepare("SELECT symbol FROM active_trades WHERE status = 'ACTIVE'")
    .all() as { symbol: string }[];
  const activeBases = new Set(rows.map((r) => r.symbol.split('/')[0].toUpperCase()));
  const activeFull = new Set(rows.map((r) => r.symbol.toUpperCase()));
  if (activeBases.has(base.toUpperCase()) || activeFull.has(full.toUpperCase())) {
    return { allowed: false, reason: 'Duplicate Token' };
  }

  return { allowed: true };
}
