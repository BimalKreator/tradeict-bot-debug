import { NextResponse } from 'next/server';
import type { DualTradeSides } from '@/lib/exchanges/manager';
import { ExchangeManager } from '@/lib/exchanges/manager';
import { addNotification } from '@/lib/db/notifications';
import { db } from '@/lib/db/sqlite';

function mapDirectionToSides(direction: string): DualTradeSides {
  const normalized = direction.toLowerCase().replace(/[\s/]/g, '');
  if (normalized === 'longbinance_shortbybit' || normalized === 'longbinanceshortbybit') {
    return { binance: 'BUY', bybit: 'SELL' };
  }
  if (normalized === 'longbybit_shortbinance' || normalized === 'longbybitshortbinance') {
    return { binance: 'SELL', bybit: 'BUY' };
  }
  throw new Error(`Invalid direction: ${direction}. Use 'LongBinance_ShortBybit' or 'LongBybit_ShortBinance'`);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { symbol, quantity, leverage, direction, isManual } = body;

    if (!symbol || quantity == null || leverage == null || !direction) {
      return NextResponse.json(
        { error: 'Missing required fields: symbol, quantity, leverage, direction' },
        { status: 400 }
      );
    }

    if (isManual) {
      const row = db.db.prepare('SELECT manual_trading_enabled FROM bot_settings WHERE id = 1').get() as { manual_trading_enabled: number } | undefined;
      if (!row || row.manual_trading_enabled !== 1) {
        return NextResponse.json(
          { error: 'Manual trading is disabled. Enable it in Settings.' },
          { status: 403 }
        );
      }
    }

    const qty = Number(quantity);
    const lev = Number(leverage);
    if (isNaN(qty) || qty <= 0 || isNaN(lev) || lev < 1) {
      return NextResponse.json(
        { error: 'Invalid quantity or leverage' },
        { status: 400 }
      );
    }

    const sides = mapDirectionToSides(direction);

    // Ensure symbol has full format for futures
    const symbolFormatted = symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`;

    const manager = new ExchangeManager();
    const result = await manager.executeDualTrade(symbolFormatted, qty, lev, sides);

    const base = symbolFormatted.includes('/') ? symbolFormatted.split('/')[0] : symbolFormatted;
    addNotification('SUCCESS', `Opened trade for ${base}`);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Trade execution failed';
    addNotification('ERROR', `Trade entry failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
