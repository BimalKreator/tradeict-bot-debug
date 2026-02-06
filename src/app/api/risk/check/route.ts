import { NextResponse } from 'next/server';
import { ExchangeManager } from '@/lib/exchanges/manager';
import { PositionTracker } from '@/lib/exchanges/position-tracker';
import { checkHedgeIntegrity } from '@/lib/risk/monitor';

export async function GET() {
  try {
    const tracker = new PositionTracker();
    const manager = new ExchangeManager();
    const { positions, dataComplete } = await tracker.getGroupedPositions({ withDataComplete: true, forceRefresh: false });
    const result = await checkHedgeIntegrity(positions, manager, { dataComplete });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[API /api/risk/check] Error:', err);
    return NextResponse.json(
      { error: 'Risk check failed' },
      { status: 500 }
    );
  }
}
