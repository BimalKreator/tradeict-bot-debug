import { db } from '@/lib/db/sqlite';
import { recordFundingLegs } from '@/lib/db/funding';
import { ExchangeManager } from '@/lib/exchanges/manager';

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

type ActiveTradeRow = {
  id: number;
  symbol: string;
  quantity: number;
  long_exchange: string;
  short_exchange: string;
  entry_price_binance: number | null;
  entry_price_bybit: number | null;
};

/**
 * Runs at 8h intervals: fetches funding rates, computes amounts per leg, updates long_funding_acc and short_funding_acc.
 */
export async function runFundingAccumulation(): Promise<void> {
  const rows = db.db
    .prepare<[], ActiveTradeRow>(
      `SELECT id, symbol, quantity, long_exchange, short_exchange,
              entry_price_binance, entry_price_bybit
         FROM active_trades
        WHERE status = 'ACTIVE'`
    )
    .all();

  if (rows.length === 0) return;

  const manager = new ExchangeManager();
  const { binance: binanceRates, bybit: bybitRates } = await manager.getFundingRates();

  for (const trade of rows) {
    try {
      const sym = trade.symbol.includes('/') ? trade.symbol : `${trade.symbol}/USDT:USDT`;
      const binanceRate = binanceRates[sym]?.fundingRate ?? 0;
      const bybitRate = bybitRates[sym]?.fundingRate ?? 0;

      const longEx = (trade.long_exchange || '').toLowerCase();
      const shortEx = (trade.short_exchange || '').toLowerCase();

      const longPrice = longEx === 'binance' ? (trade.entry_price_binance ?? 0) : (trade.entry_price_bybit ?? 0);
      const shortPrice = shortEx === 'binance' ? (trade.entry_price_binance ?? 0) : (trade.entry_price_bybit ?? 0);

      const longRate = longEx === 'binance' ? binanceRate : bybitRate;
      const shortRate = shortEx === 'binance' ? binanceRate : bybitRate;

      const qty = trade.quantity ?? 0;
      const longAmount = qty * longPrice * longRate;
      const shortAmount = qty * shortPrice * shortRate;

      const longExchangeName = longEx === 'binance' ? 'binance' : 'bybit';
      const shortExchangeName = shortEx === 'binance' ? 'binance' : 'bybit';

      recordFundingLegs(trade.id, longExchangeName, shortExchangeName, longAmount, shortAmount);
    } catch (err) {
      console.error(`[FundingJob] Failed to record funding for trade ${trade.id} (${trade.symbol}):`, err);
    }
  }
}

let lastRun = 0;

export function maybeRunFundingAccumulation(): void {
  const now = Date.now();
  if (now - lastRun < EIGHT_HOURS_MS) return;
  lastRun = now;
  runFundingAccumulation().catch((err) =>
    console.error('[FundingJob] runFundingAccumulation failed:', err)
  );
}
