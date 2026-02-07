import type { FundingRate } from 'ccxt';
import { ExchangeManager } from '@/lib/exchanges/manager';
import { IntervalManager } from '@/lib/managers/interval-manager';

let opportunityCache: FundingSpreadOpportunity[] = [];
let lastCacheUpdate = 0;
/** Limit debug logs per cycle to avoid spam. */
let _screenerDebugLogCount = 0;

const BLACKLIST = ['GPS', 'SKR', 'ENSO', 'ORBS', 'CVX', 'USDC', 'WAVES', 'DGB', 'BTS', 'PERP', 'TORN', 'OMG'];

export interface FundingSpreadOpportunity {
  symbol: string;
  spread: number;
  displaySpread: number;
  binanceRate: number;
  bybitRate: number;
  primaryInterval: string;
  strategy: string;
  score: number;
  longExchange: 'binance' | 'bybit';
  shortExchange: 'binance' | 'bybit';
  binanceInterval: string;
  bybitInterval: string;
  binancePrice: number;
  bybitPrice: number;
  nextFundingTime: number;
  netSpread: number;
  minSpreadUsed: number;
  /** Interval in hours (1, 2, 4, 8) for sorting: 1h/2h = group 1, 4h/8h = group 2. */
  intervalHours: number;
}

function getIntervalLabel(hours: number): string {
  return hours > 0 ? `${hours}h` : '8h';
}

export function getCommonTokens(
  binanceRates: Record<string, FundingRate>,
  bybitRates: Record<string, FundingRate>
): string[] {
  const common: string[] = [];
  for (const symbol of Object.keys(binanceRates)) {
    if (!symbol.includes('USDT') || !bybitRates[symbol]) continue;

    const binRate = binanceRates[symbol];
    const byRate = bybitRates[symbol];
    if (binRate?.fundingRate == null || binRate.fundingRate === 0) continue;
    if (byRate?.fundingRate == null || byRate.fundingRate === 0) continue;

    if (BLACKLIST.includes(symbol.split('/')[0].replace('1000', ''))) continue;
    common.push(symbol);
  }
  return common;
}

export type GetCachedInterval = (symbol: string, exchange: 'binance' | 'bybit') => number;

function evaluateOpportunity(
  symbol: string,
  binRate: FundingRate,
  byRate: FundingRate,
  minSpreadDecimal: number,
  getCachedInterval: GetCachedInterval
): FundingSpreadOpportunity | null {
  let binHours = getCachedInterval(symbol, 'binance');
  const byHours = getCachedInterval(symbol, 'bybit');

  // If Binance interval missing, assume 8h (trust the opportunity score).
  if (!binHours) binHours = 8;

  // Reject if Bybit interval unknown or if intervals mismatch (e.g. 4h vs 8h).
  if (!byHours || binHours !== byHours) {
    if (_screenerDebugLogCount < 5) {
      console.log(`[Screener] Rejecting ${symbol}: Interval Mismatch (Bin=${binHours}, By=${byHours})`);
      _screenerDebugLogCount++;
    }
    return null;
  }

  const binTime = binRate.fundingTimestamp || 0;
  const byTime = byRate.fundingTimestamp || 0;
  if (binTime === 0 || byTime === 0) {
    if (_screenerDebugLogCount < 5) {
      console.log(`[Screener] Rejecting ${symbol}: Missing Funding Timestamp (binTime=${binTime}, byTime=${byTime})`);
      _screenerDebugLogCount++;
    }
    return null;
  }
  if (Math.abs(binTime - byTime) > 15 * 60 * 1000) {
    if (_screenerDebugLogCount < 5) {
      console.log(`[Screener] Rejecting ${symbol}: Funding Time Too Far Apart (diff=${Math.abs(binTime - byTime)}ms)`);
      _screenerDebugLogCount++;
    }
    return null;
  }

  const binFunding = binRate.fundingRate ?? 0;
  const byFunding = byRate.fundingRate ?? 0;
  if (binFunding === 0 || byFunding === 0) {
    if (_screenerDebugLogCount < 5) {
      console.log(`[Screener] Rejecting ${symbol}: Zero Funding Rate (bin=${binFunding}, by=${byFunding})`);
      _screenerDebugLogCount++;
    }
    return null;
  }

  const spread = Math.abs(binFunding - byFunding);
  if (spread <= 0) {
    if (_screenerDebugLogCount < 5) {
      console.log(`[Screener] Rejecting ${symbol}: No Spread (spread=${spread})`);
      _screenerDebugLogCount++;
    }
    return null;
  }

  const netSpread = spread - minSpreadDecimal;
  const nextFundingTime = byTime > 0 ? byTime : binTime;

  let longExchange: 'binance' | 'bybit';
  let shortExchange: 'binance' | 'bybit';

  if (binFunding > byFunding) {
    longExchange = 'bybit';
    shortExchange = 'binance';
  } else {
    longExchange = 'binance';
    shortExchange = 'bybit';
  }

  const label = getIntervalLabel(binHours);

  return {
    symbol,
    spread,
    displaySpread: spread,
    binanceRate: binFunding,
    bybitRate: byFunding,
    primaryInterval: label,
    binanceInterval: label,
    bybitInterval: label,
    strategy: `Long ${longExchange === 'binance' ? 'Bin' : 'Byb'} / Short ${shortExchange === 'binance' ? 'Bin' : 'Byb'}`,
    score: spread * 10000,
    longExchange,
    shortExchange,
    binancePrice: binRate.markPrice ?? 0,
    bybitPrice: byRate.markPrice ?? 0,
    nextFundingTime,
    netSpread,
    minSpreadUsed: minSpreadDecimal,
    intervalHours: binHours,
  };
}

