import { NextResponse } from 'next/server';
import { db } from '@/lib/db/sqlite';
import { ExchangeManager } from '@/lib/exchanges/manager';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const HISTORIC_OPENING_DATE = '2026-02-03';
const HISTORIC_OPENING_BALANCE = 95;
/** Safety net when snapshot/ledger unavailable — prevents 0% growth error. */
const FALLBACK_OPENING_BALANCE = 75;

type SnapshotRow = {
  date: string;
  opening_balance: number;
  closing_balance: number | null;
  total_deposits: number | null;
  total_withdrawals: number | null;
  growth_percentage: number | null;
};

type LedgerRow = { date: string; total_balance: number };

function getOpeningBalanceFromLedger(today: string): number {
  if (today === HISTORIC_OPENING_DATE) return HISTORIC_OPENING_BALANCE;

  const ledger = db.db
    .prepare('SELECT date, total_balance FROM daily_ledger WHERE date = ?')
    .get(today) as LedgerRow | undefined;

  if (ledger) return ledger.total_balance;

  const lastRow = db.db
    .prepare(
      'SELECT closing_balance, opening_balance FROM daily_balance_snapshots ORDER BY date DESC LIMIT 1'
    )
    .get() as { closing_balance: number | null; opening_balance: number } | undefined;
  // CRITICAL: Never use currentBalance as fallback — causes 0% growth. Use fixed $75.
  return lastRow?.closing_balance ?? lastRow?.opening_balance ?? FALLBACK_OPENING_BALANCE;
}

export async function GET() {
  try {
    db.ensureTodaySnapshot();
    const today = db.getISTDate();

    // 1. Fetch LIVE balances from Binance/Bybit
    let liveBalances = { total: 0, binance: 0, bybit: 0, binanceUsedMargin: 0, bybitUsedMargin: 0 };
    try {
      const manager = new ExchangeManager();
      const agg = await manager.getAggregatedBalances();
      liveBalances = {
        total: agg.total,
        binance: agg.binance,
        bybit: agg.bybit,
        binanceUsedMargin: agg.binanceUsedMargin ?? 0,
        bybitUsedMargin: agg.bybitUsedMargin ?? 0,
      };
    } catch (e) {
      console.error('[Stats] Failed to fetch live balances:', e);
      const ledgerRow = db.db
        .prepare('SELECT total_balance FROM daily_ledger ORDER BY date DESC LIMIT 1')
        .get() as { total_balance: number } | undefined;
      liveBalances.total = ledgerRow?.total_balance ?? 0;
    }

    // 2. Fetch manual deposits/withdrawals from DB
    const snapshot = db.db
      .prepare(
        'SELECT date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage FROM daily_balance_snapshots WHERE date = ?'
      )
      .get(today) as SnapshotRow | undefined;

    const todaysDeposits = snapshot?.total_deposits ?? 0;
    const todaysWithdrawals = snapshot?.total_withdrawals ?? 0;
    // If no snapshot for today, use $75 — never currentBalance (prevents 0% growth)
    const openingBalance =
      !snapshot
        ? FALLBACK_OPENING_BALANCE
        : (snapshot.opening_balance ?? getOpeningBalanceFromLedger(today));

    // 3. STRICT FORMULA: Growth = Live - Opening - Deposits + Withdrawals
    const growthAmt =
      liveBalances.total - openingBalance - todaysDeposits + todaysWithdrawals;
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

    // 4. Update ledger with live balance (keep history)
    try {
      db.db
        .prepare(
          'INSERT OR REPLACE INTO daily_ledger (date, total_balance, created_at) VALUES (?, ?, ?)'
        )
        .run(today, liveBalances.total, new Date().toISOString());
    } catch {
      // ignore
    }

    return NextResponse.json(
      {
        current_total_balance: liveBalances.total,
        binance_balance: liveBalances.binance,
        bybit_balance: liveBalances.bybit,
        opening_balance: openingBalance,
        todays_deposits: todaysDeposits,
        todays_withdrawals: todaysWithdrawals,
        growth_amt: growthAmt,
        growth_pct: growthPct,
        daily_avg_roi: dailyAvgRoi,
        weekly_avg_roi: weeklyAvgRoi,
        thirty_day_avg_roi: thirtyDayAvgRoi,
        binance_margin: liveBalances.binanceUsedMargin,
        bybit_margin: liveBalances.bybitUsedMargin,
        total_margin: liveBalances.binanceUsedMargin + liveBalances.bybitUsedMargin,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err) {
    console.error('[Stats API Error]', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch stats';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
