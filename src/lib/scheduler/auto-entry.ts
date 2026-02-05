import { db } from '../db/sqlite';
import { addNotification } from '../db/notifications';
import { canEnterTrade } from '../entry/validator';
import { executeDualTrade } from '../logic/trade-executor';
import type { FundingSpreadOpportunity } from '../utils/screener';

// Global Blacklist for failed tokens (Reset on restart)
const FAILED_COOLDOWN = new Map<string, number>();
const COOLDOWN_DURATION = 15 * 60 * 1000; // 15 Minutes

function normalizeSymbol(symbol: string): string {
  if (!symbol) return '';
  const s = symbol.trim().toUpperCase();
  if (s.includes('/')) return s.split('/')[0];
  return s.replace(/USDT:?USDT?$/i, '');
}

export async function executeEntry(
  symbol: string,
  opportunity: FundingSpreadOpportunity
): Promise<void> {
  const base = normalizeSymbol(symbol);
  const now = Date.now();

  // 1. Check Cooldown
  if (FAILED_COOLDOWN.has(base) || FAILED_COOLDOWN.has(symbol)) {
    const key = FAILED_COOLDOWN.has(base) ? base : symbol;
    const failedAt = FAILED_COOLDOWN.get(key) ?? 0;
    const remaining = COOLDOWN_DURATION - (now - failedAt);
    if (remaining > 0) {
      console.log(
        `[AutoEntry] 🛑 Skipping ${symbol} (Cooldown active for ${Math.round(remaining / 1000)}s)`
      );
      return;
    }
    FAILED_COOLDOWN.delete(base);
    FAILED_COOLDOWN.delete(symbol);
  }

  const validation = canEnterTrade(symbol);
  if (!validation.allowed) {
    console.log(`[AutoEntry] Skipping ${symbol}: validation failed — ${validation.reason ?? 'not allowed'}`);
    return;
  }

  console.log(`[AutoEntry] 🚀 Attempting entry on ${symbol}...`);

  try {
    const settingsRow = db.db
      .prepare('SELECT max_capital_percent FROM bot_settings WHERE id = 1')
      .get() as { max_capital_percent?: number } | undefined;
    const maxCapitalPercent = settingsRow?.max_capital_percent ?? 30;

    const success = await executeDualTrade({
      symbol: symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`,
      longExchange: opportunity.longExchange,
      shortExchange: opportunity.shortExchange,
      amountPercent: maxCapitalPercent,
      reason: 'Auto-Entry',
    });

    if (success) {
      addNotification('SUCCESS', `Opened trade for ${base}`);
    } else {
      console.warn(`[AutoEntry] ⚠️ Trade Failed/Rolled back for ${symbol}. Blacklisting for 15m.`);
      FAILED_COOLDOWN.set(base, Date.now());
      addNotification('ERROR', `Trade entry failed for ${base}`);
    }
  } catch (err) {
    console.error(`[AutoEntry] ❌ Critical Error on ${symbol}:`, err);
    FAILED_COOLDOWN.set(base, Date.now());
    addNotification('ERROR', `Trade entry failed for ${base}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function checkPendingEntries(): void {
  // No-op: sniper mode executes immediately, no scheduled entries
}
