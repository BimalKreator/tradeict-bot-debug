import { NextResponse } from 'next/server';
import { ExchangeManager } from '../../../lib/exchanges/manager';
import { getCommonTokens, calculateFundingSpreads } from '../../../lib/utils/screener';

// In-memory cache for this API route
let opportunityCache: any[] = [];
let lastFetch = 0;
const CACHE_TTL = 30000; // 30 seconds

export async function GET() {
  try {
    console.log('[API Screener] Request received at:', new Date().toISOString());

    const now = Date.now();

    // Always fetch fresh if cache is empty or stale
    if (opportunityCache.length === 0 || (now - lastFetch > CACHE_TTL)) {
      console.log('[API Screener] Fetching fresh data from exchanges...');

      const manager = new ExchangeManager();
      const { binance: binanceRates, bybit: bybitRates } = await manager.getFundingRates();

      const binanceCount = Object.keys(binanceRates).length;
      const bybitCount = Object.keys(bybitRates).length;
      console.log(`[API Screener] Fetched: ${binanceCount} Binance, ${bybitCount} Bybit symbols`);

      if (binanceCount === 0 || bybitCount === 0) {
        console.error('[API Screener] CRITICAL: One or both exchanges returned empty data');
        return NextResponse.json([], {
          status: 200,
          headers: {
            'X-Error': 'Exchange data empty',
            'Cache-Control': 'no-cache'
          }
        });
      }

      const commonTokens = getCommonTokens(binanceRates, bybitRates);
      console.log(`[API Screener] Common tokens: ${commonTokens.length}`);

      if (commonTokens.length === 0) {
        console.error('[API Screener] CRITICAL: No common tokens found between exchanges');
        // Debug: Show sample symbols from each exchange
        console.log('[API Screener] Binance samples:', Object.keys(binanceRates).slice(0, 5));
        console.log('[API Screener] Bybit samples:', Object.keys(bybitRates).slice(0, 5));
      }

      opportunityCache = calculateFundingSpreads(commonTokens, binanceRates, bybitRates);
      console.log(`[API Screener] Calculated opportunities: ${opportunityCache.length}`);

      // Log first few for debugging
      if (opportunityCache.length > 0) {
        console.log('[API Screener] Top 3:', opportunityCache.slice(0, 3).map((o: any) => ({
          symbol: o.symbol,
          spread: (o.spread * 100).toFixed(4) + '%',
          interval: o.interval
        })));
      } else {
        console.log('[API Screener] No opportunities - checking why...');
        // Check interval mismatches
        let mismatchCount = 0;
        for (const symbol of commonTokens.slice(0, 10)) {
          const b = binanceRates[symbol];
          const by = bybitRates[symbol];
          const bInt = b?.interval || b?.info?.fundingInterval;
          const byInt = by?.interval || by?.info?.fundingInterval;
          if (bInt !== byInt) {
            mismatchCount++;
            if (mismatchCount <= 3) {
              console.log(`[API Screener] Interval mismatch ${symbol}: Binance=${bInt}, Bybit=${byInt}`);
            }
          }
        }
        if (mismatchCount > 0) {
          console.log(`[API Screener] Total interval mismatches in first 10: ${mismatchCount}`);
        }
      }

      lastFetch = now;
    } else {
      console.log(`[API Screener] Using cache (${Math.round((now - lastFetch)/1000)}s old)`);
    }

    return NextResponse.json(opportunityCache, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=59',
        'X-Opportunities-Count': String(opportunityCache.length),
        'X-Cache-Age': String(Math.round((now - lastFetch)/1000))
      },
    });
  } catch (err) {
    console.error('[API Screener] Unhandled error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
