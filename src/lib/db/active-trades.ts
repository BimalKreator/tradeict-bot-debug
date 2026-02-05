import { db } from './sqlite';
import { getTrades } from '../storage/trades';

export interface InsertActiveTradeParams {
  symbol: string;
  longExchange: string;
  shortExchange: string;
  quantity: number;
  leverage: number;
  entryPriceBinance: number;
  entryPriceBybit: number;
}

/**
 * Inserts a new active trade into the database.
 * Called when a dual trade succeeds (both legs open).
 */
export function insertActiveTrade(params: InsertActiveTradeParams): void {
  const {
    symbol,
    longExchange,
    shortExchange,
    quantity,
    leverage,
    entryPriceBinance,
    entryPriceBybit,
  } = params;
  try {
    db.db
      .prepare(
        `INSERT INTO active_trades (
          symbol, status, long_exchange, short_exchange,
          quantity, leverage, entry_price_binance, entry_price_bybit
        ) VALUES (?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        symbol,
        longExchange,
        shortExchange,
        quantity,
        leverage,
        entryPriceBinance,
        entryPriceBybit
      );
    console.log(`[DB] Inserted active trade: ${symbol}`);
  } catch (err) {
    console.error('[DB] insertActiveTrade failed:', err);
    // Trade is still in trades.json; exit controller may use exchange positions
  }
}

/**
 * Syncs OPEN trades from trades.json into active_trades (backfill for startup).
 * Skips symbols that already exist in active_trades.
 */
export function syncOpenTradesToActive(): void {
  try {
    const trades = getTrades().filter((t) => t.status === 'OPEN');
    const activeRows = db.db.prepare("SELECT symbol FROM active_trades WHERE status = 'ACTIVE'").all() as {
      symbol: string;
    }[];
    const existing = new Set<string>();
    for (const r of activeRows) {
      existing.add(r.symbol);
      existing.add(r.symbol.split('/')[0]);
    }
    for (const t of trades) {
      const base = t.symbol.includes('/') ? t.symbol.split('/')[0] : t.symbol;
      const full = t.symbol.includes('/') ? t.symbol : `${t.symbol}/USDT:USDT`;
      const already = existing.has(t.symbol) || existing.has(base) || existing.has(full);
      if (already) continue;
      const binanceLeg = t.legs.find((l) => l.exchange.toLowerCase() === 'binance');
      const bybitLeg = t.legs.find((l) => l.exchange.toLowerCase() === 'bybit');
      const longEx = binanceLeg?.side === 'BUY' ? 'binance' : 'bybit';
      const shortEx = binanceLeg?.side === 'BUY' ? 'bybit' : 'binance';
      insertActiveTrade({
        symbol: full,
        longExchange: longEx,
        shortExchange: shortEx,
        quantity: binanceLeg?.quantity ?? bybitLeg?.quantity ?? 0,
        leverage: 1,
        entryPriceBinance: binanceLeg?.price ?? 0,
        entryPriceBybit: bybitLeg?.price ?? 0,
      });
      existing.add(full);
      existing.add(base);
    }
  } catch (err) {
    console.error('[DB] syncOpenTradesToActive failed:', err);
  }
}
