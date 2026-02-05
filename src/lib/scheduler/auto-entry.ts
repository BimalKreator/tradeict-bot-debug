import { db } from '../db/sqlite';
import { addNotification } from '../db/notifications';
import { canEnterTrade } from '../entry/validator';
import { calculateAllocation } from '../entry/allocator';
import { getTradeDirection } from '../logic/direction';
import { ExchangeManager } from '../exchanges/manager';
import type { FundingSpreadOpportunity } from '../utils/screener';

const DEDUP_MS = 5 * 60 * 1000;
const lastExecuted = new Map<string, number>();

function normalizeSymbol(symbol: string): string {
  if (!symbol) return '';
  if (symbol.includes('/')) return symbol.split('/')[0];
  return symbol.replace(/USDT:?USDT?$/i, '');
}

/**
 * Execute sniper entry for a symbol. Deduplicates by symbol within 5 minutes.
 */
export async function executeEntry(
  symbol: string,
  opportunity: FundingSpreadOpportunity
): Promise<void> {
  const base = normalizeSymbol(symbol);
  const now = Date.now();
  const last = lastExecuted.get(base);
  if (last != null && now - last < DEDUP_MS) {
    return;
  }

  const validation = canEnterTrade(symbol);
  if (!validation.allowed) {
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

  const { long, short } = getTradeDirection(
    opportunity.binanceRate,
    opportunity.bybitRate
  );
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
