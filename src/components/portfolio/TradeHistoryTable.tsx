'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';

interface TradeHistoryRow {
  id: number;
  symbol: string;
  leverage: number;
  quantity: number;
  entry_price_long: number | null;
  entry_price_short: number | null;
  exit_price_long: number | null;
  exit_price_short: number | null;
  pnl_long: number | null;
  pnl_short: number | null;
  net_pnl: number;
  funding_received: number;
  exit_reason: string;
  executed_by: string;
  entry_time: string;
  exit_time: string;
}

function fmt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toFixed(2);
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v >= 1000 ? v.toFixed(1) : v.toFixed(4);
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    const day = d.getDate().toString().padStart(2, '0');
    const month = d.toLocaleString('en', { month: 'short' });
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    return `${day} ${month}, ${h}:${m}:${s}`;
  } catch {
    return iso;
  }
}

export function TradeHistoryTable() {
  const [rows, setRows] = useState<TradeHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        const data = await res.json();
        setRows(Array.isArray(data) ? data : []);
      } else {
        setRows([]);
      }
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (loading) {
    return (
      <div className="glass flex min-h-[200px] items-center justify-center rounded-xl">
        <div className="text-white/70">Loading trade history...</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="glass flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl p-8">
        <div className="text-white/70">No closed trades found yet</div>
        <button
          type="button"
          onClick={fetchHistory}
          className="flex items-center gap-2 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-400 transition-colors hover:bg-cyan-500/20"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>
    );
  }

  return (
    <>
    <div className="mb-4 flex justify-end">
      <button
        type="button"
        onClick={fetchHistory}
        className="flex items-center gap-2 rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/5 hover:text-white"
      >
        <RefreshCw className="h-4 w-4" />
        Refresh
      </button>
    </div>
    <div className="overflow-x-auto rounded-xl border border-cyan-500/30">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead>
          <tr className="border-b border-cyan-500/30 bg-black/50">
            <th className="px-4 py-3 font-medium text-cyan-400">Date & Time</th>
            <th className="px-4 py-3 font-medium text-cyan-400">Token / Leverage</th>
            <th className="px-4 py-3 font-medium text-cyan-400">Action By</th>
            <th className="px-4 py-3 font-medium text-cyan-400">Reason</th>
            <th className="px-4 py-3 font-medium text-cyan-400">Entry Prices (L/S)</th>
            <th className="px-4 py-3 font-medium text-cyan-400">Exit Prices (L/S)</th>
            <th className="px-4 py-3 font-medium text-cyan-400">Qty</th>
            <th className="px-4 py-3 font-medium text-cyan-400">Total Funding</th>
            <th className="px-4 py-3 font-medium text-cyan-400">Net P&L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const baseSymbol = r.symbol.includes('/') ? r.symbol.split('/')[0] : r.symbol;
            const fundingPos = r.funding_received >= 0;
            const pnlPos = r.net_pnl >= 0;
            return (
              <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 text-white/80">{fmtDate(r.exit_time)}</td>
                <td className="px-4 py-3 font-medium">{baseSymbol} / {r.leverage}x</td>
                <td className="px-4 py-3">{r.executed_by}</td>
                <td className="px-4 py-3 text-white/70">{r.exit_reason}</td>
                <td className="px-4 py-3 text-white/70">
                  {fmtPrice(r.entry_price_long)} / {fmtPrice(r.entry_price_short)}
                </td>
                <td className="px-4 py-3 text-white/70">
                  {fmtPrice(r.exit_price_long)} / {fmtPrice(r.exit_price_short)}
                </td>
                <td className="px-4 py-3">{fmt(r.quantity)}</td>
                <td className={`px-4 py-3 font-medium ${fundingPos ? 'text-emerald-400' : 'text-red-400'}`}>
                  ${fmt(r.funding_received)}
                </td>
                <td className={`px-4 py-3 text-lg font-bold ${pnlPos ? 'text-emerald-400' : 'text-red-400'}`}>
                  ${fmt(r.net_pnl)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}
