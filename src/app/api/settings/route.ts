import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/db/sqlite';
import { refreshSettings } from '../../../lib/state/global-state';

const ALLOWED_KEYS = [
  'auto_entry_enabled',
  'auto_exit_enabled',
  'max_capital_percent',
  'min_spread_percent',
  'leverage',
  'liquidation_buffer',
  'negative_funding_exit',
  'mtm_stoploss_enabled',
  'mtm_stoploss_percent',
  'manual_trading_enabled',
] as const;

export async function GET() {
  try {
    const row = db.db.prepare('SELECT * FROM bot_settings WHERE id = 1').get();
    if (!row) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 });
    }
    return NextResponse.json(row, {
      headers: { 'Cache-Control': 'private, max-age=5' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid body' },
        { status: 400 }
      );
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    for (const key of ALLOWED_KEYS) {
      if (!(key in body)) continue;
      const value = body[key];
      if (value === undefined) continue;
      updates.push(`${key} = ?`);
      values.push(
        key === 'auto_entry_enabled' ||
        key === 'auto_exit_enabled' ||
        key === 'negative_funding_exit' ||
        key === 'mtm_stoploss_enabled' ||
        key === 'manual_trading_enabled'
          ? (value ? 1 : 0)
          : Number(value)
      );
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: true });
    }

    const sql = `UPDATE bot_settings SET ${updates.join(', ')} WHERE id = 1`;
    db.db.prepare(sql).run(...values);
    refreshSettings();

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
