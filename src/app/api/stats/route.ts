import { NextResponse } from 'next/server';
import { db } from '@/lib/db/sqlite';

export const revalidate = 0;

const HISTORIC_OPENING_DATE = '2026-02-03';
const HISTORIC_OPENING_BALANCE = 95;

type SnapshotRow = {
  date: string;
  opening_balance: number;
  closing_balance: number | null;
  total_deposits: number | null;
  total_withdrawals: number | null;
  growth_percentage: number | null;
};

type LedgerRow = { date: string; total_balance: number };

function getOpeningBalanceFromLedger(today: string, currentTotal: number): number {
  if (today === HISTORIC_OPENING_DATE) return HISTORIC_OPENING_BALANCE;

  const ledger = db.db
    .prepare('SELECT date, total_balance FROM daily_ledger WHERE date = ?')
    .get(today) as LedgerRow | undefined;

  if (ledger) return ledger.total_balance;

  // Fallback: use yesterday's closing or last known balance
  const lastRow = db.db
    .prepare(
      'SELECT closing_balance, opening_balance FROM daily_balance_snapshots ORDER BY date DESC LIMIT 1'
    )
    .get() as { closing_balance: number | null; opening_balance: number } | undefined;
  return lastRow?.closing_balance ?? lastRow?.opening_balance ?? currentTotal;
}

export async function GET() {
  try {
    // Manual mode: no exchange API — instant load
    db.ensureTodaySnapshot();

    const today = db.getISTDate();

    // Current balance from latest ledger entry (no exchange call)
    const ledgerRow = db.db
      .prepare('SELECT total_balance FROM daily_ledger ORDER BY date DESC LIMIT 1')
      .get() as { total_balance: number } | undefined;
    const currentTotal = ledgerRow?.total_balance ?? 0;

    const openingBalance = getOpeningBalanceFromLedger(today, currentTotal);

    const snapshot = db.db
      .prepare(
        'SELECT date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage FROM daily_balance_snapshots WHERE date = ?'
      )
      .get(today) as SnapshotRow | undefined;

    const todaysDeposits = snapshot?.total_deposits ?? 0;
    const todaysWithdrawals = snapshot?.total_withdrawals ?? 0;

    // Strict formula: Growth = Current - Opening - Deposits + Withdrawals
    const growthAmt =
      currentTotal - openingBalance - todaysDeposits + todaysWithdrawals;
    const growthPct =
      openingBalance > 0 ? (growthAmt * 100) / openingBalance : 0;

    const roiRows = db.db
      .prepare(
        'SELECT growth_percentage, date FROM daily_balance_snapshots WHERE growth_percentage IS NOT NULL'
      )
      .all() as { growth_percentage: number; date: string }[];

    const sevenDaysAgo = db.getISTDate(7);
    const thirtyDaysAgo = db.getISTDate(30);

    const dailyAvgRoi =
      roiRows.length > 0
        ? roiRows.reduce((s, r) => s + (r.growth_percentage ?? 0), 0) /
          roiRows.length
        : growthPct;
    const weeklyRows = roiRows.filter((r) => r.date >= sevenDaysAgo);
    const weeklyAvgRoi =
      weeklyRows.length > 0
        ? weeklyRows.reduce((s, r) => s + (r.growth_percentage ?? 0), 0) /
          weeklyRows.length
        : growthPct;
    const thirtyDayRows = roiRows.filter((r) => r.date >= thirtyDaysAgo);
    const thirtyDayAvgRoi =
      thirtyDayRows.length > 0
        ? thirtyDayRows.reduce((s, r) => s + (r.growth_percentage ?? 0), 0) /
          thirtyDayRows.length
        : growthPct;

    return NextResponse.json(
      {
        current_total_balance: currentTotal,
        binance_balance: 0,
        bybit_balance: 0,
        opening_balance: openingBalance,
        todays_deposits: todaysDeposits,
        todays_withdrawals: todaysWithdrawals,
        growth_amt: growthAmt,
        growth_pct: growthPct,
        daily_avg_roi: dailyAvgRoi,
        weekly_avg_roi: weeklyAvgRoi,
        thirty_day_avg_roi: thirtyDayAvgRoi,
        binance_margin: 0,
        bybit_margin: 0,
        total_margin: 0,
      },
      {
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  } catch (err) {
    console.error('[API /api/stats] Error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch stats';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
