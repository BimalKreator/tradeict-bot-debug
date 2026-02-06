import { NextResponse } from 'next/server';
import { closeTradeAsUser } from '@/lib/exit/controller';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { symbol } = body;

    if (!symbol || typeof symbol !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: symbol' },
        { status: 400 }
      );
    }

    const result = await closeTradeAsUser(symbol);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error ?? 'Close failed', results: result.results },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Close failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
