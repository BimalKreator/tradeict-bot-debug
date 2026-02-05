import { NextResponse } from 'next/server';
import { getBestOpportunities, refreshScreenerCache, getCacheAge } from '../../../lib/utils/screener';

export async function GET() {
  try {
    console.log('[API Screener] Request received');
    
    let opportunities = getBestOpportunities();
    
    if (opportunities.length === 0 || getCacheAge() > 60) {
      console.log('[API Screener] Cache empty/stale, refreshing...');
      await refreshScreenerCache();
      opportunities = getBestOpportunities();
    }
    
    // Return full list of opportunities (no .slice limit) so dashboard shows all 50+
    const formatted = opportunities.map(opp => ({
      symbol: opp.symbol,
      spread: opp.spread,
      displaySpread: opp.displaySpread,
      binanceRate: opp.binanceRate,
      bybitRate: opp.bybitRate,
      binancePrice: opp.binancePrice,
      bybitPrice: opp.bybitPrice,
      longExchange: opp.longExchange,
      shortExchange: opp.shortExchange,
      interval: opp.primaryInterval,
      primaryInterval: opp.primaryInterval,
      binanceInterval: opp.binanceInterval,
      bybitInterval: opp.bybitInterval,
      isAsymmetric: opp.isAsymmetric,
      score: opp.score,
      spreadDisplay: `${(opp.displaySpread * 100).toFixed(4)}%`,
      direction: `Long ${opp.longExchange} / Short ${opp.shortExchange}`,
      advantage: opp.isAsymmetric ? 'Freq. Funding (1h/2h)' : 'Spread Arb. (4h)'
    }));
    
    return NextResponse.json(formatted, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=59',
        'X-Opportunities-Count': String(formatted.length),
        'X-Cache-Age': String(getCacheAge()),
      },
    });
  } catch (err) {
    console.error('[API Screener] Error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}