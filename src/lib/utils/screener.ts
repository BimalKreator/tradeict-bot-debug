import type { FundingRate } from 'ccxt';
import { ExchangeManager } from '../exchanges/manager';

let opportunityCache: FundingSpreadOpportunity[] = [];
let lastCacheUpdate = 0;

// REMOVE JUNK & MISMATCHED TOKENS
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
  isAsymmetric: boolean;
}

function getIntervalMinutes(rate: FundingRate): number {
  const info = (rate.info || {}) as Record<string, unknown>;

  // 1. TRUST RAW FIELDS FIRST (Most Accurate)
  // Binance: 'fundingIntervalHours' is reliable.
  if (info.fundingIntervalHours != null) return parseFloat(String(info.fundingIntervalHours)) * 60;

  // Bybit: 'fundingInterval' (minutes)
  if (info.fundingInterval != null) return parseInt(String(info.fundingInterval), 10) || 0;

  // 2. Fallback to CCXT standardized field (Only if looks valid - EXACT match to avoid "flow" matching "1h")
  if (rate.interval) {
    const s = String(rate.interval).toLowerCase().trim();
    if (s === '1h' || s === '60m' || s === '60') return 60;
    if (s === '2h' || s === '120m' || s === '120') return 120;
    if (s === '4h' || s === '240m' || s === '240') return 240;
    if (s === '8h' || s === '480m' || s === '480') return 480;
  }

  return 0; // Unknown
}

function formatInterval(minutes: number): string {
  if (minutes === 0) return 'Unk';
  if (minutes >= 60) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function parseIntervalToMinutes(intervalStr: string): number {
  const s = String(intervalStr).toLowerCase();
  if (s.includes('1h') || s === '60') return 60;
  if (s.includes('2h') || s === '120') return 120;
  if (s.includes('4h') || s === '240') return 240;
  if (s.includes('8h') || s === '480') return 480;
  return 480;
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
    // Filter Dead Markets
    if (!binRate?.fundingRate) continue;
    if (!bybitRates[symbol].fundingRate) continue;

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
  const binMins = getIntervalMinutes(binRate);
  const byMins = getIntervalMinutes(byRate);

  // STRICT FILTER: If unknown or mismatched, DISCARD.
  // Do NOT show them. The auto-trader blindly trusts the list.
  if (binMins === 0 || byMins === 0) return null;
  if (binMins !== byMins) return null;

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

  const intervalLabel = formatInterval(binMins);

  return {
    symbol,
    spread,
    displaySpread: spread,
    binanceRate: binFunding,
    bybitRate: byFunding,
    binanceInterval: intervalLabel,
    bybitInterval: intervalLabel,
    primaryInterval: intervalLabel,
    strategy: `Long ${longExchange === 'binance' ? 'Bin' : 'Byb'} / Short ${shortExchange === 'binance' ? 'Bin' : 'Byb'}`,
    score: Math.max(1, Math.round(spread * 10000)),
    longExchange,
    shortExchange,
    binancePrice: binRate.markPrice ?? 0,
    bybitPrice: byRate.markPrice ?? 0,
    isAsymmetric: false,
  };
}

export function calculateFundingSpreads(
  commonTokens: string[],
  binanceRates: Record<string, FundingRate>,
  bybitRates: Record<string, FundingRate>
): FundingSpreadOpportunity[] {
  const minSpread = 0.0;
  const opportunities: FundingSpreadOpportunity[] = [];

  for (const symbol of commonTokens) {
    const binRate = binanceRates[symbol];
    const byRate = bybitRates[symbol];
    if (!binRate || !byRate) continue;

    const opp = evaluateOpportunity(symbol, binRate, byRate, minSpread);
    if (opp) opportunities.push(opp);
  }

  // Sort: Low Interval First (Fastest Money), Then Spread Desc
  return opportunities.sort((a, b) => {
    const intA = parseIntervalToMinutes(a.primaryInterval);
    const intB = parseIntervalToMinutes(b.primaryInterval);
    if (intA !== intB) return intA - intB;
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
