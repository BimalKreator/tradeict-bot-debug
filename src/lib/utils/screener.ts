import type { FundingRate } from 'ccxt';
import { ExchangeManager } from '../exchanges/manager';
import { db } from '../db/sqlite';

/** Static cache for instant API response. */
let opportunityCache: FundingSpreadOpportunity[] = [];
let lastCacheUpdate = 0;

export interface FundingSpreadOpportunity {
  symbol: string;
  spread: number;
  displaySpread: number;
  binanceRate: number;
  bybitRate: number;
  binancePrice: number;
  bybitPrice: number;
  longExchange: 'binance' | 'bybit';
  shortExchange: 'binance' | 'bybit';
  binanceInterval: string;
  bybitInterval: string;
  primaryInterval: string; // The common interval
  isAsymmetric: boolean;   // Always false in this logic
  score: number;           // Equal to spread for ranking
}

/** Get min spread from settings */
function getMinSpreadDecimal(): number {
  try {
    const settingsRow = db.db
      .prepare('SELECT min_spread_percent FROM bot_settings WHERE id = 1')
      .get() as { min_spread_percent: number } | undefined;
    return (settingsRow?.min_spread_percent ?? 0.01) / 100;
  } catch {
    return 0.0001; // Default 0.01%
  }
}

/**
 * Robust interval parser.
 * Converts numeric minutes (480) or strings to standard '8h', '4h', '1h'.
 * Defaults to '8h' if unknown to prevent skipping data.
 */
function normalizeInterval(interval: string | number | undefined): string {
  if (interval == null || interval === '') return '8h'; // Default to standard

  const strVal = String(interval).toLowerCase().trim();
  const numVal = parseInt(strVal, 10);

  // Handle numeric minutes
  if (!isNaN(numVal)) {
    if (numVal === 60 || numVal === 1) return '1h';
    if (numVal === 120 || numVal === 2) return '2h';
    if (numVal === 240 || numVal === 4) return '4h';
    if (numVal >= 480 || numVal === 8) return '8h';
  }

  // Handle string values
  if (strVal.includes('1h')) return '1h';
  if (strVal.includes('2h')) return '2h';
  if (strVal.includes('4h')) return '4h';

  return '8h'; // Default fallback
}

function getIntervalFromRate(rate: FundingRate): string {
  const info = rate.info as { fundingInterval?: string; interval?: string } | undefined;
  return normalizeInterval(rate.interval ?? info?.fundingInterval ?? info?.interval);
}

function evaluateOpportunity(
  symbol: string,
  binRate: FundingRate,
  byRate: FundingRate,
  minSpread: number
): FundingSpreadOpportunity | null {

  // 1. Get Intervals
  const binInt = getIntervalFromRate(binRate);
  const byInt = getIntervalFromRate(byRate);

  // 2. STRICT RULE: Intervals MUST match
  if (binInt !== byInt) {
    return null;
  }

  const binFunding = binRate.fundingRate ?? 0;
  const byFunding = byRate.fundingRate ?? 0;

  // 3. Calculate Spread
  const spread = Math.abs(binFunding - byFunding);

  // 4. Filter by Min Spread
  if (spread < minSpread) {
    return null;
  }

  let longExchange: 'binance' | 'bybit';
  let shortExchange: 'binance' | 'bybit';

  if (binFunding > byFunding) {
    longExchange = 'bybit';
    shortExchange = 'binance';
  } else {
    longExchange = 'binance';
    shortExchange = 'bybit';
  }

  return {
    symbol,
    spread,
    displaySpread: spread, // Show full spread
    binanceRate: binFunding,
    bybitRate: byFunding,
    binancePrice: binRate.markPrice ?? 0,
    bybitPrice: byRate.markPrice ?? 0,
    longExchange,
    shortExchange,
    binanceInterval: binInt,
    bybitInterval: byInt,
    primaryInterval: binInt, // Since they are same
    isAsymmetric: false,
    score: spread // Rank purely by profit
  };
}

export function getCommonTokens(
  binanceRates: Record<string, FundingRate>,
  bybitRates: Record<string, FundingRate>
): string[] {
  const binanceSymbols = new Set(Object.keys(binanceRates));
  const bybitSymbols = new Set(Object.keys(bybitRates));
  return [...binanceSymbols].filter((s) => bybitSymbols.has(s));
}

export function calculateFundingSpreads(
  commonTokens: string[],
  binanceRates: Record<string, FundingRate>,
  bybitRates: Record<string, FundingRate>
): FundingSpreadOpportunity[] {
  const minSpread = getMinSpreadDecimal();
  const opportunities: FundingSpreadOpportunity[] = [];

  console.log(`[Screener] Checking ${commonTokens.length} tokens. Min Spread: ${(minSpread * 100).toFixed(4)}%`);

  let skippedMismatch = 0;
  let skippedLowSpread = 0;

  for (const symbol of commonTokens) {
    const binRate = binanceRates[symbol];
    const byRate = bybitRates[symbol];
    if (!binRate || !byRate) continue;

    const opp = evaluateOpportunity(symbol, binRate, byRate, minSpread);

    if (opp) {
      opportunities.push(opp);
    } else {
      const binInt = getIntervalFromRate(binRate);
      const byInt = getIntervalFromRate(byRate);
      if (binInt !== byInt) skippedMismatch++;
      else skippedLowSpread++;
    }
  }

  // Sort by Spread (Highest First)
  opportunities.sort((a, b) => b.spread - a.spread);

  console.log(`[Screener] Found ${opportunities.length} valid opportunities.`);
  console.log(`[Screener] Skipped: ${skippedMismatch} (Interval Mismatch), ${skippedLowSpread} (Low Spread)`);

  return opportunities;
}

export async function refreshScreenerCache(): Promise<void> {
  try {
    const manager = new ExchangeManager();
    const { binance: binanceRates, bybit: bybitRates } = await manager.getFundingRates();
    const commonTokens = getCommonTokens(binanceRates, bybitRates);

    if (commonTokens.length === 0) {
      console.warn('[Screener] No common tokens found.');
      return;
    }

    opportunityCache = calculateFundingSpreads(commonTokens, binanceRates, bybitRates);
    lastCacheUpdate = Date.now();
  } catch (err) {
    console.error('[Screener] Refresh failed:', err);
  }
}

export function getBestOpportunities(opts?: { forceRefresh?: boolean }): FundingSpreadOpportunity[] {
  if (opts?.forceRefresh) {
    refreshScreenerCache().catch((err) => console.error('[Screener] Force refresh failed:', err));
  }
  return [...opportunityCache];
}

export function getCacheAge(): number {
  if (lastCacheUpdate === 0) return Infinity;
  return Math.floor((Date.now() - lastCacheUpdate) / 1000);
}
