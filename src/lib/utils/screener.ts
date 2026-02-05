import type { FundingRate } from 'ccxt';
import { ExchangeManager } from '../exchanges/manager';
import { db } from '../db/sqlite';

/** Static cache for instant API response */
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
  binanceInterval: '1h' | '2h' | '4h';
  bybitInterval: '1h' | '2h' | '4h';
  primaryInterval: '1h' | '2h' | '4h';
  /** Alias for primaryInterval for backward compatibility with candidate-selector, UI, etc. */
  interval: string;
  isAsymmetric: boolean;
  netFundingAdvantage: number;
  score: number;
}

const INTERVAL_PRIORITY = { '1h': 3, '2h': 2, '4h': 1 };
const ALLOWED_INTERVALS = ['1h', '2h', '4h'];

function getMinSpreadDecimal(): number {
  try {
    const settingsRow = db.db.prepare('SELECT min_spread_percent FROM bot_settings WHERE id = 1').get() as { min_spread_percent: number } | undefined;
    return (settingsRow?.min_spread_percent ?? 0.075) / 100;
  } catch {
    return 0.00075;
  }
}

function normalizeInterval(interval: string | number | undefined): '1h' | '2h' | '4h' | null {
  if (interval == null || interval === '') return null;
  const strVal = String(interval).toLowerCase().trim();
  const numVal = parseInt(strVal, 10);

  if (!isNaN(numVal)) {
    if (numVal === 60 || numVal === 1) return '1h';
    if (numVal === 120 || numVal === 2) return '2h';
    if (numVal === 240 || numVal === 4) return '4h';
    if (numVal === 480 || numVal === 8) return null;
    if (numVal === 720 || numVal === 12) return null;
  }

  if (strVal === '1h' || strVal === '1') return '1h';
  if (strVal === '2h' || strVal === '2') return '2h';
  if (strVal === '4h' || strVal === '4') return '4h';
  if (strVal === '8h' || strVal === '8') return null;
  if (strVal === '12h' || strVal === '12') return null;

  return null;
}

function getLowerInterval(int1: '1h' | '2h' | '4h', int2: '1h' | '2h' | '4h'): '1h' | '2h' | '4h' {
  const priority = { '1h': 3, '2h': 2, '4h': 1 };
  return priority[int1] >= priority[int2] ? int1 : int2;
}

function getFundingInterval(rate: FundingRate): string | number | undefined {
  const r = rate as unknown as { interval?: string; info?: { fundingInterval?: string | number } };
  return rate.interval ?? r?.info?.fundingInterval;
}

function evaluateOpportunity(symbol: string, binRate: FundingRate, byRate: FundingRate, minSpread: number): FundingSpreadOpportunity | null {
  const binInt = normalizeInterval(getFundingInterval(binRate));
  const byInt = normalizeInterval(getFundingInterval(byRate));

  if (!binInt || !byInt) return null;

  const binFunding = binRate.fundingRate ?? 0;
  const byFunding = byRate.fundingRate ?? 0;
  const binPrice = binRate.markPrice ?? 0;
  const byPrice = byRate.markPrice ?? 0;

  let longExchange: 'binance' | 'bybit';
  let shortExchange: 'binance' | 'bybit';
  let isAsymmetric = false;
  let netFundingAdvantage = 0;
  let valid = false;

  if (binInt === byInt) {
    // RULE 2: Same Interval
    const spread = Math.abs(binFunding - byFunding);
    if (spread <= minSpread) return null;

    if (binFunding > byFunding) {
      longExchange = 'bybit';
      shortExchange = 'binance';
    } else {
      longExchange = 'binance';
      shortExchange = 'bybit';
    }

    isAsymmetric = false;
    netFundingAdvantage = spread;
    valid = true;
  } else {
    // RULE 1: Asymmetric Interval
    const binPriority = INTERVAL_PRIORITY[binInt];
    const byPriority = INTERVAL_PRIORITY[byInt];

    const lowerIntervalEx = binPriority > byPriority ? 'binance' : 'bybit';
    const higherIntervalEx = binPriority > byPriority ? 'bybit' : 'binance';
    const lowerFunding = binPriority > byPriority ? binFunding : byFunding;
    const higherFunding = binPriority > byPriority ? byFunding : binFunding;

    const lowerIntervalGain = lowerFunding > 0 ? lowerFunding : 0;
    const higherIntervalCost = higherFunding;
    netFundingAdvantage = lowerIntervalGain - higherIntervalCost;

    if (netFundingAdvantage <= minSpread) return null;

    if (lowerIntervalEx === 'binance') {
      shortExchange = 'binance';
      longExchange = 'bybit';
    } else {
      shortExchange = 'bybit';
      longExchange = 'binance';
    }

    isAsymmetric = true;
    valid = true;
  }

  if (!valid) return null;

  const spread = Math.abs(binFunding - byFunding);
  const displaySpread = Math.max(0, spread - minSpread);
  const primaryInterval = getLowerInterval(binInt, byInt);

  const spreadScore = spread * 10000;
  const intervalBonus = INTERVAL_PRIORITY[primaryInterval] * 50;
  const asymmetricBonus = isAsymmetric ? 25 : 0;
  const score = spreadScore + intervalBonus + asymmetricBonus;

  return {
    symbol, spread, displaySpread, binanceRate: binFunding, bybitRate: byFunding,
    binancePrice: binPrice, bybitPrice: byPrice, longExchange, shortExchange,
    binanceInterval: binInt, bybitInterval: byInt, primaryInterval,
    interval: primaryInterval,
    isAsymmetric, netFundingAdvantage, score
  };
}

