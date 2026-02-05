import { db } from '../db/sqlite';
import type { DualTradeSides } from '../exchanges/manager';
import { ExchangeManager } from '../exchanges/manager';

export async function executeDualTrade(params: {
  symbol: string;
  longExchange: string;
  shortExchange: string;
  amountPercent: number;
  reason: string;
}): Promise<boolean> {
  console.log(`[Executor] 🟢 Starting execution for ${params.symbol}`);
  const manager = new ExchangeManager();

  const fullSymbol = params.symbol.includes('/') ? params.symbol : `${params.symbol}/USDT:USDT`;

  // 1. Get Prices
  const prices = await manager.getPrices(fullSymbol);
  if (!prices) {
    console.warn(`[Executor] Failed to fetch prices for ${params.symbol}`);
    return false;
  }
  const avgPrice = (prices.binance + prices.bybit) / 2;

  // 2. Calc Size
  const settings = db.db
    .prepare('SELECT max_capital_percent, leverage FROM bot_settings WHERE id = 1')
    .get() as { max_capital_percent?: number; leverage?: number } | undefined;
  const totalBalance = 95; // Replace with dynamic balance fetch if available
  const maxPercent = settings?.max_capital_percent ?? 30;
  const leverage = settings?.leverage ?? 1;
  const tradeSizeUsd = (totalBalance * (params.amountPercent / 100)) * leverage;
  let rawAmount = tradeSizeUsd / avgPrice;

  // 3. COMMON STEP SIZE LOGIC (Crucial Fix)
  let stepSize = 1;
  if (avgPrice < 0.1) stepSize = 100;
  else if (avgPrice < 1.0) stepSize = 10;
  else if (params.symbol.includes('BTC')) stepSize = 0.001;
  else if (params.symbol.includes('ETH')) stepSize = 0.01;
  else stepSize = 1;

  // Use API lot size if available (ExchangeManager.getCommonLotSizeStep)
  try {
    const apiStep = await manager.getCommonLotSizeStep(fullSymbol);
    if (apiStep > 0) stepSize = Math.max(stepSize, apiStep);
  } catch {
    // Fallback to heuristic
  }

  const finalAmount = Math.floor(rawAmount / stepSize) * stepSize;

  if (finalAmount <= 0) {
    console.error(`[Executor] ❌ Amount too small: ${finalAmount}`);
    return false;
  }

  console.log(
    `[Executor] ⚖️ Quantity Calc: Raw ${rawAmount.toFixed(2)} -> Safe ${finalAmount} (Step ${stepSize})`
  );

  const sides: DualTradeSides =
    params.longExchange === 'binance'
      ? { binance: 'BUY', bybit: 'SELL' }
      : { binance: 'SELL', bybit: 'BUY' };

  try {
    await manager.executeDualTrade(fullSymbol, finalAmount, leverage, sides);
    console.log(`[Executor] ✅ Executed ${finalAmount} ${params.symbol}`);
    return true;
  } catch (err) {
    console.error('[Executor] Execution failed:', err);
    return false;
  }
}