export function calculateFundingSpreads(
  commonTokens: string[],
  binanceRates: Record<string, FundingRate>,
  bybitRates: Record<string, FundingRate>,
  minSpreadDecimal: number,
  getCachedInterval: GetCachedInterval
): FundingSpreadOpportunity[] {
  _screenerDebugLogCount = 0;
  console.log('[Screener] Input Symbols Count:', commonTokens.length);
  if (Object.keys(binanceRates).length === 0 || Object.keys(bybitRates).length === 0) {
    console.warn('[Screener] Rates Cache is EMPTY!');
  }
  const opportunities: FundingSpreadOpportunity[] = [];
  for (const symbol of commonTokens) {
    const binRate = binanceRates[symbol];
    const byRate = bybitRates[symbol];
    if (!binRate || !byRate) {
      if (_screenerDebugLogCount < 5) {
        console.log(`[Screener] Rejecting ${symbol}: Missing Rate (no binance or bybit data)`);
        _screenerDebugLogCount++;
      }
      continue;
    }

    const opp = evaluateOpportunity(symbol, binRate, byRate, minSpreadDecimal, getCachedInterval);
    if (opp) opportunities.push(opp);
  }
  console.log('[Screener] Final Opportunities Found:', opportunities.length);
  return opportunities.sort((a, b) => {
    const intA = a.intervalHours ?? 0;
    const intB = b.intervalHours ?? 0;
    const isGroup1A = intA >= 1 && intA <= 2;
    const isGroup1B = intB >= 1 && intB <= 2;
    if (isGroup1A && !isGroup1B) return -1;
    if (!isGroup1A && isGroup1B) return 1;
    return (b.netSpread ?? 0) - (a.netSpread ?? 0);
  });
}

export async function refreshScreenerCache(minSpreadDecimal: number = 0): Promise<void> {
  try {
    const manager = new ExchangeManager();
    await manager.refreshIntervalsIfNeeded();
    // Real-time rates from WebSocket; fallback to REST if WS not ready
    const { binance, bybit } = await manager.getRates();
    if (Object.keys(binance).length === 0 || Object.keys(bybit).length === 0) {
      console.warn('[Screener] Rates Cache is EMPTY!');
    }
    const common = getCommonTokens(binance, bybit);
    manager.populateBybitIntervalsFromRates(bybit);
    // Binance interval from IntervalManager (chunked history scan); Bybit from rate metadata
    const intervalManager = IntervalManager.getInstance();
    const getCachedInterval = (symbol: string, exchange: 'binance' | 'bybit') =>
      exchange === 'binance' ? intervalManager.getInterval(symbol) : manager.getCachedInterval(symbol, 'bybit');
    opportunityCache = calculateFundingSpreads(common, binance, bybit, minSpreadDecimal, getCachedInterval);
    lastCacheUpdate = Date.now();
  } catch (e) {
    console.error('[Screener] Refresh failed:', e);
  }
}

export function getBestOpportunities(opts?: { forceRefresh?: boolean }): FundingSpreadOpportunity[] {
  if (opts?.forceRefresh) {
    refreshScreenerCache().catch((e) => console.error('[Screener] Force refresh failed:', e));
  }
  return [...opportunityCache];
}

export function getCacheAge(): number {
  if (lastCacheUpdate === 0) return Infinity;
  return Math.floor((Date.now() - lastCacheUpdate) / 1000);
}
