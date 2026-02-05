import { NextResponse } from 'next/server';
import { db } from '@/lib/db/sqlite';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export interface TradeHistoryRow {
  id: number;
  symbol: string;
  leverage: number;
  quantity: number;
  entry_price_long: number | null;
  entry_price_short: number | null;
  exit_price_long: number | null;
  exit_price_short: number | null;
  pnl_long: number | null;
  pnl_short: number | null;
  net_pnl: number;
  funding_received: number;
  exit_reason: string;
  executed_by: string;
  entry_time: string;
  exit_time: string;
}

/**
 * Returns all records from trade_history, newest first.
 */
export async function GET() {
  try {
    const rows = db.db
      .prepare(
        `SELECT id, symbol, leverage, quantity,
                entry_price_long, entry_price_short,
                exit_price_long, exit_price_short,
                pnl_long, pnl_short, net_pnl,
                funding_received, exit_reason, executed_by,
                entry_time, exit_time
           FROM trade_history
          ORDER BY exit_time DESC`
      )
      .all() as TradeHistoryRow[];

    return NextResponse.json(rows, {
      headers: { 'Cache-Control': 'private, max-age=3' },
    });
  } catch (err) {
    console.error('[API /api/history] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch history' },
      { status: 500 }
    );
  }
}
