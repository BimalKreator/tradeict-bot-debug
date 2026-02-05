import { NextResponse } from 'next/server';
import { getBestTradeCandidate } from '@/lib/logic/candidate-selector';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const candidate = await getBestTradeCandidate();

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
