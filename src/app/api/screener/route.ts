import { NextResponse } from 'next/server';
import { getBestOpportunities, refreshScreenerCache, getCacheAge } from '@/lib/utils/screener';
import { db } from '@/lib/db/sqlite';

export async function GET() {
  try {
    console.log('[API Screener] Request received');

    const settingsRow = db.db.prepare('SELECT min_spread_percent FROM bot_settings WHERE id = 1').get() as { min_spread_percent: number } | undefined;
    const minSpreadPercent = settingsRow?.min_spread_percent ?? 0;
    const minSpreadDecimal = minSpreadPercent / 100;

    let opportunities = getBestOpportunities();
    const cacheAge = getCacheAge();

    // Cold cache: await refresh so first load always gets data (user waits 2–3s but sees data)
    if (opportunities.length === 0) {
      console.log('[API Screener] Cache empty, awaiting refresh...');
      await refreshScreenerCache(minSpreadDecimal);
      opportunities = getBestOpportunities();
    }
    // Stale but non-empty: return stale immediately and refresh in background
    else if (cacheAge > 60) {
      refreshScreenerCache(minSpreadDecimal)
        .then(() => console.log('[API Screener] Background refresh completed'))
        .catch((e) => console.warn('[API Screener] Background refresh failed:', e));
      // opportunities already set from getBestOpportunities() above
    }

    // Return all opportunities, capped at 50 for UI (no .slice(0, 5) limit)
    const formatted = opportunities.slice(0, 50).map((opp) => ({
      symbol: opp.symbol,
      spread: opp.spread,
      displaySpread: opp.displaySpread,
      netSpread: opp.netSpread,
      minSpreadUsed: opp.minSpreadUsed,
      nextFundingTime: opp.nextFundingTime,
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
      strategy: opp.strategy,
      score: opp.score,
      spreadDisplay: `${(opp.displaySpread * 100).toFixed(4)}%`,
      direction: `Long ${opp.longExchange} / Short ${opp.shortExchange}`,
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