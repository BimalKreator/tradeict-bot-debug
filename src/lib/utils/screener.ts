import type { FundingRate } from 'ccxt';
import { ExchangeManager } from '@/lib/exchanges/manager';

let opportunityCache: FundingSpreadOpportunity[] = [];
let lastCacheUpdate = 0;

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

/** Bybit only: interval hours from rate info. Binance must use history-based cache (getBinanceHours). */
function getBybitHours(rate: FundingRate): number {
  const info = (rate.info || {}) as Record<string, unknown>;
  if (info.fundingIntervalHour != null) return parseFloat(String(info.fundingIntervalHour));
  if (info.fundingInterval != null) return parseInt(String(info.fundingInterval), 10) / 60;
  return 0;
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

function evaluateOpportunity(
  symbol: string,
  binRate: FundingRate,
  byRate: FundingRate,
  minSpreadDecimal: number,
  getBinanceHours: (sym: string) => number
): FundingSpreadOpportunity | null {
  const binHours = getBinanceHours(symbol);
  const byHours = getBybitHours(byRate);

  // STRICT: Binance interval from history cache only. If 0 or mismatch → exclude token.
  if (binHours === 0 || binHours !== byHours) return null;

  const binTime = binRate.fundingTimestamp || 0;
  const byTime = byRate.fundingTimestamp || 0;
  if (binTime === 0 || byTime === 0) return null;
  if (Math.abs(binTime - byTime) > 15 * 60 * 1000) return null;

  const binFunding = binRate.fundingRate ?? 0;
  const byFunding = byRate.fundingRate ?? 0;
  if (binFunding === 0 || byFunding === 0) return null;

  const spread = Math.abs(binFunding - byFunding);
  if (spread <= 0) return null;

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
  getBinanceHours: (symbol: string) => number
): FundingSpreadOpportunity[] {
  const opportunities: FundingSpreadOpportunity[] = [];
  for (const symbol of commonTokens) {
    const binRate = binanceRates[symbol];
    const byRate = bybitRates[symbol];
    if (!binRate || !byRate) continue;

    const opp = evaluateOpportunity(symbol, binRate, byRate, minSpreadDecimal, getBinanceHours);
    if (opp) opportunities.push(opp);
  }
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
    const { binance, bybit } = await manager.getFundingRates();
    const common = getCommonTokens(binance, bybit);
    const getBinanceHours = (symbol: string) => manager.getBinanceIntervalHours(symbol);
    opportunityCache = calculateFundingSpreads(common, binance, bybit, minSpreadDecimal, getBinanceHours);
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
