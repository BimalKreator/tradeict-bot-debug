import { NextResponse } from 'next/server';
import { ExchangeManager } from '@/lib/exchanges/manager';

/**
 * POST: Test exchange connection (fetchBalance / getAggregatedBalances).
 * Call this separately from GET /api/settings so the Settings page loads instantly.
 */
export async function POST() {
  try {
    const manager = new ExchangeManager();
    const agg = await manager.getAggregatedBalances();
    return NextResponse.json({
      ok: true,
      binance: agg.binance,
      bybit: agg.bybit,
      total: agg.total,
      dataComplete: agg.dataComplete,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
