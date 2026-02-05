import { getBestOpportunities, type FundingSpreadOpportunity } from '../utils/screener';
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
  timeToFundingSec: number;
  nextFundingAt: Date;
  expectedEntryTime: Date;
}

export interface CandidateSelectorInput {
  activeSymbols: Set<string>;
  minSpreadDecimal?: number;
  minTimeToFundingSec?: number;
}

function mapToCandidate(op: FundingSpreadOpportunity): BestTradeCandidate {
  const intervalPart = op.primaryInterval.split('/')[0] || '8h';
  const msToFunding = getTimeToNextFundingMs(intervalPart);
  const nextFundingAt = new Date(Date.now() + msToFunding);
  const expectedEntryTime = new Date(nextFundingAt.getTime() - 2 * 60 * 1000);
  return {
    symbol: op.symbol,
    spread: op.spread,
    spreadPercent: ((op.displaySpread ?? op.spread) * 100).toFixed(4),
    interval: op.primaryInterval,
    score: op.score,
    longExchange: op.longExchange,
    shortExchange: op.shortExchange,
    readyToTrade: true,
    opportunity: op,
    timeToFundingSec: Math.floor(msToFunding / 1000),
    nextFundingAt,
    expectedEntryTime,
  };
}

/**
 * Get the single best candidate not already in activeSymbols.
 * Top 1 -> Active? -> Top 2 -> ...
 */
export async function getBestTradeCandidate(
  activeSymbols: Set<string> = new Set()
): Promise<BestTradeCandidate | null> {
  const opportunities = getBestOpportunities();
  const activeBaseKeys = new Set([...activeSymbols].map((s) => normalizeSymbol(s)));

  const best = opportunities.find(
    (op) => !activeSymbols.has(op.symbol) && !activeBaseKeys.has(normalizeSymbol(op.symbol))
  );

  if (!best) return null;

  return mapToCandidate(best);
}

/**
 * Used by Refill Logic: Get up to `limit` candidates, skipping active symbols.
 * Top 1 -> Active? -> Top 2 -> Active? -> Top 3 -> ...
 */
export async function getBestCandidates(
  params: { activeSymbols: Set<string>; minSpreadDecimal?: number; minTimeToFundingSec?: number },
  limit: number
): Promise<BestTradeCandidate[]> {
  const opportunities = getBestOpportunities();
  const candidates: BestTradeCandidate[] = [];
  const activeBaseKeys = new Set([...params.activeSymbols].map((s) => normalizeSymbol(s)));

  for (const op of opportunities) {
    if (candidates.length >= limit) break;

    // Skip if already active
    if (params.activeSymbols.has(op.symbol)) continue;
    if (activeBaseKeys.has(normalizeSymbol(op.symbol))) continue;

    const candidate = mapToCandidate(op);

    if (params.minTimeToFundingSec != null) {
      if (candidate.timeToFundingSec < params.minTimeToFundingSec) continue;
    }

    candidates.push(candidate);
  }

  return candidates;
}
