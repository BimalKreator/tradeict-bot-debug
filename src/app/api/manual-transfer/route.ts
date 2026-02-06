import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/sqlite';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, exchange, type, amount } = body;
    const numAmount = parseFloat(amount);

    if (!date || !amount || isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    if (type !== 'DEPOSIT' && type !== 'WITHDRAWAL') {
      return NextResponse.json(
        { error: 'type must be DEPOSIT or WITHDRAWAL' },
        { status: 400 }
      );
    }

    // 1. Ensure table exists (migration handles this, but safe fallback)
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS transfer_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        exchange TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    // 2. Record history
    db.db
      .prepare(
        `INSERT INTO transfer_history (date, exchange, type, amount, timestamp) VALUES (?, ?, ?, ?, ?)`
      )
      .run(date, exchange ?? 'UNKNOWN', type, numAmount, Date.now());

    // 3. Update snapshot (create if missing)
    const existing = db.db
      .prepare('SELECT * FROM daily_balance_snapshots WHERE date = ?')
      .get(date);

    if (!existing) {
      const lastRow = db.db
        .prepare(
          'SELECT closing_balance, opening_balance FROM daily_balance_snapshots ORDER BY date DESC LIMIT 1'
        )
        .get() as { closing_balance: number | null; opening_balance: number } | undefined;
      const opening = lastRow?.closing_balance ?? lastRow?.opening_balance ?? 0;

      db.db
        .prepare(
          `INSERT INTO daily_balance_snapshots (date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage) VALUES (?, ?, NULL, 0, 0, 0)`
        )
        .run(date, opening);
    }

    if (type === 'DEPOSIT') {
      db.db
        .prepare(
          `UPDATE daily_balance_snapshots SET total_deposits = total_deposits + ? WHERE date = ?`
        )
        .run(numAmount, date);
    } else {
      db.db
        .prepare(
          `UPDATE daily_balance_snapshots SET total_withdrawals = total_withdrawals + ? WHERE date = ?`
        )
        .run(numAmount, date);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Manual Transfer Error]', error);
    const message =
      error instanceof Error ? error.message : 'Failed to record transfer';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
