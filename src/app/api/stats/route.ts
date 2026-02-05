import { NextResponse } from 'next/server';
import { ExchangeManager } from '../../../lib/exchanges/manager';
import { db } from '../../../lib/db/sqlite';

export const revalidate = 0;

const HISTORIC_OPENING_DATE = '2026-02-03';
const HISTORIC_OPENING_BALANCE = 95;

type SnapshotRow = {
  date: string;
  opening_balance: number;
  closing_balance: number | null;
  total_deposits: number;
  total_withdrawals: number;
  growth_percentage: number;
};

type LedgerRow = { date: string; total_balance: number };

function getTodayPnL(today: string): number {
  const startOfToday = new Date(`${today}T00:00:00+05:30`);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const start = startOfToday.toISOString();
  const end = startOfTomorrow.toISOString();
  const row = db.db
    .prepare('SELECT COALESCE(SUM(net_pnl), 0) as sum_pnl FROM trade_history WHERE exit_time >= ? AND exit_time < ?')
    .get(start, end) as { sum_pnl: number } | undefined;
  return row?.sum_pnl ?? 0;
}

function getOpeningBalanceFromLedger(today: string, currentTotal: number): number {
  if (today === HISTORIC_OPENING_DATE) return HISTORIC_OPENING_BALANCE;

  const ledger = db.db
    .prepare('SELECT date, total_balance FROM daily_ledger WHERE date = ?')
    .get(today) as LedgerRow | undefined;

  if (ledger) return ledger.total_balance;

  const todayPnL = getTodayPnL(today);
  const fallback = currentTotal - todayPnL;
  try {
    db.db
      .prepare(
        'INSERT OR REPLACE INTO daily_ledger (date, total_balance, created_at) VALUES (?, ?, ?)'
      )
      .run(today, fallback, new Date().toISOString());
  } catch (e) {
    console.warn('[Stats] Failed to save fallback opening to daily_ledger:', e);
  }
  return fallback;
}

export async function GET() {
  try {
    db.ensureTodaySnapshot();

    const manager = new ExchangeManager();
    const balances = await manager.getAggregatedBalances();

    const today = db.getISTDate();
    const currentTotal = balances.total;
    const openingBalance = getOpeningBalanceFromLedger(today, currentTotal);

    const snapshot = db.db
      .prepare(
        'SELECT date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage FROM daily_balance_snapshots WHERE date = ?'
      )
      .get(today) as SnapshotRow | undefined;

    const todaysDeposits = snapshot?.total_deposits ?? 0;
    const todaysWithdrawals = snapshot?.total_withdrawals ?? 0;

    const binanceMargin = balances.binanceUsedMargin ?? 0;
    const bybitMargin = balances.bybitUsedMargin ?? 0;
    const totalMargin = balances.totalUsedMargin ?? binanceMargin + bybitMargin;

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
        ? roiRows.reduce((s, r) => s + (r.growth_percentage ?? 0), 0) / roiRows.length
        : growthPct;
    const weeklyRows = roiRows.filter((r) => r.date >= sevenDaysAgo);
    const weeklyAvgRoi =
      weeklyRows.length > 0
        ? weeklyRows.reduce((s, r) => s + (r.growth_percentage ?? 0), 0) / weeklyRows.length
        : growthPct;
    const thirtyDayRows = roiRows.filter((r) => r.date >= thirtyDaysAgo);
    const thirtyDayAvgRoi =
      thirtyDayRows.length > 0
        ? thirtyDayRows.reduce((s, r) => s + (r.growth_percentage ?? 0), 0) / thirtyDayRows.length
        : growthPct;

    return NextResponse.json(
      {
        current_total_balance: currentTotal,
        binance_balance: balances.binance,
        bybit_balance: balances.bybit,
        opening_balance: openingBalance,
        todays_deposits: todaysDeposits,
        todays_withdrawals: todaysWithdrawals,
        growth_amt: growthAmt,
        growth_pct: growthPct,
        daily_avg_roi: dailyAvgRoi,
        weekly_avg_roi: weeklyAvgRoi,
        thirty_day_avg_roi: thirtyDayAvgRoi,
        binance_margin: binanceMargin,
        bybit_margin: bybitMargin,
        total_margin: totalMargin,
      },
      {
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  } catch (err) {
    console.error('[API /api/stats] Error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch stats';
    const isInitialFetch = message === 'Initial fetch failed';
    return NextResponse.json(
      { error: message },
      { status: isInitialFetch ? 503 : 500 }
    );
  }
}
