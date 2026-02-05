import type { FundingRate } from 'ccxt';
import { ExchangeManager } from '../exchanges/manager';

let opportunityCache: FundingSpreadOpportunity[] = [];
let lastCacheUpdate = 0;

const BLACKLIST = ['GPS', 'SKR', 'ENSO', 'ORBS', 'CVX', 'USDC'];

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
  isAsymmetric: boolean;
}

function getIntervalMinutes(rate: FundingRate): number {
  const raw = rate.interval;
  if (raw != null && raw !== '') {
    const s = String(raw).toLowerCase().trim();
    if (s.includes('h')) return parseFloat(s) * 60;
    if (s.includes('m')) return parseFloat(s);
    const n = parseInt(s, 10);
    if (!isNaN(n)) return n;
  }
  const info = (rate.info || {}) as Record<string, unknown>;
  if (info.fundingIntervalHours != null) return Number(info.fundingIntervalHours) * 60;
  if (info.fundingInterval != null) return parseInt(String(info.fundingInterval), 10) || 0;
  return 0;
}

function formatInterval(minutes: number): string {
  if (minutes === 0) return '8h';
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

  let binMins = getIntervalMinutes(binRate);
  let byMins = getIntervalMinutes(byRate);

  if (binMins === 0 && byMins > 0) binMins = byMins;
  if (byMins === 0 && binMins > 0) byMins = binMins;
  if (binMins === 0 && byMins === 0) {
    binMins = 480;
    byMins = 480;
  }

  const binLabel = formatInterval(binMins);
  const byLabel = formatInterval(byMins);
  const primaryInterval = binMins === byMins ? binLabel : `${binLabel}/${byLabel}`;

  const binFunding = binRate.fundingRate ?? 0;
  const byFunding = byRate.fundingRate ?? 0;
  const spread = Math.abs(binFunding - byFunding);

  if (spread < minSpread) return null;

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
    binanceInterval: binLabel,
    bybitInterval: byLabel,
    primaryInterval,
    strategy: `Long ${longExchange === 'binance' ? 'Bin' : 'Byb'} / Short ${shortExchange === 'binance' ? 'Bin' : 'Byb'}`,
    score: Math.max(1, Math.round(spread * 10000)),
    longExchange,
    shortExchange,
    binancePrice: binRate.markPrice ?? 0,
    bybitPrice: byRate.markPrice ?? 0,
    isAsymmetric: binMins !== byMins,
  };
}

export function calculateFundingSpreads(
  commonTokens: string[],
  binanceRates: Record<string, FundingRate>,
  bybitRates: Record<string, FundingRate>
): FundingSpreadOpportunity[] {
  const minSpread = 0;
  const opportunities: FundingSpreadOpportunity[] = [];

  for (const symbol of commonTokens) {
    const binRate = binanceRates[symbol];
    const byRate = bybitRates[symbol];
    if (!binRate || !byRate) continue;

    const opp = evaluateOpportunity(symbol, binRate, byRate, minSpread);
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
