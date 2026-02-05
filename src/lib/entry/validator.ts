import { db } from '@/lib/db/sqlite';

export interface CanEnterResult {
  allowed: boolean;
  reason?: string;
}

function normalizeSymbol(symbol: string): string {
  if (!symbol) return '';
  const s = symbol.trim().toUpperCase();
  if (s.includes('/')) return s.split('/')[0];
  return s.replace(/USDT:?USDT?$/i, '');
}

export function canEnterTrade(symbol: string): CanEnterResult {
  const settings = db.db
    .prepare('SELECT auto_entry_enabled FROM bot_settings WHERE id = 1')
    .get() as { auto_entry_enabled: number } | undefined;

  if (!settings || !settings.auto_entry_enabled) {
    return { allowed: false, reason: 'Auto Entry Disabled in Settings' };
  }

  const activeCount = db.db
    .prepare("SELECT COUNT(*) as count FROM active_trades WHERE status = 'ACTIVE'")
    .get() as { count: number };

  if (activeCount.count >= 3) {
    return { allowed: false, reason: 'All 3 Slots Occupied' };
  }

  const base = normalizeSymbol(symbol);
  const full = symbol.includes('/') ? symbol.trim().toUpperCase() : `${symbol.trim().toUpperCase()}/USDT:USDT`;
  const rows = db.db
    .prepare("SELECT symbol FROM active_trades WHERE status = 'ACTIVE'")
    .all() as { symbol: string }[];
  const activeBases = new Set(rows.map((r) => normalizeSymbol(r.symbol)));
  const activeFull = new Set<string>();
  for (const r of rows) {
    const s = r.symbol.trim().toUpperCase();
    activeFull.add(s);
    if (!s.includes('/')) activeFull.add(`${normalizeSymbol(r.symbol)}/USDT:USDT`);
  }
  if (activeBases.has(base) || activeFull.has(full)) {
    return { allowed: false, reason: 'Duplicate Token' };
  }

  return { allowed: true };
}
