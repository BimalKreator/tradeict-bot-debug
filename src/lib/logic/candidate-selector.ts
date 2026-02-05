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

  // Time fields required by next-entry
  timeToFundingSec: number;
  nextFundingAt: Date;
  expectedEntryTime: Date;
}

/** Helper to map Opportunity -> Candidate with Time */
function mapToCandidate(opp: FundingSpreadOpportunity): BestTradeCandidate {
  const msToFunding = getTimeToNextFundingMs(opp.primaryInterval);
  const nextFundingAt = new Date(Date.now() + msToFunding);
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
    timeToFundingSec: Math.floor(msToFunding / 1000),
    nextFundingAt,
    expectedEntryTime,
  };
}

export interface CandidateSelectorInput {
  activeSymbols: Set<string>;
  minSpreadDecimal?: number;
  minTimeToFundingSec?: number;
}

/**
 * Returns a list of best candidates (used by next-entry / auto-trade)
 */
export async function getBestCandidates(
  input: CandidateSelectorInput,
  limit: number
): Promise<BestTradeCandidate[]> {
  const { activeSymbols, minTimeToFundingSec } = input;
  const opportunities = getBestOpportunities();

  const eligible: BestTradeCandidate[] = [];
  const activeBaseKeys = new Set([...activeSymbols].map((s) => normalizeSymbol(s)));

  for (const opp of opportunities) {
    const base = normalizeSymbol(opp.symbol);
    if (activeSymbols.has(opp.symbol) || activeBaseKeys.has(base)) continue;

    if (minTimeToFundingSec != null) {
      const msToFunding = getTimeToNextFundingMs(opp.primaryInterval);
      if (msToFunding < minTimeToFundingSec * 1000) continue;
    }

    eligible.push(mapToCandidate(opp));
  }

  // Sort by score and take top N
  eligible.sort((a, b) => b.score - a.score);
  return eligible.slice(0, limit);
}

/**
 * Returns the single best candidate for the "Next to Trade" UI slot
 */
export async function getBestTradeCandidate(): Promise<BestTradeCandidate | null> {
  const opportunities = getBestOpportunities();
  if (opportunities.length === 0) return null;

  const sorted = [...opportunities].sort((a, b) => b.score - a.score);
  return mapToCandidate(sorted[0]);
}