export function getCommonTokens(binanceRates: Record<string, FundingRate>, bybitRates: Record<string, FundingRate>): string[] {
  const binanceSymbols = new Set(Object.keys(binanceRates));
  const bybitSymbols = new Set(Object.keys(bybitRates));
  return [...binanceSymbols].filter((s) => bybitSymbols.has(s));
}

export function calculateFundingSpreads(commonTokens: string[], binanceRates: Record<string, FundingRate>, bybitRates: Record<string, FundingRate>): FundingSpreadOpportunity[] {
  const minSpread = getMinSpreadDecimal();
  const opportunities: FundingSpreadOpportunity[] = [];

  console.log(`[Screener] Evaluating ${commonTokens.length} tokens with min spread: ${(minSpread * 100).toFixed(4)}%`);

  let skipped8h = 0, skippedIntervalMismatch = 0, skippedLowSpread = 0;
  let acceptedAsymmetric = 0, acceptedSymmetric = 0;

  for (const symbol of commonTokens) {
    const binRate = binanceRates[symbol];
    const byRate = bybitRates[symbol];
    if (!binRate || !byRate) continue;

    const opp = evaluateOpportunity(symbol, binRate, byRate, minSpread);

    if (opp) {
      opportunities.push(opp);
      opp.isAsymmetric ? acceptedAsymmetric++ : acceptedSymmetric++;
    } else {
      const binInt = normalizeInterval(getFundingInterval(binRate));
      const byInt = normalizeInterval(getFundingInterval(byRate));
      if (!binInt || !byInt) skipped8h++;
      else if (binInt !== byInt) skippedIntervalMismatch++;
      else skippedLowSpread++;
    }
  }

  opportunities.sort((a, b) => b.score - a.score);

  console.log(`[Screener] Results: ${opportunities.length} valid (${acceptedAsymmetric} asymmetric, ${acceptedSymmetric} symmetric)`);
  console.log(`[Screener] Skipped: ${skipped8h} (8h+), ${skippedIntervalMismatch} (asymmetric no advantage), ${skippedLowSpread} (low spread)`);

  if (opportunities.length > 0) {
    console.log('[Screener] Top 5:');
    opportunities.slice(0, 5).forEach((o, i) => {
      console.log(`  ${i+1}. ${o.symbol} | Score: ${o.score.toFixed(0)} | ${o.isAsymmetric ? 'Asymmetric' : 'Symmetric'} (${o.binanceInterval}/${o.bybitInterval})`);
    });
  }

  return opportunities;
}

export async function refreshScreenerCache(): Promise<void> {
  try {
    console.log('[Screener] Refreshing...');
    const manager = new ExchangeManager();
    const { binance: binanceRates, bybit: bybitRates } = await manager.getFundingRates();

    if (Object.keys(binanceRates).length === 0 || Object.keys(bybitRates).length === 0) {
      console.error('[Screener] CRITICAL: Empty exchange data');
      return;
    }

    const commonTokens = getCommonTokens(binanceRates, bybitRates);
    opportunityCache = calculateFundingSpreads(commonTokens, binanceRates, bybitRates);
    lastCacheUpdate = Date.now();

    console.log(`[Screener] Cache updated: ${opportunityCache.length} opportunities`);
  } catch (err) {
    console.error('[Screener] refresh failed:', err);
  }
}

export function getBestOpportunities(opts?: { forceRefresh?: boolean }): FundingSpreadOpportunity[] {
  if (opts?.forceRefresh) {
    refreshScreenerCache().catch(err => console.error('[Screener] Force refresh failed:', err));
  }
  return [...opportunityCache];
}

export function getCacheAge(): number {
  if (lastCacheUpdate === 0) return Infinity;
  return Math.floor((Date.now() - lastCacheUpdate) / 1000);
}
