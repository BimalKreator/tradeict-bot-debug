import { NextResponse } from 'next/server';
import { ExchangeManager } from '@/lib/exchanges/manager';

export const revalidate = 0;

export async function GET() {
  console.log('API /balance called');
  console.log(
    '[API /balance] BINANCE_API_KEY:',
    process.env.BINANCE_API_KEY ? 'Key Found' : 'Key Missing'
  );

  try {
    const manager = new ExchangeManager();
    const balances = await manager.getAggregatedBalances();
    return NextResponse.json(balances, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err) {
    console.error('Balance API Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch balances' },
      { status: 500 }
    );
  }
}
