import { NextResponse } from 'next/server';
import { ExchangeManager } from '../../../lib/exchanges/manager';
import {
  getBestOpportunities,
  refreshScreenerCache,
  getCommonTokens,
  calculateFundingSpreads,
} from '../../../lib/utils/screener';

/**
 * Returns cached opportunities. If cache empty, awaits refresh then fallback direct fetch.
 */
export async function GET() {
  let opportunities = getBestOpportunities({ forceRefresh: false });
  const cacheStatus = opportunities.length > 0 ? 'hit' : 'empty';
  console.log(`[Screener API] Cache status: ${cacheStatus}, count: ${opportunities.length}`);

  if (opportunities.length === 0) {
    console.log('[Screener API] Cache empty, awaiting refresh...');
    await refreshScreenerCache();
    opportunities = getBestOpportunities({ forceRefresh: false });
  }

  if (opportunities.length === 0) {
    console.log('[Screener API] Still empty after refresh, fallback direct fetch...');
    try {
      const manager = new ExchangeManager();
      const { binance: binanceRates, bybit: bybitRates } = await manager.getFundingRates();
      const commonTokens = getCommonTokens(binanceRates, bybitRates);
      opportunities = calculateFundingSpreads(commonTokens, binanceRates, bybitRates);
      console.log(`[Screener API] Fallback fetch returned ${opportunities.length} opportunities.`);
    } catch (err) {
      console.warn('[Screener API] Fallback fetch failed:', err);
    }
  }

  const isCached = opportunities.length > 0 && cacheStatus === 'hit';
  return NextResponse.json(opportunities, {
    headers: {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=59',
      'X-Cached': isCached ? 'true' : 'false',
    },
  });
}
