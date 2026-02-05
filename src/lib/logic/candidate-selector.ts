import type { FundingSpreadOpportunity } from '../utils/screener';
import { ExchangeManager } from '../exchanges/manager';
import { getCommonTokens, calculateFundingSpreads } from '../utils/screener';
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
  displaySpreadPercent: string;
  interval: string;
  timeToFundingMs: number;
  timeToFundingSec: number;
  expectedEntryTime: Date;
  nextFundingAt: Date;
  opportunity: FundingSpreadOpportunity;
  isAsymmetric: boolean;
  score: number;
}

export interface CandidateSelectorInput {
  activeSymbols: Set<string>;
  minSpreadDecimal: number;
  minTimeToFundingSec?: number;
}

function oppToCandidate(opp: FundingSpreadOpportunity): BestTradeCandidate {
  const timeToFundingMs = getTimeToNextFundingMs(opp.primaryInterval);
  const nextFundingAt = new Date(Date.now() + timeToFundingMs);
  const expectedEntryTime = new Date(nextFundingAt.getTime() - 2 * 60 * 1000);
  
  return {
    symbol: opp.symbol,
    spread: opp.spread,
    spreadPercent: (opp.spread * 100).toFixed(4),
    displaySpreadPercent: (opp.displaySpread * 100).toFixed(4),
    interval: opp.primaryInterval,
    timeToFundingMs,
    timeToFundingSec: Math.round(timeToFundingMs / 1000),
    expectedEntryTime,
    nextFundingAt,
    opportunity: opp,
    isAsymmetric: opp.isAsymmetric,
    score: opp.score
  };
}

const SCREENER_TOP_N = 50;

export async function getBestCandidates(input: CandidateSelectorInput, limit: number): Promise<BestTradeCandidate[]> {
  const { activeSymbols, minTimeToFundingSec } = input;

  const manager = new ExchangeManager();
  const { binance: binanceRates, bybit: bybitRates } = await manager.getFundingRates();
  const commonTokens = getCommonTokens(binanceRates, bybitRates);
  const opportunities = calculateFundingSpreads(commonTokens, binanceRates, bybitRates);

  const eligible: FundingSpreadOpportunity[] = [];
  const activeBaseKeys = new Set([...activeSymbols].map(normalizeSymbol));

  for (const opp of opportunities) {
    const candidateBaseKey = normalizeSymbol(opp.symbol);
    if (activeBaseKeys.has(candidateBaseKey)) continue;
    if (activeSymbols.has(opp.symbol)) continue;
    if (activeSymbols.has(candidateBaseKey)) continue;
    
    if (minTimeToFundingSec != null) {
      const timeToFundingMs = getTimeToNextFundingMs(opp.primaryInterval);
      if (timeToFundingMs < minTimeToFundingSec * 1000) continue;
    }
    
    eligible.push(opp);
  }

  const topFromScreener = eligible.slice(0, SCREENER_TOP_N);
  
  const seenBases = new Set<string>();
  const unique: FundingSpreadOpportunity[] = [];
  
  for (const opp of topFromScreener) {
    const baseKey = normalizeSymbol(opp.symbol);
    if (seenBases.has(baseKey)) continue;
    seenBases.add(baseKey);
    unique.push(opp);
    if (unique.length >= limit) break;
  }
  
  return unique.slice(0, limit).map(oppToCandidate);
}

export async function getBestTradeCandidate(input: CandidateSelectorInput): Promise<BestTradeCandidate | null> {
  const candidates = await getBestCandidates(input, 1);
  return candidates[0] ?? null;
}