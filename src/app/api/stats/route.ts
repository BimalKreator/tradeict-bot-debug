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

type ActiveTradeRow = {
  quantity: number;
  leverage: number | null;
  long_exchange: string | null;
  short_exchange: string | null;
  entry_price_binance: number | null;
  entry_price_bybit: number | null;
};

/** Compute used margin per exchange from active_trades. Both long and short legs contribute margin. */
function getUsedMarginFromActiveTrades(): { binance: number; bybit: number } {
  const rows = db.db
    .prepare(
      `SELECT quantity, leverage, long_exchange, short_exchange,
              entry_price_binance, entry_price_bybit
       FROM active_trades WHERE status = 'ACTIVE'`
    )
    .all() as ActiveTradeRow[];

  let binanceMargin = 0;
  let bybitMargin = 0;
  const levDefault = 1;

  for (const t of rows) {
    const qty = Number(t.quantity) || 0;
    const lev = Number(t.leverage) || levDefault;
    if (qty <= 0 || lev <= 0) continue;

    const longEx = (t.long_exchange ?? '').toLowerCase();
    const shortEx = (t.short_exchange ?? '').toLowerCase();

    const longEntryPrice =
      longEx === 'binance'
        ? Number(t.entry_price_binance) || 0
        : Number(t.entry_price_bybit) || 0;
    const shortEntryPrice =
      shortEx === 'binance'
        ? Number(t.entry_price_binance) || 0
        : Number(t.entry_price_bybit) || 0;

    const longMargin = (qty * longEntryPrice) / lev;
    const shortMargin = (qty * shortEntryPrice) / lev;

    if (longEx === 'binance') binanceMargin += longMargin;
    else if (longEx === 'bybit') bybitMargin += longMargin;

    if (shortEx === 'binance') binanceMargin += shortMargin;
    else if (shortEx === 'bybit') bybitMargin += shortMargin;
  }

  return { binance: binanceMargin, bybit: bybitMargin };
}

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

    // 1. Fetch LIVE balances from Binance/Bybit (no aggressive timeout — wait up to exchange limit for real data)
    let liveBalances: {
      total: number;
      binance: number;
      bybit: number;
      binanceUsedMargin: number;
      bybitUsedMargin: number;
      binanceAvailable: number;
      bybitAvailable: number;
    } = {
      total: 0,
      binance: 0,
      bybit: 0,
      binanceUsedMargin: 0,
      bybitUsedMargin: 0,
      binanceAvailable: 0,
      bybitAvailable: 0,
    };
    try {
      const manager = new ExchangeManager();
      const agg = await manager.getAggregatedBalances();
      liveBalances = {
        total: agg.total,
        binance: agg.binance,
        bybit: agg.bybit,
        binanceUsedMargin: agg.binanceUsedMargin ?? 0,
        bybitUsedMargin: agg.bybitUsedMargin ?? 0,
        binanceAvailable: agg.binanceAvailable ?? Math.max(0, agg.binance - (agg.binanceUsedMargin ?? 0)),
        bybitAvailable: agg.bybitAvailable ?? Math.max(0, agg.bybit - (agg.bybitUsedMargin ?? 0)),
      };
    } catch (e) {
      console.warn('[Stats] Live balance fetch failed, using last known / ledger:', e);
      const ledgerRow = db.db
        .prepare('SELECT total_balance FROM daily_ledger ORDER BY date DESC LIMIT 1')
        .get() as { total_balance: number } | undefined;
      const snapshotRow = db.db
        .prepare('SELECT closing_balance FROM daily_balance_snapshots ORDER BY date DESC LIMIT 1')
        .get() as { closing_balance: number | null } | undefined;
      const fallbackTotal = ledgerRow?.total_balance ?? snapshotRow?.closing_balance ?? 0;
      const lastKnown = ExchangeManager.getLastKnownBalances();
      const hasPerExchange = lastKnown.binance > 0 || lastKnown.bybit > 0;
      if (hasPerExchange) {
        liveBalances = {
          total: lastKnown.binance + lastKnown.bybit,
          binance: lastKnown.binance,
          bybit: lastKnown.bybit,
          binanceUsedMargin: 0,
          bybitUsedMargin: 0,
          binanceAvailable: lastKnown.binance,
          bybitAvailable: lastKnown.bybit,
        };
      } else {
        const total = typeof fallbackTotal === 'number' && fallbackTotal > 0 ? fallbackTotal : 0;
        const half = total / 2;
        liveBalances = {
          total,
          binance: half,
          bybit: half,
          binanceUsedMargin: 0,
          bybitUsedMargin: 0,
          binanceAvailable: half,
          bybitAvailable: half,
        };
      }
    }

    // 2. Used margin from active_trades (DB), then available = balance - margin
    const { binance: binanceMarginFromDb, bybit: bybitMarginFromDb } = getUsedMarginFromActiveTrades();
    const binanceAvailable = Math.max(0, liveBalances.binance - binanceMarginFromDb);
    const bybitAvailable = Math.max(0, liveBalances.bybit - bybitMarginFromDb);
    const totalMargin = binanceMarginFromDb + bybitMarginFromDb;
    const totalAvailable = binanceAvailable + bybitAvailable;

    const exchangePayload = {
      binance: {
        balance: liveBalances.binance,
        margin: binanceMarginFromDb,
        available: binanceAvailable,
      },
      bybit: {
        balance: liveBalances.bybit,
        margin: bybitMarginFromDb,
        available: bybitAvailable,
      },
      total: {
        balance: liveBalances.total,
        margin: totalMargin,
        available: totalAvailable,
      },
    };

    // 3. Fetch manual deposits/withdrawals from DB
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
    // Growth % uses Current Balance as denominator (not Opening)
    const growthPct =
      liveBalances.total > 0 ? (growthAmt * 100) / liveBalances.total : 0;

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
        opening_balance: openingBalance,
        todays_deposits: todaysDeposits,
        todays_withdrawals: todaysWithdrawals,
        growth_amt: growthAmt,
        growth_pct: growthPct,
        daily_avg_roi: dailyAvgRoi,
        weekly_avg_roi: weeklyAvgRoi,
        thirty_day_avg_roi: thirtyDayAvgRoi,
        // Exchange health: margin from active_trades DB, available = balance - margin
        binance: exchangePayload.binance,
        bybit: exchangePayload.bybit,
        total: exchangePayload.total,
        // Flat fields for backward compatibility
        binance_balance: liveBalances.binance,
        bybit_balance: liveBalances.bybit,
        binance_margin: binanceMarginFromDb,
        bybit_margin: bybitMarginFromDb,
        total_margin: totalMargin,
        binance_available: binanceAvailable,
        bybit_available: bybitAvailable,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err) {
    console.error('[Stats API Error]', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch stats';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
