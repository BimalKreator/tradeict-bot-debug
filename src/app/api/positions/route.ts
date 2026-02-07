import { NextResponse } from 'next/server';
import { PositionTracker } from '@/lib/exchanges/position-tracker';
import { getActiveTradesCached, type ActiveTradeRow } from '@/lib/cache/positions-cache';

const TOTAL_SLOTS = 3;

function normalizeSymbol(symbol: string): string {
  if (!symbol) return '';
  const s = symbol.trim().toUpperCase();
  if (s.includes('/')) return s.split('/')[0];
  return s.replace(/USDT:?USDT?$/i, '');
}

/** Prefer data availability over speed: allow up to 40s for exchange responses (e.g. Binance >20s). */
const POSITIONS_UI_TIMEOUT_MS = 40_000;

export async function GET() {
  console.log('API /positions called');

  try {
    const { used, rows: activeRows } = getActiveTradesCached();
    const availableSlots = Math.max(0, TOTAL_SLOTS - used);

    const tracker = new PositionTracker();
    let result: Awaited<ReturnType<PositionTracker['getGroupedPositions']>>;
    try {
      result = await Promise.race([
        tracker.getGroupedPositions({
          withDataComplete: true,
          forceRefresh: false,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Positions fetch timeout')), POSITIONS_UI_TIMEOUT_MS)
        ),
      ]);
    } catch (timeoutOrErr) {
      if (String(timeoutOrErr).includes('timeout')) {
        console.warn('[API /positions] Fetch timed out after 40s, returning empty positions');
        result = { positions: [], dataComplete: false };
      } else {
        throw timeoutOrErr;
      }
    }
    const { positions } = result;
    const tradeBySymbol = new Map<string, ActiveTradeRow>();
    for (const r of activeRows) {
      tradeBySymbol.set(r.symbol, r);
      tradeBySymbol.set(normalizeSymbol(r.symbol), r);
    }

    const enriched = positions.map((p) => {
      const trade = tradeBySymbol.get(p.symbol) ?? tradeBySymbol.get(normalizeSymbol(p.symbol));
      const longAcc = trade?.long_funding_acc ?? 0;
      const shortAcc = trade?.short_funding_acc ?? 0;
      const totalFunding = trade?.funding_received ?? (longAcc + shortAcc);
      return {
        ...p,
        funding_received: totalFunding,
        long_funding_acc: longAcc,
        short_funding_acc: shortAcc,
        next_funding_time: trade?.next_funding_time ?? null,
        liquidation_binance: trade?.liquidation_binance ?? null,
        liquidation_bybit: trade?.liquidation_bybit ?? null,
        leverage: trade?.leverage ?? 1,
        quantity: trade?.quantity ?? null,
        entry_price_binance: trade?.entry_price_binance ?? null,
        entry_price_bybit: trade?.entry_price_bybit ?? null,
        long_exchange: trade?.long_exchange ?? null,
        short_exchange: trade?.short_exchange ?? null,
      };
    });

    return NextResponse.json(
      {
        slots: { total: TOTAL_SLOTS, used, available: availableSlots },
        active_trades: used,
        positions: enriched,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (err) {
    console.error('[API /api/positions] Error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch positions';
    const isInitialFetch = message === 'Initial fetch failed';
    return NextResponse.json(
      { error: message },
      { status: isInitialFetch ? 503 : 500 }
    );
  }
}
