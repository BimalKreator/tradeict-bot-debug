import type { FundingRate } from 'ccxt';
import { ExchangeManager } from '../exchanges/manager';

let opportunityCache: FundingSpreadOpportunity[] = [];
let lastCacheUpdate = 0;

// Clean Blacklist
const BLACKLIST = ['GPS', 'SKR', 'ENSO', 'ORBS', 'CVX', 'USDC', 'WAVES', 'DGB', 'BTS', 'PERP', 'TORN', 'OMG'];

export interface FundingSpreadOpportunity {
  symbol: string;
  spread: number;
  displaySpread: number;
  binanceRate: number;
  bybitRate: number;
  binanceInterval: string;
  bybitInterval: string;
  primaryInterval: string;
  strategy: string;
  score: number;
  longExchange: 'binance' | 'bybit';
  shortExchange: 'binance' | 'bybit';
  binancePrice: number;
  bybitPrice: number;
  isSafe: boolean;
}

function getIntervalMinutes(rate: FundingRate, exchange: string): number {
  const info = (rate.info || {}) as Record<string, unknown>;

  // 1. Bybit (Explicit): fundingIntervalHour (singular)
  if (exchange === 'bybit' && info.fundingIntervalHour != null) {
    return parseInt(String(info.fundingIntervalHour), 10) * 60;
  }

  // 2. Binance (Implicit/Default): API doesn't send interval. Standard is 8h.
  // We rely on Timestamp Matching for actual safety.
  if (exchange === 'binance') {
    return 480;
  }

  // 3. CCXT Fallback
  if (rate.interval) {
    const s = String(rate.interval).toLowerCase();
    if (s.includes('h')) return parseFloat(s) * 60;
    if (s.includes('m')) return parseFloat(s);
  }

  return 480; // Default to 8h if unknown
}

function formatInterval(minutes: number): string {
  if (minutes === 0) return 'Unk';
  if (minutes >= 60) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function getCommonTokens(
  binanceRates: Record<string, FundingRate>,
  bybitRates: Record<string, FundingRate>
): string[] {
  const common: string[] = [];
  for (const symbol of Object.keys(binanceRates)) {
    if (!symbol.includes('USDT')) continue;
    if (!bybitRates[symbol]) continue;

    const binRate = binanceRates[symbol];
    const byRate = bybitRates[symbol];
    // Ignore 0 funding (Dead Markets)
    if (binRate?.fundingRate == null || binRate.fundingRate === 0) continue;
    if (byRate?.fundingRate == null || byRate.fundingRate === 0) continue;

    const base = symbol.split('/')[0].replace('1000', '');
    if (BLACKLIST.includes(base)) continue;

    common.push(symbol);
  }
  return common;
}

function evaluateOpportunity(
  symbol: string,
  binRate: FundingRate,
  byRate: FundingRate,
  minSpread: number
): FundingSpreadOpportunity | null {
  // 1. Rates
  const binFunding = binRate.fundingRate ?? 0;
  const byFunding = byRate.fundingRate ?? 0;
  if (binFunding === 0 || byFunding === 0) return null;

  const spread = Math.abs(binFunding - byFunding);
  if (spread < minSpread) return null;

  // 2. Intervals (Display only)
  const binMins = getIntervalMinutes(binRate, 'binance');
  const byMins = getIntervalMinutes(byRate, 'bybit');
  const binLabel = formatInterval(binMins);
  const byLabel = formatInterval(byMins);

  // 3. CRITICAL SAFETY CHECK: Timestamp Synchronization
  // Both exchanges must pay out at roughly the same time.
  const binTime = binRate.fundingTimestamp || 0;
  const byTime = byRate.fundingTimestamp || 0;

  // Tolerance of 15 minutes (to handle minor clock skews)
  const timeDiff = Math.abs(binTime - byTime);
  const timesMatch = timeDiff < 15 * 60 * 1000;

  const isSafe = timesMatch && binTime > 0 && byTime > 0;

  let longExchange: 'binance' | 'bybit';
  let shortExchange: 'binance' | 'bybit';

  if (binFunding > byFunding) {
    longExchange = 'bybit';
    shortExchange = 'binance';
  } else {
    longExchange = 'binance';
    shortExchange = 'bybit';
  }

  let strategy = `Long ${longExchange === 'binance' ? 'Bin' : 'Byb'} / Short ${shortExchange === 'binance' ? 'Bin' : 'Byb'}`;
  let score = spread * 10000;
  let primaryInterval = binLabel;

  if (!isSafe) {
    strategy = '⚠️ Time Mismatch';
    score = 0; // Block Auto-Trade
    if (binLabel !== byLabel) primaryInterval = `${binLabel}/${byLabel}`;
    else primaryInterval = 'Time Sync Error';
  }

  return {
    symbol,
    spread,
    displaySpread: spread,
    binanceRate: binFunding,
    bybitRate: byFunding,
    binanceInterval: binLabel,
    bybitInterval: byLabel,
    primaryInterval,
    strategy,
    score,
    longExchange,
    shortExchange,
    binancePrice: binRate.markPrice ?? 0,
    bybitPrice: byRate.markPrice ?? 0,
    isSafe,
  };
}

export function calculateFundingSpreads(
  commonTokens: string[],
  binanceRates: Record<string, FundingRate>,
  bybitRates: Record<string, FundingRate>
): FundingSpreadOpportunity[] {
  const opportunities: FundingSpreadOpportunity[] = [];

  for (const symbol of commonTokens) {
    const binRate = binanceRates[symbol];
    const byRate = bybitRates[symbol];
    if (!binRate || !byRate) continue;

    const opp = evaluateOpportunity(symbol, binRate, byRate, 0);
    if (opp) opportunities.push(opp);
  }

  // Sort: Safe first, then by spread desc
  return opportunities.sort((a, b) => {
    if (a.isSafe && !b.isSafe) return -1;
    if (!a.isSafe && b.isSafe) return 1;
    return b.spread - a.spread;
  });
}

export async function refreshScreenerCache(): Promise<void> {
  try {
    const manager = new ExchangeManager();
    const { binance, bybit } = await manager.getFundingRates();
    const common = getCommonTokens(binance, bybit);
    opportunityCache = calculateFundingSpreads(common, binance, bybit);
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
