import type { FundingRate } from 'ccxt';
import { ExchangeManager } from '../exchanges/manager';
import { db } from '../db/sqlite';

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
  primaryInterval: string;
  isAsymmetric: boolean;
  score: number;
}

function getMinSpreadDecimal(): number {
  try {
    const row = db.db.prepare('SELECT min_spread_percent FROM bot_settings WHERE id = 1').get() as { min_spread_percent?: number } | undefined;
    return (row?.min_spread_percent ?? 0.01) / 100;
  } catch {
    return 0.0001;
  }
}

/**
 * Universal helper to convert ANY interval format to Minutes (number).
 * Returns 0 if unknown.
 */
function getIntervalMinutes(rate: FundingRate): number {
  let raw: string | number | undefined = rate.interval;

  if (raw != null && raw !== '') {
    const s = String(raw).toLowerCase().trim();
    if (s.includes('h')) return parseFloat(s) * 60; // '8h' -> 480
    if (s.includes('m')) return parseFloat(s); // '60m' -> 60
    const n = parseInt(s, 10);
    if (!isNaN(n)) return n; // '60' -> 60
  }

  const info = (rate.info || {}) as Record<string, unknown>;

  if (info.fundingIntervalHours != null) return Number(info.fundingIntervalHours) * 60;
  if (info.fundingInterval != null) return parseInt(String(info.fundingInterval), 10) || 0;
  if (info.interval != null && String(info.interval).toLowerCase().includes('h')) {
    return parseFloat(String(info.interval)) * 60;
  }
  if (info.interval != null) {
    const n = parseInt(String(info.interval), 10);
    if (!isNaN(n)) return n;
  }
  if (info.fundingPeriod != null) return parseInt(String(info.fundingPeriod), 10) || 0;

  return 0;
}

/** Convert minutes back to readable label */
function formatInterval(minutes: number): string {
  if (minutes === 0) return '??';
  if (minutes >= 60) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function evaluateOpportunity(
  symbol: string,
  binRate: FundingRate,
  byRate: FundingRate,
  minSpread: number
): FundingSpreadOpportunity | null {

  const binMins = getIntervalMinutes(binRate);
  const byMins = getIntervalMinutes(byRate);

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

  const label = formatInterval(binMins);

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
    binanceInterval: label,
    bybitInterval: label,
    primaryInterval: label,
    isAsymmetric: false,
    score: Math.max(1, Math.round(spread * 10000)),
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

  for (const symbol of commonTokens) {
    const binRate = binanceRates[symbol];
    const byRate = bybitRates[symbol];
    if (!binRate || !byRate) continue;

    const opp = evaluateOpportunity(symbol, binRate, byRate, minSpread);
    if (opp) opportunities.push(opp);
  }

  opportunities.sort((a, b) => b.spread - a.spread);

  return opportunities;
}

export async function refreshScreenerCache(): Promise<void> {
  try {
    const manager = new ExchangeManager();
    const { binance, bybit } = await manager.getFundingRates();
    const common = getCommonTokens(binance, bybit);
    if (common.length === 0) {
      console.warn('[Screener] No common tokens found.');
      return;
    }
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
