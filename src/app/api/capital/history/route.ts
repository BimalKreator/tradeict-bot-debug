import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/sqlite';

export type TransferRecord = {
  id: number;
  date: string;
  exchange: string;
  type: string;
  amount: number;
  timestamp: number;
};

/** GET: Fetch all records from transfer_history ordered by date DESC, timestamp DESC */
export async function GET() {
  try {
    const rows = db.db
      .prepare(
        `SELECT id, date, exchange, type, amount, timestamp FROM transfer_history ORDER BY date DESC, timestamp DESC`
      )
      .all() as TransferRecord[];

    return NextResponse.json(rows, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[API capital/history] GET error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch' },
      { status: 500 }
    );
  }
}

/** DELETE: Remove a record and revert daily_balance_snapshots */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const id = typeof body.id === 'number' ? body.id : parseInt(String(body.id), 10);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const row = db.db
      .prepare('SELECT id, date, exchange, type, amount FROM transfer_history WHERE id = ?')
      .get(id) as { id: number; date: string; exchange: string; type: string; amount: number } | undefined;

    if (!row) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    // Revert daily_balance_snapshots
    const snapshot = db.db
      .prepare('SELECT date, total_deposits, total_withdrawals FROM daily_balance_snapshots WHERE date = ?')
      .get(row.date) as { date: string; total_deposits: number; total_withdrawals: number } | undefined;

    if (snapshot) {
      if (row.type === 'DEPOSIT') {
        const newDeposits = Math.max(0, (snapshot.total_deposits ?? 0) - row.amount);
        db.db.prepare('UPDATE daily_balance_snapshots SET total_deposits = ? WHERE date = ?').run(newDeposits, row.date);
      } else if (row.type === 'WITHDRAWAL') {
        const newWithdrawals = Math.max(0, (snapshot.total_withdrawals ?? 0) - row.amount);
        db.db
          .prepare('UPDATE daily_balance_snapshots SET total_withdrawals = ? WHERE date = ?')
          .run(newWithdrawals, row.date);
      }
    }

    db.db.prepare('DELETE FROM transfer_history WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API capital/history] DELETE error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete' },
      { status: 500 }
    );
  }
}

/** PUT: Update a record and adjust daily_balance_snapshots */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const id = typeof body.id === 'number' ? body.id : parseInt(String(body.id), 10);
    const amount = parseFloat(body.amount);
    const date = String(body.date ?? '').trim();
    const type = String(body.type ?? '').toUpperCase();

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    if (!date || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid date or amount' }, { status: 400 });
    }

    if (type !== 'DEPOSIT' && type !== 'WITHDRAWAL') {
      return NextResponse.json({ error: 'type must be DEPOSIT or WITHDRAWAL' }, { status: 400 });
    }

    const existing = db.db
      .prepare('SELECT id, date, exchange, type, amount FROM transfer_history WHERE id = ?')
      .get(id) as { id: number; date: string; exchange: string; type: string; amount: number } | undefined;

    if (!existing) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    const oldAmount = existing.amount;
    const oldDate = existing.date;
    const oldType = existing.type;

    // Revert old date snapshot
    const oldSnapshot = db.db
      .prepare('SELECT date, total_deposits, total_withdrawals FROM daily_balance_snapshots WHERE date = ?')
      .get(oldDate) as { total_deposits: number; total_withdrawals: number } | undefined;

    if (oldSnapshot) {
      if (oldType === 'DEPOSIT') {
        const newDeposits = Math.max(0, (oldSnapshot.total_deposits ?? 0) - oldAmount);
        db.db.prepare('UPDATE daily_balance_snapshots SET total_deposits = ? WHERE date = ?').run(newDeposits, oldDate);
      } else if (oldType === 'WITHDRAWAL') {
        const newWithdrawals = Math.max(0, (oldSnapshot.total_withdrawals ?? 0) - oldAmount);
        db.db
          .prepare('UPDATE daily_balance_snapshots SET total_withdrawals = ? WHERE date = ?')
          .run(newWithdrawals, oldDate);
      }
    }

    // Ensure new date snapshot exists
    db.ensureTodaySnapshot();
    const newSnapshot = db.db
      .prepare('SELECT date, total_deposits, total_withdrawals FROM daily_balance_snapshots WHERE date = ?')
      .get(date);

    if (!newSnapshot) {
      const lastRow = db.db
        .prepare(
          'SELECT closing_balance, opening_balance FROM daily_balance_snapshots ORDER BY date DESC LIMIT 1'
        )
        .get() as { closing_balance: number | null; opening_balance: number } | undefined;
      const opening = lastRow?.closing_balance ?? lastRow?.opening_balance ?? 0;
      db.db
        .prepare(
          'INSERT INTO daily_balance_snapshots (date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage) VALUES (?, ?, NULL, 0, 0, 0)'
        )
        .run(date, opening);
    }

    // Apply new amount to new date
    if (type === 'DEPOSIT') {
      db.db
        .prepare('UPDATE daily_balance_snapshots SET total_deposits = total_deposits + ? WHERE date = ?')
        .run(amount, date);
    } else {
      db.db
        .prepare('UPDATE daily_balance_snapshots SET total_withdrawals = total_withdrawals + ? WHERE date = ?')
        .run(amount, date);
    }

    // If date changed, revert old date's contribution (already done above)
    // Update transfer_history
    db.db
      .prepare('UPDATE transfer_history SET date = ?, type = ?, amount = ?, timestamp = ? WHERE id = ?')
      .run(date, type, amount, Date.now(), id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API capital/history] PUT error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update' },
      { status: 500 }
    );
  }
}
