import { db } from '../db/sqlite';
import { addNotification } from '../db/notifications';
import { canEnterTrade } from '../entry/validator';
import { calculateAllocation } from '../entry/allocator';
import { ExchangeManager } from '../exchanges/manager';
import type { FundingSpreadOpportunity } from '../utils/screener';

const DEDUP_MS = 60 * 1000;
const lastExecuted = new Map<string, number>();

function normalizeSymbol(symbol: string): string {
  if (!symbol) return '';
  const s = symbol.trim().toUpperCase();
  if (s.includes('/')) return s.split('/')[0];
  return s.replace(/USDT:?USDT?$/i, '');
}

/**
 * Execute sniper entry for a symbol. Deduplicates by symbol within 1 minute.
 */
export async function executeEntry(
  symbol: string,
  opportunity: FundingSpreadOpportunity
): Promise<void> {
  const base = normalizeSymbol(symbol);
  const now = Date.now();
  const last = lastExecuted.get(base);
  if (last != null && now - last < DEDUP_MS) {
    console.log(`[AutoEntry] Skipping ${symbol}: dedup (last ${Math.round((now - last) / 1000)}s ago)`);
    return;
  }

  const validation = canEnterTrade(symbol);
  if (!validation.allowed) {
    console.log(`[AutoEntry] Skipping ${symbol}: validation failed — ${validation.reason ?? 'not allowed'}`);
    return;
  }

  lastExecuted.set(base, now);

  const fullSymbol = symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`;
  const avgPrice =
    (opportunity.binancePrice + opportunity.bybitPrice) / 2 || opportunity.binancePrice || opportunity.bybitPrice;

  let quantity: number;
  let leverage: number;
  try {
    const alloc = await calculateAllocation(avgPrice);
    quantity = alloc.quantity;
    if (quantity <= 0) {
      console.error('[AutoEntry] Zero quantity from allocator');
      return;
    }
    const settingsRow = db.db
      .prepare('SELECT leverage FROM bot_settings WHERE id = 1')
      .get() as { leverage: number } | undefined;
    leverage = settingsRow?.leverage ?? 1;
  } catch (err) {
    console.error('[AutoEntry] Allocator failed:', err);
    return;
  }

  const long = opportunity.longExchange;
  const sides =
    long === 'binance'
      ? { binance: 'BUY' as const, bybit: 'SELL' as const }
      : { binance: 'SELL' as const, bybit: 'BUY' as const };

  try {
    const manager = new ExchangeManager();
    const result = await manager.executeDualTrade(
      fullSymbol,
      quantity,
      leverage,
      sides
    );
    console.log(`🚀 EXECUTING AUTO TRADE: ${symbol} — ${result.tradeId}`);
    addNotification('SUCCESS', `Opened trade for ${base}`);
  } catch (err) {
    console.error('[AutoEntry] Trade execution failed:', err);
    lastExecuted.delete(base);
    addNotification('ERROR', `Trade entry failed for ${base}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function checkPendingEntries(): void {
  // No-op: sniper mode executes immediately, no scheduled entries
}
