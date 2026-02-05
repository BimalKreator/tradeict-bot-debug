import { getBestOpportunities } from '../utils/screener';
import type { FundingSpreadOpportunity } from '../utils/screener';
import { getTimeToNextFundingMs } from '../utils/funding-time';

export function normalizeSymbol(symbol: string): string {
  if (!symbol) return '';
  if (symbol.includes('/')) return symbol.split('/')[0];
  return symbol.replace(/USDT:?USDT?$/i, '');
}

export interface BestTradeCandidate {
  symbol: string;
  spread: number;
  spreadPercent: string;
  interval: string;
  score: number;
  longExchange: string;
  shortExchange: string;
  readyToTrade: boolean;
  opportunity: FundingSpreadOpportunity;
  nextFundingAt?: Date;
  expectedEntryTime?: Date;
  timeToFundingSec?: number;
  displaySpreadPercent?: string;
}

export interface CandidateSelectorInput {
  activeSymbols: Set<string>;
  minSpreadDecimal: number;
  minTimeToFundingSec?: number;
}

/**
 * Returns the #1 token for "Next to Trade" highlight (UI).
 */
export async function getBestTradeCandidate(): Promise<BestTradeCandidate | null> {
  const opportunities = getBestOpportunities();
  const sorted = [...opportunities].sort((a, b) => b.score - a.score);
  if (sorted.length === 0) return null;

  const best = sorted[0];
  return {
    symbol: best.symbol,
    spread: best.spread,
    spreadPercent: (best.displaySpread * 100).toFixed(4),
    interval: best.primaryInterval,
    score: best.score,
    longExchange: best.longExchange,
    shortExchange: best.shortExchange,
    readyToTrade: best.score > 0,
    opportunity: best,
  };
}

/**
 * Returns top N candidates for next-entry API and refill scheduler.
 * Filters out active symbols and includes full opportunity + time fields.
 */
export async function getBestCandidates(
  input: CandidateSelectorInput,
  limit: number
): Promise<BestTradeCandidate[]> {
  const { activeSymbols, minTimeToFundingSec } = input;
  const opportunities = getBestOpportunities();
  const sorted = [...opportunities].sort((a, b) => b.score - a.score);

  const activeBaseKeys = new Set([...activeSymbols].map(normalizeSymbol));
  const eligible: FundingSpreadOpportunity[] = [];
  for (const opp of sorted) {
    const baseKey = normalizeSymbol(opp.symbol);
    if (activeBaseKeys.has(baseKey) || activeSymbols.has(opp.symbol) || activeSymbols.has(baseKey))
      continue;
    if (minTimeToFundingSec != null) {
      const timeToFundingMs = getTimeToNextFundingMs(opp.primaryInterval);
      if (timeToFundingMs < minTimeToFundingSec * 1000) continue;
    }
    eligible.push(opp);
    if (eligible.length >= limit) break;
  }

  return eligible.slice(0, limit).map((opp) => {
    const timeToFundingMs = getTimeToNextFundingMs(opp.primaryInterval);
    const nextFundingAt = new Date(Date.now() + timeToFundingMs);
    const expectedEntryTime = new Date(nextFundingAt.getTime() - 2 * 60 * 1000);
    return {
      symbol: opp.symbol,
      spread: opp.spread,
      spreadPercent: (opp.displaySpread * 100).toFixed(4),
      interval: opp.primaryInterval,
      score: opp.score,
      longExchange: opp.longExchange,
      shortExchange: opp.shortExchange,
      readyToTrade: opp.score > 0,
      opportunity: opp,
      nextFundingAt,
      expectedEntryTime,
      timeToFundingSec: Math.round(timeToFundingMs / 1000),
      displaySpreadPercent: (opp.displaySpread * 100).toFixed(4),
    };
  });
}
