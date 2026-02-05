import type { FundingRate } from 'ccxt';
import { ExchangeManager } from '../exchanges/manager';

/** Static cache for instant API response. Refreshed in background by scheduler. */
let opportunityCache: FundingSpreadOpportunity[] = [];

export interface FundingSpreadOpportunity {
  symbol: string;
  spread: number;
  binanceRate: number;
  bybitRate: number;
  binancePrice: number;
  bybitPrice: number;
  longExchange: 'binance' | 'bybit';
  shortExchange: 'binance' | 'bybit';
  interval: string;
}

const INTERVAL_PRIORITY: Record<string, number> = {
  '1h': 0,
  '2h': 1,
  '4h': 2,
  '8h': 3,
};

function getIntervalPriority(interval: string): number {
  const normalized = interval?.toLowerCase() ?? '';
  return INTERVAL_PRIORITY[normalized] ?? 99;
}

/**
 * Normalize interval to '1h' | '2h' | '4h' | '8h' for comparison.
 * Handles API quirks: '480' or 480 (minutes) -> '8h', 60 -> '1h', 120 -> '2h', 240 -> '4h'.
 */
function normalizeInterval(interval: string | number | undefined): string {
  if (interval == null || interval === '') return '8h';
  const s = String(interval).toLowerCase().trim();
  const num = parseInt(s, 10);
  if (!Number.isNaN(num)) {
    if (num <= 60) return '1h';
    if (num <= 120) return '2h';
    if (num <= 240) return '4h';
    return '8h'; // 480, 480, etc.
  }
  if (s === '1h' || s === '1') return '1h';
  if (s === '2h' || s === '2') return '2h';
  if (s === '4h' || s === '4') return '4h';
  if (s === '8h' || s === '8') return '8h';
  return '8h';
}

/**
 * Finds symbols that exist on both Binance and Bybit.
 */
export function getCommonTokens(
  binanceRates: Record<string, FundingRate>,
  bybitRates: Record<string, FundingRate>
): string[] {
  const binanceSymbols = new Set(Object.keys(binanceRates));
  const bybitSymbols = new Set(Object.keys(bybitRates));
  return [...binanceSymbols].filter((s) => bybitSymbols.has(s));
}

/**
 * Calculates funding rate spreads for common tokens.
 * Direction: exchange with HIGHER rate = SHORT, LOWER rate = LONG.
 * Sorting: by interval priority (1h > 2h > 4h > 8h), then by highest spread.
 */
export function calculateFundingSpreads(
  commonTokens: string[],
  binanceRates: Record<string, FundingRate>,
  bybitRates: Record<string, FundingRate>
): FundingSpreadOpportunity[] {
  const opportunities: FundingSpreadOpportunity[] = [];

  for (const symbol of commonTokens) {
    const binanceRate = binanceRates[symbol];
    const bybitRate = bybitRates[symbol];
    if (!binanceRate || !bybitRate) continue;

    const binanceIntervalRaw = binanceRate.interval ?? (binanceRate as unknown as { info?: { fundingInterval?: string | number } })?.info?.fundingInterval;
    const bybitIntervalRaw = bybitRate.interval ?? (bybitRate as unknown as { info?: { fundingInterval?: string | number } })?.info?.fundingInterval;
    const binanceInterval = normalizeInterval(binanceIntervalRaw);
    const bybitInterval = normalizeInterval(bybitIntervalRaw);

    if (binanceInterval !== bybitInterval) continue;

    const binanceValue = binanceRate.fundingRate ?? 0;
    const bybitValue = bybitRate.fundingRate ?? 0;
    const spread = Math.abs(binanceValue - bybitValue);

    const longExchange: 'binance' | 'bybit' = binanceValue < bybitValue ? 'binance' : 'bybit';
    const shortExchange: 'binance' | 'bybit' = binanceValue >= bybitValue ? 'binance' : 'bybit';

    const interval = binanceInterval;
    const binancePrice = binanceRate.markPrice ?? 0;
    const bybitPrice = bybitRate.markPrice ?? 0;

    opportunities.push({
      symbol,
      spread,
      binanceRate: binanceValue,
      bybitRate: bybitValue,
      binancePrice,
      bybitPrice,
      longExchange,
      shortExchange,
      interval,
    });
  }

  opportunities.sort((a, b) => {
    const intervalDiff = getIntervalPriority(a.interval) - getIntervalPriority(b.interval);
    if (intervalDiff !== 0) return intervalDiff;
    return b.spread - a.spread;
  });

  return opportunities;
}

