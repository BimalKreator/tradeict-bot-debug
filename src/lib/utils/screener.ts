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
  primaryInterval: string;
  strategy: string;
  score: number;
  longExchange: 'binance' | 'bybit';
  shortExchange: 'binance' | 'bybit';
  binanceInterval: string;
  bybitInterval: string;
  binancePrice: number;
  bybitPrice: number;
}

// Helper to get pure hours (Number)
function getHours(rate: FundingRate, exchange: string): number {
  const info = (rate.info || {}) as Record<string, unknown>;

  if (exchange === 'binance') {
    if (info.fundingIntervalHours != null) return parseFloat(String(info.fundingIntervalHours));
    return 8; // Fallback: Binance API doesn't send interval in funding rate response
  }

  if (exchange === 'bybit') {
    if (info.fundingIntervalHour != null) return parseFloat(String(info.fundingIntervalHour));
    if (info.fundingInterval != null) return parseInt(String(info.fundingInterval), 10) / 60;
  }

  return 0;
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
  byRate: FundingRate
): FundingSpreadOpportunity | null {
  // 1. STRICT INTERVAL MATCH (Hours)
  const binHours = getHours(binRate, 'binance');
  const byHours = getHours(byRate, 'bybit');

  if (binHours > 0 && byHours > 0 && binHours !== byHours) {
    return null;
  }

  // 2. STRICT TIMESTAMP MATCH
  const binTime = binRate.fundingTimestamp || 0;
  const byTime = byRate.fundingTimestamp || 0;
  if (binTime === 0 || byTime === 0) return null;
  if (Math.abs(binTime - byTime) > 15 * 60 * 1000) {
    return null;
  }

  // 3. Normal Logic
  const binFunding = binRate.fundingRate ?? 0;
  const byFunding = byRate.fundingRate ?? 0;
  if (binFunding === 0 || byFunding === 0) return null;

  const spread = Math.abs(binFunding - byFunding);
  if (spread <= 0) return null;

  let longExchange: 'binance' | 'bybit';
  let shortExchange: 'binance' | 'bybit';

  if (binFunding > byFunding) {
    longExchange = 'bybit';
    shortExchange = 'binance';
  } else {
    longExchange = 'binance';
    shortExchange = 'bybit';
  }

  const intervalLabel = binHours > 0 ? `${binHours}h` : byHours > 0 ? `${byHours}h` : '8h';

  return {
    symbol,
    spread,
    displaySpread: spread,
    binanceRate: binFunding,
    bybitRate: byFunding,
    primaryInterval: intervalLabel,
    binanceInterval: intervalLabel,
    bybitInterval: intervalLabel,
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

    const opp = evaluateOpportunity(symbol, binRate, byRate);
    if (opp) opportunities.push(opp);
  }
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
