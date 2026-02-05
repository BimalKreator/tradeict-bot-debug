'use client';

import { useState, useMemo, useEffect } from 'react';
import { useFundingScreener } from '../../hooks/useFundingScreener';
import { TradeEntryDropdown } from './TradeEntryDropdown';

const PAGE_SIZE = 20;

interface FundingTableProps {
  autoEntryEnabled?: boolean;
  manualTradingEnabled?: boolean;
}

export function FundingTable({
  autoEntryEnabled = true,
  manualTradingEnabled = true,
}: FundingTableProps) {
  const { data, loading, error } = useFundingScreener();
  const [page, setPage] = useState(1);
  const [nextTradeSymbols, setNextTradeSymbols] = useState<Set<string>>(new Set());
  const [slotsAvailable, setSlotsAvailable] = useState<number>(0);

  useEffect(() => {
    const fetchNext = async () => {
      try {
        const res = await fetch('/api/next-entry');
        if (res.ok) {
          const json = await res.json();
          const list = (json?.candidates ?? []) as { symbol?: string; symbol_base?: string }[];
          const symbols = new Set<string>();
          for (const c of list) {
            if (typeof c?.symbol === 'string') symbols.add(c.symbol);
            const base = c?.symbol_base ?? (typeof c?.symbol === 'string' ? c.symbol.split('/')[0] : '');
            if (base) symbols.add(base);
          }
          setNextTradeSymbols(symbols);
          setSlotsAvailable(typeof json?.slots_available === 'number' ? json.slots_available : list.length);
        }
      } catch {
        setNextTradeSymbols(new Set());
        setSlotsAvailable(0);
      }
    };
    fetchNext();
    const interval = setInterval(fetchNext, 5000);
    return () => clearInterval(interval);
  }, []);

  const totalPages = useMemo(() => (data?.length ? Math.ceil(data.length / PAGE_SIZE) : 1), [data?.length]);
  const effectivePage = Math.min(Math.max(1, page), totalPages);
  const paginatedData = useMemo(() => {
    if (!data) return [];
    const start = (effectivePage - 1) * PAGE_SIZE;
    return data.slice(start, start + PAGE_SIZE);
  }, [data, effectivePage]);

  if (loading) {
    return (
      <div className="glass flex min-h-[200px] items-center justify-center rounded-xl">
        <div className="text-white/70">Loading opportunities...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass flex min-h-[200px] items-center justify-center rounded-xl border border-red-500/30">
        <div className="text-red-400">Error: {error}</div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="glass flex min-h-[200px] items-center justify-center rounded-xl">
        <div className="text-white/70">No opportunities found</div>
      </div>
    );
  }

  return (
    <>
      {!autoEntryEnabled && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-amber-400">
          <span>⚠️</span>
          <span className="font-medium">Manual Mode Only - Auto Entry Disabled</span>
        </div>
      )}
      {slotsAvailable > 0 && nextTradeSymbols.size > 0 && (
        <div className="mb-3 rounded-lg border border-[#10b981]/40 bg-[#10b981]/10 px-3 py-2 text-sm text-[#10b981]">
          ⚡ <strong>Next to Trade:</strong> {nextTradeSymbols.size} token(s) will be taken on next entry ({slotsAvailable} slot{slotsAvailable !== 1 ? 's' : ''} available)
        </div>
      )}
      {/* Mobile: Compact list */}
      <div className="md:hidden">
        <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-black/50">
          {paginatedData.map((row) => {
            const spreadPct = (row.spread * 100).toFixed(3);
            const spreadColor =
              row.spread >= 0 ? 'text-[#10b981]' : 'text-red-400';
            const rowBase = row.symbol.replace('/USDT:USDT', '').split('/')[0];
            const isNext = nextTradeSymbols.has(row.symbol) || nextTradeSymbols.has(rowBase);
            return (
              <div
                key={row.symbol}
                className={`flex items-center gap-3 px-3 py-2 text-sm ${
                  isNext ? 'border-l-4 border-l-[#10b981] bg-[#10b981]/10' : ''
                }`}
              >
                <div className="flex-1 font-semibold text-white">
                  <span>{row.symbol.replace('/USDT:USDT', '')}</span>
                  {isNext && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-[#10b981]/30 px-2 py-0.5 text-xs font-medium text-[#10b981]">
                      ⚡ Next to Trade
                    </span>
                  )}
                </div>
                <div
                  className={`w-20 text-right tabular-nums font-medium ${spreadColor}`}
                >
                  {spreadPct}%
                </div>
                <div>
                  <TradeEntryDropdown
                    symbol={row.symbol}
                    direction={`Long ${row.longExchange.charAt(0).toUpperCase() + row.longExchange.slice(1)} / Short ${row.shortExchange.charAt(0).toUpperCase() + row.shortExchange.slice(1)}`}
                    binancePrice={row.binancePrice}
                    bybitPrice={row.bybitPrice}
                    variant="compact"
                    disabled={!manualTradingEnabled}
                    disabledReason="Manual Trading Disabled"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Desktop: Table */}
      <div className="hidden md:block">
        <div className="glass rounded-xl overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left font-medium text-white">Token</th>
                <th className="px-4 py-3 text-right font-medium text-white">Binance Rate (%)</th>
                <th className="px-4 py-3 text-right font-medium text-white">Bybit Rate (%)</th>
                <th className="px-4 py-3 text-right font-medium text-white">Spread (%)</th>
                <th className="px-4 py-3 text-center font-medium text-white">Interval</th>
                <th className="px-4 py-3 text-center font-medium text-white">Direction</th>
                <th className="px-4 py-3 text-center font-medium text-white">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedData.map((row) => {
                const rowBase = row.symbol.replace('/USDT:USDT', '').split('/')[0];
                const isNext = nextTradeSymbols.has(row.symbol) || nextTradeSymbols.has(rowBase);
                return (
                <tr
                  key={row.symbol}
                  className={`border-b border-white/5 transition-colors hover:bg-white/5 ${
                    isNext ? 'border-l-4 border-l-[#10b981] bg-[#10b981]/10' : ''
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-white">
                    <span>{row.symbol.replace('/USDT:USDT', '')}</span>
                    {isNext && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-[#10b981]/30 px-2 py-0.5 text-xs font-medium text-[#10b981]">
                        ⚡ Next to Trade
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/80">
                    {(row.binanceRate * 100).toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/80">
                    {(row.bybitRate * 100).toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-white">
                    {(row.spread * 100).toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-center text-white/80">{row.interval}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        row.longExchange === 'binance'
                          ? 'bg-[#10b981]/20 text-[#10b981]'
                          : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      Long {row.longExchange.charAt(0).toUpperCase() + row.longExchange.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <TradeEntryDropdown
                      symbol={row.symbol}
                      direction={`Long ${row.longExchange.charAt(0).toUpperCase() + row.longExchange.slice(1)} / Short ${row.shortExchange.charAt(0).toUpperCase() + row.shortExchange.slice(1)}`}
                      binancePrice={row.binancePrice}
                      bybitPrice={row.bybitPrice}
                      disabled={!manualTradingEnabled}
                      disabledReason="Manual Trading Disabled"
                    />
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
        {/* Pagination: 20 per page */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={effectivePage <= 1}
              className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-50 disabled:pointer-events-none"
            >
              Previous
            </button>
            <span className="text-sm text-white/70">
              Page {effectivePage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={effectivePage >= totalPages}
              className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-50 disabled:pointer-events-none"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </>
  );
}