/**
 * Build opportunities from rates and log rejections for debugging "No Opportunities".
 * Used by refreshScreenerCache.
 */
function buildOpportunitiesWithLogging(
  commonTokens: string[],
  binanceRates: Record<string, FundingRate>,
  bybitRates: Record<string, FundingRate>
): FundingSpreadOpportunity[] {
  const opportunities: FundingSpreadOpportunity[] = [];
  let rejectedCount = 0;

  console.log(`🔍 Screener found ${commonTokens.length} common tokens. Filtering...`);

  for (const symbol of commonTokens) {
    const binanceRate = binanceRates[symbol];
    const bybitRate = bybitRates[symbol];
    if (!binanceRate || !bybitRate) continue;

    const binanceIntervalRaw = binanceRate.interval ?? (binanceRate as unknown as { info?: { fundingInterval?: string | number } })?.info?.fundingInterval;
    const bybitIntervalRaw = bybitRate.interval ?? (bybitRate as unknown as { info?: { fundingInterval?: string | number } })?.info?.fundingInterval;
    const binInterval = normalizeInterval(binanceIntervalRaw);
    const bybInterval = normalizeInterval(bybitIntervalRaw);

    if (binInterval !== bybInterval) {
      rejectedCount++;
      if (rejectedCount <= 3) {
        console.log(
          `⚠️ Rejected ${symbol}: Interval Mismatch (Bin raw: ${String(binanceIntervalRaw)} -> ${binInterval} vs Byb raw: ${String(bybitIntervalRaw)} -> ${bybInterval})`
        );
      }
      continue;
    }

    const binanceValue = binanceRate.fundingRate ?? 0;
    const bybitValue = bybitRate.fundingRate ?? 0;
    const spread = Math.abs(binanceValue - bybitValue);
    const longExchange: 'binance' | 'bybit' = binanceValue < bybitValue ? 'binance' : 'bybit';
    const shortExchange: 'binance' | 'bybit' = binanceValue >= bybitValue ? 'binance' : 'bybit';
    const interval = binInterval;
    const binancePrice = binanceRate.markPrice ?? 0;
    const bybitPrice = bybitRate.markPrice ?? 0;

    opportunities.push({
      symbol,
      spread,
      binanceRate: binanceValue,
      bybitRate: bybitValue,
      binancePrice,
      bybitPrice,
      longExchange,
      shortExchange,
      interval,
    });
  }

  opportunities.sort((a, b) => {
    const intervalDiff = getIntervalPriority(a.interval) - getIntervalPriority(b.interval);
    if (intervalDiff !== 0) return intervalDiff;
    return b.spread - a.spread;
  });

  console.log(`✅ Screener Finished: ${opportunities.length} valid, ${rejectedCount} rejected due to intervals.`);
  return opportunities;
}

/**
 * Fetches funding rates, builds opportunities with interval-mismatch logging, updates cache.
 * Call from scheduler every 60s; also once on scheduler start.
 */
export async function refreshScreenerCache(): Promise<void> {
  try {
    const manager = new ExchangeManager();
    const { binance: binanceRates, bybit: bybitRates } = await manager.getFundingRates();
    const binanceCount = Object.keys(binanceRates).length;
    const bybitCount = Object.keys(bybitRates).length;
    console.log(`🔍 Screener fetch OK: ${binanceCount} Binance symbols, ${bybitCount} Bybit symbols.`);
    const commonTokens = getCommonTokens(binanceRates, bybitRates);
    const opportunities = buildOpportunitiesWithLogging(commonTokens, binanceRates, bybitRates);
    opportunityCache = opportunities;
  } catch (err) {
    console.warn('[Screener] refreshScreenerCache failed (API error):', err);
  }
}

/**
 * Returns cached opportunities immediately. Does not block.
 * If cache is empty (e.g. before first refresh), returns [].
 * Use forceRefresh: true only when you need to wait for a fresh fetch (e.g. background job).
 */
export function getBestOpportunities(opts?: { forceRefresh?: boolean }): FundingSpreadOpportunity[] {
  if (opts?.forceRefresh) {
    refreshScreenerCache().catch((err) => console.warn('[Screener] getBestOpportunities(forceRefresh) failed:', err));
  }
  return opportunityCache.length > 0 ? [...opportunityCache] : [];
}
