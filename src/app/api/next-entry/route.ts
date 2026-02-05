import { NextResponse } from 'next/server';
import { getBestTradeCandidate } from '@/lib/logic/candidate-selector';
import { db } from '@/lib/db/sqlite';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const activeRows = db.db
      .prepare("SELECT symbol FROM active_trades WHERE status = 'ACTIVE'")
      .all() as { symbol: string }[];
    const activeSymbols = new Set<string>();
    for (const row of activeRows) {
      activeSymbols.add(row.symbol);
      activeSymbols.add(row.symbol.split('/')[0]);
    }
    const candidate = await getBestTradeCandidate(activeSymbols);

    if (!candidate) {
      return NextResponse.json({
        message: 'No opportunities',
        readyToTrade: false,
      });
    }

    return NextResponse.json({
      symbol: candidate.symbol,
      spread: candidate.spread,
      spreadPercent: candidate.spreadPercent,
      interval: candidate.interval,
      score: candidate.score,
      longExchange: candidate.longExchange,
      shortExchange: candidate.shortExchange,
      readyToTrade: candidate.readyToTrade,
      opportunity: candidate.opportunity,
    });
  } catch (error) {
    console.error('[API Next-Entry] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
