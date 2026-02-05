import type { FundingSpreadOpportunity } from '../utils/screener';
import { ExchangeManager } from '../exchanges/manager';
import { getCommonTokens, calculateFundingSpreads } from '../utils/screener';
import { getTimeToNextFundingMs } from '../utils/funding-time';

/** Higher = preferred (1h > 2h > 4h > 8h). */
const INTERVAL_PRIORITY: Record<string, number> = {
  '1h': 4,
  '2h': 3,
  '4h': 2,
  '8h': 1,
};

function getIntervalPriority(interval: string): number {
  const normalized = (interval ?? '').toLowerCase();
  return INTERVAL_PRIORITY[normalized] ?? 0;
}

export function normalizeSymbol(symbol: string): string {
  if (!symbol) return '';
  const s = symbol.trim().toUpperCase();
  if (s.includes('/')) return s.split('/')[0];
  return s.replace(/USDT:?USDT?$/i, '');
}

/** Returns base symbol in uppercase for consistent comparison. */
function toBaseKey(symbol: string): string {
  return normalizeSymbol(symbol).toUpperCase();
}

export interface BestTradeCandidate {
  symbol: string;
  spread: number;
  spreadPercent: string;
  interval: string;
  timeToFundingMs: number;
  timeToFundingSec: number;
  expectedEntryTime: Date;
  nextFundingAt: Date;
  opportunity: FundingSpreadOpportunity;
}

export interface CandidateSelectorInput {
  activeSymbols: Set<string>;
  minSpreadDecimal: number;
  /** Exclude tokens with time to funding below this (seconds). Use when too late to enter. */
  minTimeToFundingSec?: number;
}

function oppToCandidate(opp: FundingSpreadOpportunity): BestTradeCandidate {
  const timeToFundingMs = getTimeToNextFundingMs(opp.interval);
  const nextFundingAt = new Date(Date.now() + timeToFundingMs);
  const expectedEntryTime = new Date(nextFundingAt.getTime() - 2 * 60 * 1000);
  return {
    symbol: opp.symbol,
    spread: opp.spread,
    spreadPercent: (opp.spread * 100).toFixed(4),
    interval: opp.interval,
    timeToFundingMs,
    timeToFundingSec: Math.round(timeToFundingMs / 1000),
    expectedEntryTime,
    nextFundingAt,
    opportunity: opp,
  };
}

/** Fetch top 50 from screener so we have enough after filters/dedup to fill all slots. */
const SCREENER_TOP_N = 50;

/**
 * Returns exactly `limit` trade candidates (or fewer if market has fewer).
 * Fetches top 50 from screener, filters (spread, active, interval), deduplicates by base symbol, then slices to `limit`.
 */
export async function getBestCandidates(
  input: CandidateSelectorInput,
  limit: number
): Promise<BestTradeCandidate[]> {
  const { activeSymbols, minSpreadDecimal, minTimeToFundingSec } = input;

  const manager = new ExchangeManager();
  const { binance: binanceRates, bybit: bybitRates } =
    await manager.getFundingRates();
  const commonTokens = getCommonTokens(binanceRates, bybitRates);
  const opportunities = calculateFundingSpreads(
    commonTokens,
    binanceRates,
    bybitRates
  );

  const eligible: FundingSpreadOpportunity[] = [];
  const activeBaseKeys = new Set([...activeSymbols].map(toBaseKey));

  for (const opp of opportunities) {
    if (opp.spread < minSpreadDecimal) continue;
    const candidateBaseKey = toBaseKey(opp.symbol);
    const candidateBase = normalizeSymbol(opp.symbol);
    const candidateFullSymbol = opp.symbol.includes('/') ? opp.symbol.replace(/\/USDT$/i, '/USDT:USDT') : `${opp.symbol}/USDT:USDT`;
    if (activeBaseKeys.has(candidateBaseKey)) continue;
    if (activeSymbols.has(opp.symbol)) continue;
    if (activeSymbols.has(opp.symbol.split('/')[0])) continue;
    if (activeSymbols.has(candidateBase)) continue;
    if (activeSymbols.has(candidateFullSymbol)) continue;
    if (minTimeToFundingSec != null) {
      const timeToFundingMs = getTimeToNextFundingMs(opp.interval);
      if (timeToFundingMs < minTimeToFundingSec * 1000) continue;
    }
    eligible.push(opp);
  }

  eligible.sort((a, b) => {
    const pa = getIntervalPriority(a.interval);
    const pb = getIntervalPriority(b.interval);
    if (pa !== pb) return pb - pa; // higher priority first (1h before 8h)
    return b.spread - a.spread;
  });

  const topFromScreener = eligible.slice(0, SCREENER_TOP_N);
  const seenBases = new Set<string>();
  const unique: FundingSpreadOpportunity[] = [];
  for (const opp of topFromScreener) {
    const baseKey = toBaseKey(opp.symbol);
    if (seenBases.has(baseKey)) continue;
    seenBases.add(baseKey);
    unique.push(opp);
    if (unique.length >= limit) break;
  }
  return unique.slice(0, limit).map(oppToCandidate);
}

/**
 * Returns the single best trade candidate. Convenience wrapper.
 */
export async function getBestTradeCandidate(
  input: CandidateSelectorInput
): Promise<BestTradeCandidate | null> {
  const candidates = await getBestCandidates(input, 1);
  return candidates[0] ?? null;
}
