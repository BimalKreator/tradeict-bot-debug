import { ExchangeManager } from '../exchanges/manager';
import { db } from '../db/sqlite';

/** Historic date: hardcoded opening balance (user request). */
const HISTORIC_OPENING_DATE = '2026-02-03';
const HISTORIC_OPENING_BALANCE = 95;

/**
 * Take 00:00 IST snapshot into daily_ledger. Call at 18:30 UTC (= 00:00 IST).
 * Inserts the NEW day's date (IST) with current total balance.
 */
export async function runDailyLedgerSnapshot(): Promise<void> {
  const manager = new ExchangeManager();
  const balances = await manager.getAggregatedBalances();
  const totalBalance = balances.total;
  const date = db.getISTDate(0);

  db.db
    .prepare(
      'INSERT OR REPLACE INTO daily_ledger (date, total_balance, created_at) VALUES (?, ?, ?)'
    )
    .run(date, totalBalance, new Date().toISOString());
  console.log(`📸 Daily Snapshot taken for ${date}: $${totalBalance.toFixed(2)}`);
}

function getUTCHourMinute(): { hour: number; minute: number } {
  const now = new Date();
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  return { hour, minute };
}

let lastLedgerSnapshotDate = '';

/**
 * Call every minute; at 18:30 UTC (00:00 IST) take ledger snapshot.
 */
export function maybeRunDailyLedgerSnapshot(): void {
  const { hour, minute } = getUTCHourMinute();
  const date = db.getISTDate(0);
  if (hour === 18 && minute >= 30 && minute < 32 && lastLedgerSnapshotDate !== date) {
    lastLedgerSnapshotDate = date;
    runDailyLedgerSnapshot().catch((err) =>
      console.error('[DailySnapshot] daily_ledger failed:', err)
    );
  }
}

/**
 * Runs at 00:00 Asia/Kolkata:
 * 1. Update yesterday's row: closing_balance, growth_percentage
 * 2. Create today's row: opening_balance = yesterday's closing
 */
export async function runDailySnapshot(): Promise<void> {
  const today = db.getISTDate(0);
  const yesterday = db.getISTDate(1);

  const manager = new ExchangeManager();
  const balances = await manager.getAggregatedBalances();
  const currentTotal = balances.total;

  const yesterdayRow = db.db
    .prepare(
      'SELECT opening_balance, total_deposits, total_withdrawals FROM daily_balance_snapshots WHERE date = ?'
    )
    .get(yesterday) as
    | { opening_balance: number; total_deposits: number; total_withdrawals: number }
    | undefined;

  if (yesterdayRow) {
    const { opening_balance, total_deposits, total_withdrawals } = yesterdayRow;
    const growthAmt =
      currentTotal - opening_balance - total_deposits + total_withdrawals;
    const growthPct =
      opening_balance > 0 ? (growthAmt * 100) / opening_balance : 0;

    db.db
      .prepare(
        'UPDATE daily_balance_snapshots SET closing_balance = ?, growth_percentage = ? WHERE date = ?'
      )
      .run(currentTotal, growthPct, yesterday);
  }

  const todayExists = db.db
    .prepare('SELECT 1 FROM daily_balance_snapshots WHERE date = ?')
    .get(today);

  if (!todayExists) {
    const lastRow = db.db
      .prepare(
        'SELECT closing_balance, opening_balance FROM daily_balance_snapshots ORDER BY date DESC LIMIT 1'
      )
      .get() as { closing_balance: number | null; opening_balance: number } | undefined;
    const opening =
      lastRow?.closing_balance ?? lastRow?.opening_balance ?? 95;

    db.db
      .prepare(
        'INSERT INTO daily_balance_snapshots (date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage) VALUES (?, ?, NULL, 0, 0, 0)'
      )
      .run(today, opening);
  }
}

let lastRunDate = '';

function getISTHourMinute(): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const str = formatter.format(new Date());
  const [hour, minute] = str.split(':').map((x) => parseInt(x, 10) || 0);
  return { hour, minute };
}

/**
 * Call every minute; runs snapshot only when we've crossed midnight IST (00:00–00:02).
 */
export function maybeRunDailySnapshot(): void {
  const { hour, minute } = getISTHourMinute();
  const today = db.getISTDate(0);

  if (hour === 0 && minute < 2 && lastRunDate !== today) {
    lastRunDate = today;
    runDailySnapshot().catch((err) =>
      console.error('[DailySnapshot] failed:', err)
    );
  }
}
