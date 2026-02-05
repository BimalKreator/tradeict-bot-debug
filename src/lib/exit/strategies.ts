import { db } from '@/lib/db/sqlite';

type ExitCheckResult =
  | { shouldExit: true; reason: string }
  | { shouldExit: false };

void db; // placeholder reference until direct DB usage is wired in

export interface ActiveTrade {
  id?: number;
  symbol: string;
  long_exchange: 'Binance' | 'Bybit';
  short_exchange: 'Binance' | 'Bybit';
  quantity?: number;
  allocated_capital?: number;
  entry_price_binance?: number | null;
  entry_price_bybit?: number | null;
  liquidation_binance?: number | null;
  liquidation_bybit?: number | null;
  next_funding_time?: string | null;
  funding_received?: number | null;
  /** Funding interval at entry (e.g. '8h', '4h', '1h'). Used for interval-change exit. */
  interval?: string | null;
}

export interface BotSettings {
  liquidation_buffer: number;
  negative_funding_exit: number;
  mtm_stoploss_enabled: number;
  mtm_stoploss_percent: number;
}

type PriceSnapshot = {
  binance: number;
  bybit: number;
};

function getCurrentPrices(_symbol: string): PriceSnapshot {
  // TODO: integrate with price service (Phase 15).
  return { binance: 0, bybit: 0 };
}

function getNextFundingRate(
  _symbol: string
): { longRate: number; shortRate: number; nextFundingAt: number } {
  // TODO: integrate with real funding data.
  return { longRate: 0, shortRate: 0, nextFundingAt: Date.now() + 60_000 };
}

export function checkLiquidationBuffer(
  trade: ActiveTrade,
  settings: BotSettings
): ExitCheckResult {
  const prices = getCurrentPrices(trade.symbol);

  const buffers: number[] = [];

  if (trade.liquidation_binance && trade.liquidation_binance > 0) {
    const price = prices.binance || trade.entry_price_binance || 0;
    if (price > 0) {
      const pct = (Math.abs(price - trade.liquidation_binance) / price) * 100;
      buffers.push(pct);
    }
  }

  if (trade.liquidation_bybit && trade.liquidation_bybit > 0) {
    const price = prices.bybit || trade.entry_price_bybit || 0;
    if (price > 0) {
      const pct = (Math.abs(price - trade.liquidation_bybit) / price) * 100;
      buffers.push(pct);
    }
  }

  if (buffers.length === 0) {
    return { shouldExit: false };
  }

  const minBuffer = Math.min(...buffers);
  if (minBuffer <= settings.liquidation_buffer) {
    return { shouldExit: true, reason: 'Liquidation Buffer Breached' };
  }

  return { shouldExit: false };
}

export function checkNegativeFunding(
  trade: ActiveTrade,
  settings: BotSettings
): ExitCheckResult {
  if (!settings.negative_funding_exit) {
    return { shouldExit: false };
  }

  const { longRate, shortRate, nextFundingAt } = getNextFundingRate(trade.symbol);
  const netFunding = longRate - shortRate;
  const timeToFunding = nextFundingAt - Date.now();

  if (netFunding < 0 && timeToFunding <= 5_000) {
    return { shouldExit: true, reason: 'Negative Funding' };
  }

  return { shouldExit: false };
}

export function checkMTMStoploss(
  trade: ActiveTrade,
  settings: BotSettings
): ExitCheckResult {
  if (!settings.mtm_stoploss_enabled) {
    return { shouldExit: false };
  }

  const prices = getCurrentPrices(trade.symbol);
  const quantity = trade.quantity ?? 0;
  const allocation = trade.allocated_capital ?? 0;

  if (quantity <= 0 || allocation <= 0) {
    return { shouldExit: false };
  }

  const longPrice =
    trade.long_exchange === 'Binance' ? prices.binance : prices.bybit;
  const shortPrice =
    trade.short_exchange === 'Binance' ? prices.binance : prices.bybit;

  const longEntry =
    trade.long_exchange === 'Binance'
      ? trade.entry_price_binance ?? 0
      : trade.entry_price_bybit ?? 0;
  const shortEntry =
    trade.short_exchange === 'Binance'
      ? trade.entry_price_binance ?? 0
      : trade.entry_price_bybit ?? 0;

  if (longPrice <= 0 || shortPrice <= 0 || longEntry <= 0 || shortEntry <= 0) {
    return { shouldExit: false };
  }

  const longPnL = (longPrice - longEntry) * quantity;
  const shortPnL = (shortEntry - shortPrice) * quantity;
  const mtm = longPnL + shortPnL;

  if (mtm >= 0) {
    return { shouldExit: false };
  }

  const drawdownPercent = (Math.abs(mtm) / allocation) * 100;
  if (drawdownPercent >= settings.mtm_stoploss_percent) {
    return { shouldExit: true, reason: 'MTM Stoploss Hit' };
  }

  return { shouldExit: false };
}
