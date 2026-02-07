import { db } from '@/lib/db/sqlite';
import type { ExchangeManager } from '@/lib/exchanges/manager';

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

/** Derive strategy label from long/short exchange (matches screener format). */
function getStrategyLabel(longExchange: string, shortExchange: string): string {
  const long = (longExchange ?? '').toLowerCase();
  const short = (shortExchange ?? '').toLowerCase();
  const longName = long === 'binance' ? 'Bin' : 'Byb';
  const shortName = short === 'binance' ? 'Bin' : 'Byb';
  return `Long ${longName} / Short ${shortName}`;
}

/**
 * Strategy Flip (Funding Flip): Exit if current funding rates dictate the OPPOSITE strategy.
 * - binRate > bybRate → optimal is Long Bybit / Short Binance (Spread +).
 * - bybRate > binRate → optimal is Long Binance / Short Bybit (Spread -).
 * Returns true (trigger exit) if current optimal does NOT match trade's entry strategy.
 */
export function checkStrategyFlip(
  trade: ActiveTrade,
  binRate: number,
  bybRate: number
): ExitCheckResult {
  const tradeLong = (trade.long_exchange ?? '').toLowerCase();
  const tradeShort = (trade.short_exchange ?? '').toLowerCase();

  let optimalLong: string;
  let optimalShort: string;
  if (binRate > bybRate) {
    optimalLong = 'bybit';
    optimalShort = 'binance';
  } else {
    optimalLong = 'binance';
    optimalShort = 'bybit';
  }

  const match = optimalLong === tradeLong && optimalShort === tradeShort;
  if (match) return { shouldExit: false };

  const entryStrategy = getStrategyLabel(trade.long_exchange, trade.short_exchange);
  console.warn(
    `[Exit] Strategy Flipped! Entry: ${entryStrategy}, Current Market requires opposite.`
  );
  return { shouldExit: true, reason: 'Strategy Flipped' };
}

/** Parse interval string to hours (e.g. "4h" -> 4). Returns 0 if unknown. */
function parseEntryIntervalHours(s: string | null | undefined): number {
  const v = (s ?? '').toLowerCase().trim();
  if (v === '1h' || v === '1') return 1;
  if (v === '2h' || v === '2') return 2;
  if (v === '4h' || v === '4') return 4;
  if (v === '8h' || v === '8') return 8;
  const n = parseFloat(String(v).replace(/h/gi, ''));
  return !isNaN(n) && n > 0 ? n : 0;
}

/**
 * Interval Change (Robust Check): Exit if funding interval on either exchange changed from entry.
 * Uses cached intervals from ExchangeManager. If current interval is 0 (Unknown/API fail), do NOT exit.
 */
export async function checkIntervalChange(
  trade: ActiveTrade,
  manager: ExchangeManager
): Promise<ExitCheckResult> {
  const entryHours = parseEntryIntervalHours(trade.interval ?? undefined);
  if (entryHours <= 0) return { shouldExit: false };

  let current: { binance: number; bybit: number };
  try {
    current = await manager.getFundingIntervalHours(trade.symbol);
  } catch (err) {
    console.warn('[Exit] getFundingIntervalHours failed, skipping interval check:', err);
    return { shouldExit: false };
  }

  if (current.binance === 0 || current.bybit === 0) {
    return { shouldExit: false };
  }

  if (current.binance !== entryHours) {
    console.warn(
      `[Exit] Interval Changed! Entry: ${trade.interval ?? entryHours + 'h'}, Current: ${current.binance}h.`
    );
    return { shouldExit: true, reason: 'Funding Interval Changed' };
  }
  if (current.bybit !== entryHours) {
    console.warn(
      `[Exit] Interval Changed! Entry: ${trade.interval ?? entryHours + 'h'}, Current: ${current.bybit}h.`
    );
    return { shouldExit: true, reason: 'Funding Interval Changed' };
  }

  return { shouldExit: false };
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
