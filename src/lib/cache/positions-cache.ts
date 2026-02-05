import { db } from '../db/sqlite';

const ACTIVE_TRADES_CACHE_TTL_MS = 2000;

export type ActiveTradeRow = {
  symbol: string;
  funding_received: number | null;
  long_funding_acc: number | null;
  short_funding_acc: number | null;
  next_funding_time: string | null;
  liquidation_binance: number | null;
  liquidation_bybit: number | null;
  leverage: number | null;
  quantity: number | null;
  entry_price_binance: number | null;
  entry_price_bybit: number | null;
  long_exchange: string | null;
  short_exchange: string | null;
};

let cache: { used: number; rows: ActiveTradeRow[]; ts: number } | null = null;

export function invalidatePositionsCache(): void {
  cache = null;
}

export function getActiveTradesCached(): { used: number; rows: ActiveTradeRow[] } {
  const now = Date.now();
  if (cache && now - cache.ts < ACTIVE_TRADES_CACHE_TTL_MS) {
    return { used: cache.used, rows: cache.rows };
  }
  console.time('[Positions cache] active_trades query');
  const countRow = db.db
    .prepare("SELECT COUNT(*) as count FROM active_trades WHERE status = 'ACTIVE'")
    .get() as { count: number };
  const used = Number(countRow?.count ?? 0);
  const rows = db.db
    .prepare(
      `SELECT symbol, funding_received, long_funding_acc, short_funding_acc, next_funding_time, liquidation_binance, liquidation_bybit, leverage, quantity, entry_price_binance, entry_price_bybit, long_exchange, short_exchange FROM active_trades WHERE status = 'ACTIVE'`
    )
    .all() as ActiveTradeRow[];
  console.timeEnd('[Positions cache] active_trades query');
  cache = { used, rows, ts: now };
  return { used, rows };
}
