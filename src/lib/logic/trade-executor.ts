import { db } from '../db/sqlite';

export async function executeDualTrade(params: {
  symbol: string;
  longExchange: string;
  shortExchange: string;
  amountPercent: number;
  reason: string;
}): Promise<boolean> {
  console.log(
    `[Trade Executor] SIMULATION: Long ${params.longExchange} / Short ${params.shortExchange} on ${params.symbol}`
  );

  try {
    db.db
      .prepare(
        `INSERT INTO active_trades (
        symbol, status, long_exchange, short_exchange,
        quantity, leverage, entry_price_binance, entry_price_bybit
      ) VALUES (?, 'ACTIVE', ?, ?, ?, 1, 0, 0)`
      )
      .run(params.symbol, params.longExchange, params.shortExchange, params.amountPercent);
  } catch (err) {
    console.error('[Trade Executor] DB Insert Error:', err);
  }

  return true;
}
