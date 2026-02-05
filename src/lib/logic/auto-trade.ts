import { getBestTradeCandidate } from './candidate-selector';
import { ExchangeManager } from '../exchanges/manager';
import { calculateAllocation } from '../entry/allocator';
import { canEnterTrade } from '../entry/validator';
import { db } from '../db/sqlite';

export async function checkAndExecuteAutoTrade(): Promise<void> {
  try {
    const settings = db.db
      .prepare(
        'SELECT auto_entry_enabled, min_spread_percent, max_capital_percent FROM bot_settings WHERE id = 1'
      )
      .get() as
      | { auto_entry_enabled?: number; min_spread_percent?: number; max_capital_percent?: number }
      | undefined;

    if (!settings || !settings.auto_entry_enabled) {
      console.log('[AutoTrade] Skipping: Auto Entry is OFF.');
      return;
    }

    const candidate = await getBestTradeCandidate();
    if (!candidate || !candidate.readyToTrade) {
      console.log('[AutoTrade] No valid candidates found.');
      return;
    }

    const minSpread = (settings.min_spread_percent ?? 0.01) / 100;
    if (candidate.spread < minSpread) {
      console.log(
        `[AutoTrade] Spread too low: ${candidate.spreadPercent}% < ${settings.min_spread_percent}%`
      );
      return;
    }

    const validation = canEnterTrade(candidate.symbol);
    if (!validation.allowed) {
      console.log(`[AutoTrade] Skipping ${candidate.symbol}: ${validation.reason ?? 'not allowed'}`);
      return;
    }

    console.log(`[AutoTrade] 🚀 OPPORTUNITY FOUND: ${candidate.symbol} (${candidate.spreadPercent}%)`);
    console.log(
      `[AutoTrade] Direction: Long ${candidate.longExchange} / Short ${candidate.shortExchange}`
    );
    console.log('[AutoTrade] Executing Trade on IN...');

    const opp = candidate.opportunity;
    const avgPrice =
      (opp.binancePrice + opp.bybitPrice) / 2 || opp.binancePrice || opp.bybitPrice;

    const alloc = await calculateAllocation(avgPrice);
    const quantity = alloc.quantity;
    if (quantity <= 0) {
      console.error('[AutoTrade] Zero quantity from allocator');
      return;
    }

    const leverageRow = db.db
      .prepare('SELECT leverage FROM bot_settings WHERE id = 1')
      .get() as { leverage?: number } | undefined;
    const leverage = leverageRow?.leverage ?? 1;

    const sides =
      candidate.longExchange === 'binance'
        ? { binance: 'BUY' as const, bybit: 'SELL' as const }
        : { binance: 'SELL' as const, bybit: 'BUY' as const };

    const fullSymbol = candidate.symbol.includes('/') ? candidate.symbol : `${candidate.symbol}/USDT:USDT`;

    const manager = new ExchangeManager();
    const result = await manager.executeDualTrade(fullSymbol, quantity, leverage, sides);

    console.log(`[AutoTrade] ✅ Trade executed: ${result.tradeId}`);
  } catch (error) {
    console.error('[AutoTrade] Execution Failed:', error);
  }
}
