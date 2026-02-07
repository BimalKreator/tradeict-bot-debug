'use client';

import { useEffect, useState } from 'react';
import { Wallet, TrendingUp, Activity } from 'lucide-react';

interface ExchangeHealth {
  balance: number;
  margin: number;
  available: number;
}

interface StatsData {
  current_total_balance: number;
  binance_balance: number;
  bybit_balance: number;
  opening_balance: number;
  todays_deposits: number;
  todays_withdrawals: number;
  growth_amt: number;
  growth_pct: number;
  daily_avg_roi: number;
  weekly_avg_roi: number;
  thirty_day_avg_roi: number;
  binance_margin: number;
  bybit_margin: number;
  total_margin: number;
  binance_available?: number;
  bybit_available?: number;
  /** New shape: margin from active_trades DB, available = balance - margin */
  binance?: ExchangeHealth;
  bybit?: ExchangeHealth;
  total?: ExchangeHealth;
}

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtShort = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const avgColor = (v: number | null | undefined) =>
  v == null ? 'text-white/60' : v >= 0 ? 'text-[#10b981]' : 'text-red-500';

export function StatsGrid() {
  const [stats, setStats] = useState<StatsData | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch {
        setStats(null);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const growthColor =
    stats?.growth_pct == null
      ? 'text-white/60'
      : stats.growth_pct >= 0
        ? 'text-[#10b981]'
        : 'text-red-500';

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {/* CARD 1: Total Balance */}
      <div className="glass rounded-xl p-4">
        <div className="flex items-center gap-2 text-sm text-white/70">
          <Wallet className="h-4 w-4" />
          Total Balance
        </div>
        <p className="mt-2 text-2xl font-bold tabular-nums text-white md:text-3xl">
          $
          {stats?.current_total_balance != null
            ? fmt(stats.current_total_balance)
            : '—'}
        </p>
        <p className="mt-1 text-sm text-white/50">
          Opening: ${stats?.opening_balance != null ? fmt(stats.opening_balance) : '—'}
        </p>
        <div className="mt-2 flex flex-col space-y-1 border-t border-white/10 pt-2 text-xs text-white/50">
          <span>Deposits: ${stats?.todays_deposits != null ? fmt(stats.todays_deposits) : '0.00'}</span>
          <span>Withdrawals: ${stats?.todays_withdrawals != null ? fmt(stats.todays_withdrawals) : '0.00'}</span>
        </div>
      </div>

      {/* CARD 2: Today's Growth */}
      <div className="glass rounded-xl p-4">
        <div className="flex items-center gap-2 text-sm text-white/70">
          <TrendingUp className="h-4 w-4" />
          Today&apos;s Growth
        </div>
        <p className={`mt-2 text-2xl font-bold tabular-nums md:text-3xl ${growthColor}`}>
          {stats?.growth_pct != null
            ? `${stats.growth_pct >= 0 ? '+' : ''}${stats.growth_pct.toFixed(2)}%`
            : '—'}
        </p>
        <p className="mt-0.5 text-xs text-white/50">
          Amt: ${stats?.growth_amt != null ? fmt(stats.growth_amt) : '—'}
        </p>
        <div className="mt-2 flex flex-col space-y-1 border-t border-white/10 pt-2 text-xs">
          <div>
            <span className="text-white/50">Daily Avg: </span>
            <span className={avgColor(stats?.daily_avg_roi)}>
              {stats?.daily_avg_roi != null ? `${stats.daily_avg_roi >= 0 ? '+' : ''}${stats.daily_avg_roi.toFixed(2)}%` : '—'}
            </span>
          </div>
          <div>
            <span className="text-white/50">7D Avg: </span>
            <span className={avgColor(stats?.weekly_avg_roi)}>
              {stats?.weekly_avg_roi != null ? `${stats.weekly_avg_roi >= 0 ? '+' : ''}${stats.weekly_avg_roi.toFixed(2)}%` : '—'}
            </span>
          </div>
          <div>
            <span className="text-white/50">30D Avg: </span>
            <span className={avgColor(stats?.thirty_day_avg_roi)}>
              {stats?.thirty_day_avg_roi != null ? `${stats.thirty_day_avg_roi >= 0 ? '+' : ''}${stats.thirty_day_avg_roi.toFixed(2)}%` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* CARD 3: Exchange Health — Total Bal | Margin (from active_trades) | Avail (balance − margin) */}
      <div className="glass rounded-xl p-4">
        <div className="flex items-center gap-2 text-sm text-white/70">
          <Activity className="h-4 w-4" />
          Exchange Health
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-2 py-2 text-left font-medium text-white/80">
                  Exchange
                </th>
                <th className="px-2 py-2 text-right font-medium text-white/80">
                  Total Bal
                </th>
                <th className="px-2 py-2 text-right font-medium text-white/80">
                  Margin
                </th>
                <th className="px-2 py-2 text-right font-medium text-white/80">
                  Avail
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-white/5">
                <td className="px-2 py-2 text-white/90">Binance</td>
                <td className="px-2 py-2 text-right tabular-nums text-white/90">
                  ${(stats?.binance?.balance ?? stats?.binance_balance) != null ? fmtShort(stats?.binance?.balance ?? stats?.binance_balance ?? 0) : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-white/90">
                  ${(stats?.binance?.margin ?? stats?.binance_margin) != null ? fmtShort(stats?.binance?.margin ?? stats?.binance_margin ?? 0) : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-emerald-400/90">
                  {(stats?.binance?.available ?? stats?.binance_available) != null
                    ? `$${fmtShort(stats?.binance?.available ?? stats?.binance_available ?? 0)}`
                    : '—'}
                </td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="px-2 py-2 text-white/90">Bybit</td>
                <td className="px-2 py-2 text-right tabular-nums text-white/90">
                  ${(stats?.bybit?.balance ?? stats?.bybit_balance) != null ? fmtShort(stats?.bybit?.balance ?? stats?.bybit_balance ?? 0) : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-white/90">
                  ${(stats?.bybit?.margin ?? stats?.bybit_margin) != null ? fmtShort(stats?.bybit?.margin ?? stats?.bybit_margin ?? 0) : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-emerald-400/90">
                  {(stats?.bybit?.available ?? stats?.bybit_available) != null
                    ? `$${fmtShort(stats?.bybit?.available ?? stats?.bybit_available ?? 0)}`
                    : '—'}
                </td>
              </tr>
              <tr className="bg-white/5">
                <td className="px-2 py-2 font-medium text-white">Total</td>
                <td className="px-2 py-2 text-right tabular-nums font-medium text-white">
                  ${(stats?.total?.balance ?? stats?.current_total_balance) != null ? fmtShort(stats?.total?.balance ?? stats?.current_total_balance ?? 0) : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums font-medium text-white">
                  ${(stats?.total?.margin ?? stats?.total_margin) != null ? fmtShort(stats?.total?.margin ?? stats?.total_margin ?? 0) : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums font-medium text-emerald-400">
                  {stats?.total?.available != null
                    ? `$${fmtShort(stats.total.available)}`
                    : stats?.binance_available != null && stats?.bybit_available != null
                      ? `$${fmtShort(stats.binance_available + stats.bybit_available)}`
                      : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
