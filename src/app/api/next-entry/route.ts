import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/sqlite';
import { getBestCandidates, normalizeSymbol } from '@/lib/logic/candidate-selector';
import { calculateAllocation } from '@/lib/entry/allocator';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Returns eligible trading candidates for the next entry (Top 1, Top 2, ... Top N).
 * N = slots_available = 3 - active_trades.length. These are the tokens that will be
 * taken on next entry time when the sniper window hits.
 */
export async function GET(request: NextRequest) {
  try {
    const settings = db.db
      .prepare(
        'SELECT min_spread_percent, max_capital_percent, leverage FROM bot_settings WHERE id = 1'
      )
      .get() as
      | { min_spread_percent: number; max_capital_percent: number; leverage: number }
      | undefined;
    const minSpreadPercent = settings?.min_spread_percent ?? 0.075;
    const minSpreadDecimal = minSpreadPercent / 100;

    const activeRows = db.db
      .prepare('SELECT symbol FROM active_trades WHERE status = ?')
      .all('ACTIVE') as { symbol: string }[];

    const slotsNeeded = Math.max(0, 3 - activeRows.length);
    if (slotsNeeded <= 0) {
      return NextResponse.json({
        candidates: [],
        reason: 'All slots occupied',
      });
    }

    const activeSymbols = new Set<string>();
    for (const row of activeRows) {
      const sym = row.symbol;
      activeSymbols.add(sym);
      activeSymbols.add(sym.split('/')[0]);
    }

    const candidates = await getBestCandidates(
      { activeSymbols, minSpreadDecimal },
      slotsNeeded
    );

    if (candidates.length === 0) {
      return NextResponse.json({
        candidates: [],
        reason: 'No eligible token (spread below min or all slots occupied)',
      });
    }

    const leverage = settings?.leverage ?? 1;
    const resultCandidates = await Promise.all(
      candidates.map(async (c) => {
        const avgPrice =
          (c.opportunity.binancePrice + c.opportunity.bybitPrice) / 2 ||
          c.opportunity.binancePrice ||
          c.opportunity.bybitPrice;
        const alloc = await calculateAllocation(avgPrice);
        const sec = c.timeToFundingSec;
        const timeDisplay =
          sec >= 3600
            ? `${Math.floor(sec / 3600)}h`
            : sec >= 60
              ? `${Math.floor(sec / 60)}m`
              : `${sec}s`;

        return {
          symbol: c.symbol,
          symbol_base: normalizeSymbol(c.symbol),
          spread: c.spread,
          spread_percent: c.spreadPercent,
          interval: c.interval,
          time_to_funding_sec: c.timeToFundingSec,
          time_display: timeDisplay,
          next_funding_at: c.nextFundingAt.toISOString(),
          expected_entry_time: c.expectedEntryTime.toISOString(),
          quantity: alloc.quantity,
          capital_used: alloc.capitalUsed,
          avg_price: avgPrice,
        };
      })
    );

    return NextResponse.json({
      candidates: resultCandidates,
      leverage,
      slots_available: slotsNeeded,
    });
  } catch (err) {
    console.error('[API /api/next-entry] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch next entry' },
      { status: 500 }
    );
  }
}
