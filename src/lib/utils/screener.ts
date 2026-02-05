import type { FundingRate } from 'ccxt';
import { ExchangeManager } from '../exchanges/manager';

let opportunityCache: FundingSpreadOpportunity[] = [];
let lastCacheUpdate = 0;

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
    // Skip 0 funding (dead markets)
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
  // 1. STRICT TIMESTAMP CHECK (The Loop Killer)
  // We don't care about string labels ("4h" vs "8h"). We care about PAYOUT TIME.
  const binTime = binRate.fundingTimestamp || 0;
  const byTime = byRate.fundingTimestamp || 0;

  // If timestamps are missing or differ by > 15 mins (900000ms), HIDE IT.
  if (binTime === 0 || byTime === 0) return null;
  const timeDiff = Math.abs(binTime - byTime);

  if (timeDiff > 15 * 60 * 1000) {
    return null;
  }

  // 2. Funding & Spread Check
  const binFunding = binRate.fundingRate ?? 0;
  const byFunding = byRate.fundingRate ?? 0;
  if (binFunding === 0 || byFunding === 0) return null;

  const spread = Math.abs(binFunding - byFunding);
  if (spread < minSpread) return null;

  // 3. Interval Display (Just for UI)
  const info = (byRate.info || {}) as Record<string, unknown>;
  let displayInterval = '8h';
  if (info.fundingIntervalHour != null) {
    displayInterval = `${info.fundingIntervalHour}h`;
  } else if (byRate.interval) {
    displayInterval = String(byRate.interval);
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
    binanceInterval: displayInterval,
    bybitInterval: displayInterval,
    primaryInterval: displayInterval,
    strategy: `Long ${longExchange === 'binance' ? 'Bin' : 'Byb'} / Short ${shortExchange === 'binance' ? 'Bin' : 'Byb'}`,
    score: spread * 10000,
    longExchange,
    shortExchange,
    binancePrice: binRate.markPrice ?? 0,
    bybitPrice: byRate.markPrice ?? 0,
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

  // Sort by spread (all remaining are safe - timestamps match)
  return opportunities.sort((a, b) => b.spread - a.spread);
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
