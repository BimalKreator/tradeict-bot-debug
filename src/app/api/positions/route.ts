import { NextResponse } from 'next/server';
import { PositionTracker } from '../../../lib/exchanges/position-tracker';
import { db } from '../../../lib/db/sqlite';

const TOTAL_SLOTS = 3;

function normalizeSymbol(symbol: string): string {
  if (!symbol || typeof symbol !== 'string') return '';
  const s = symbol.trim();
  if (s.includes('/')) return s.split('/')[0].trim();
  return s.replace(/USDT:?USDT?$/i, '').replace(/USDT$/i, '').trim() || s;
}

export async function GET() {
  console.log('API /positions called');

  try {
    const countRow = db.db
      .prepare(
        "SELECT COUNT(*) as count FROM active_trades WHERE status = 'ACTIVE'"
      )
      .get() as { count: number };
    const used = Number(countRow?.count ?? 0);
    const availableSlots = Math.max(0, TOTAL_SLOTS - used);

    const tracker = new PositionTracker();
    const { positions } = await tracker.getGroupedPositions({
      withDataComplete: true,
      forceRefresh: false,
    });

    type ActiveTradeRow = {
      symbol: string;
      funding_received: number | null;
      long_funding_acc: number | null;
      short_funding_acc: number | null;
      next_funding_time: string | null;
      liquidation_binance: number | null;
      liquidation_bybit: number | null;
      leverage: number | null;
      quantity: number | null;
      entry_price_binance: number | null;
      entry_price_bybit: number | null;
      long_exchange: string | null;
      short_exchange: string | null;
    };
    const activeRows = db.db
      .prepare(
        `SELECT symbol, funding_received, long_funding_acc, short_funding_acc, next_funding_time, liquidation_binance, liquidation_bybit, leverage, quantity, entry_price_binance, entry_price_bybit, long_exchange, short_exchange FROM active_trades WHERE status = 'ACTIVE'`
      )
      .all() as ActiveTradeRow[];
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
