import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/sqlite';

export async function POST(req: NextRequest) {
  if (req.method !== 'POST') return NextResponse.json(null, { status: 405 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { date, exchange, type, amount } = body as {
    date?: string;
    exchange?: string;
    type?: string;
    amount?: string | number;
  };

  const numAmount = parseFloat(String(amount ?? ''));

  if (!date || !amount || isNaN(numAmount) || numAmount <= 0) {
    return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
  }

  const validType = type === 'DEPOSIT' || type === 'WITHDRAWAL';
  if (!validType) {
    return NextResponse.json({ error: 'type must be DEPOSIT or WITHDRAWAL' }, { status: 400 });
  }

  try {
    // 1. Create transfer_history table if not exists
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

    // 2. Insert record
    db.db
      .prepare(
        `INSERT INTO transfer_history (date, exchange, type, amount, timestamp) VALUES (?, ?, ?, ?, ?)`
      )
      .run(date, exchange ?? 'UNKNOWN', type, numAmount, Date.now());

    // 3. Ensure snapshot exists for date
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

    // 4. Update daily snapshot (aggregate)
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

    // 5. Recalculate growth_percentage for today (use ledger, no exchange API)
    const todayStr = db.getISTDate();
    if (date === todayStr) {
      const ledgerRow = db.db
        .prepare('SELECT total_balance FROM daily_ledger ORDER BY date DESC LIMIT 1')
        .get() as { total_balance: number } | undefined;
      const currentTotal = ledgerRow?.total_balance ?? 0;

      const snap = db.db
        .prepare(
          'SELECT opening_balance, total_deposits, total_withdrawals FROM daily_balance_snapshots WHERE date = ?'
        )
        .get(date) as {
          opening_balance: number;
          total_deposits: number;
          total_withdrawals: number;
        } | undefined;

      if (snap) {
        const growthAmt =
          currentTotal -
          snap.opening_balance -
          snap.total_deposits +
          snap.total_withdrawals;
        const growthPct =
          snap.opening_balance > 0
            ? (growthAmt * 100) / snap.opening_balance
            : 0;

        db.db
          .prepare(
            `UPDATE daily_balance_snapshots SET growth_percentage = ? WHERE date = ?`
          )
          .run(growthPct, date);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API /manual-transfer] Error:', err);
    const message = err instanceof Error ? err.message : 'Failed to record transfer';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
