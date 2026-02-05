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

/** Raw info shape from exchanges (Binance / Bybit) */
type RateInfo = {
  fundingIntervalHours?: number | string;
  fundingInterval?: string | number;
  interval?: string | number;
  fundingPeriod?: string | number;
  [key: string]: unknown;
};

/**
 * Deep raw data extraction. No defaults – if interval cannot be determined, returns null.
 * Binance: fundingIntervalHours, interval, fundingPeriod.
 * Bybit: fundingInterval (often minutes e.g. '60').
 */
function normalizeInterval(rate: FundingRate): string | null {
  let raw: string | number | undefined = rate.interval;

  if (raw == null || raw === '') {
    const info = rate.info as RateInfo | undefined;
    if (info) {
      if (info.fundingIntervalHours != null) raw = String(info.fundingIntervalHours) + 'h';
      else if (info.fundingInterval != null) raw = info.fundingInterval;
      else if (info.interval != null) raw = info.interval;
      else if (info.fundingPeriod != null) raw = info.fundingPeriod;
    }
  }

  if (raw == null || raw === '') return null;

  const str = String(raw).toLowerCase().trim();
  const num = parseInt(str, 10);

  if (!isNaN(num)) {
    if (num === 60 || num === 1) return '1h';
    if (num === 120 || num === 2) return '2h';
    if (num === 240 || num === 4) return '4h';
    if (num === 480 || num === 8) return '8h';
  }

  if (str.includes('1h')) return '1h';
  if (str.includes('2h')) return '2h';
  if (str.includes('4h')) return '4h';
  if (str.includes('8h')) return '8h';

  return null;
}

/** Called only when binInt and byInt are already non-null and equal. */
function evaluateOpportunity(
  symbol: string,
  binRate: FundingRate,
  byRate: FundingRate,
  minSpread: number,
  binInt: string,
  byInt: string
): FundingSpreadOpportunity | null {

  const binFunding = binRate.fundingRate ?? 0;
  const byFunding = byRate.fundingRate ?? 0;

  const spread = Math.abs(binFunding - byFunding);
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
    displaySpread: spread,
    binanceRate: binFunding,
    bybitRate: byFunding,
    binancePrice: binRate.markPrice ?? 0,
    bybitPrice: byRate.markPrice ?? 0,
    longExchange,
    shortExchange,
    binanceInterval: binInt,
    bybitInterval: byInt,
    primaryInterval: binInt,
    isAsymmetric: false,
    score: Math.max(1, Math.round(spread * 10000))
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

  let skippedUnknown = 0;
  let skippedMismatch = 0;
  let skippedLowSpread = 0;
  let logNullCount = 0;

  for (const symbol of commonTokens) {
    const binRate = binanceRates[symbol];
    const byRate = bybitRates[symbol];
    if (!binRate || !byRate) continue;

    const binInt = normalizeInterval(binRate);
    const byInt = normalizeInterval(byRate);

    if (binInt == null || byInt == null) {
      if (logNullCount < 3) {
        console.log(`[Screener] Missing interval for ${symbol}: Binance info=${JSON.stringify(binRate.info ?? {}).substring(0, 120)}`);
        console.log(`[Screener]   Bybit info=${JSON.stringify(byRate.info ?? {}).substring(0, 120)}`);
        logNullCount++;
      }
      skippedUnknown++;
      continue;
    }

    if (binInt !== byInt) {
      skippedMismatch++;
      continue;
    }

    const opp = evaluateOpportunity(symbol, binRate, byRate, minSpread, binInt, byInt);
    if (opp) {
      opportunities.push(opp);
    } else {
      skippedLowSpread++;
    }
  }

  opportunities.sort((a, b) => b.score - a.score);

  console.log(`[Screener] Found ${opportunities.length} valid opportunities.`);
  console.log(`[Screener] Skipped: ${skippedUnknown} (Unknown interval), ${skippedMismatch} (Interval Mismatch), ${skippedLowSpread} (Low Spread)`);

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
