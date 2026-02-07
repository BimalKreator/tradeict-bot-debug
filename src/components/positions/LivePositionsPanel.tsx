'use client';

import { Fragment, useEffect, useState } from 'react';
import { showToast } from '../../lib/utils/toast';
import { clsx } from 'clsx';

interface LivePositionsPanelProps {
  autoExitEnabled?: boolean;
}

interface PositionLeg {
  exchange: 'Binance' | 'Bybit';
  side: string;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  size: number;
  liquidationPrice: number;
}

interface SlotsInfo {
  total: number;
  used: number;
  available: number;
}

interface GroupedPosition {
  symbol: string;
  netPnl: number;
  legs: PositionLeg[];
}

interface EnrichedPosition extends GroupedPosition {
  funding_received?: number | null;
  long_funding_acc?: number | null;
  short_funding_acc?: number | null;
  long_exchange?: string | null;
  short_exchange?: string | null;
  next_funding_time?: string | null;
  liquidation_binance?: number | null;
  liquidation_bybit?: number | null;
  leverage?: number | null;
  quantity?: number | null;
  entry_price_binance?: number | null;
  entry_price_bybit?: number | null;
}

function liqBufferPercent(pos: EnrichedPosition): number | null {
  let minPct: number | null = null;
  for (const leg of pos.legs) {
    const liq =
      leg.liquidationPrice > 0
        ? leg.liquidationPrice
        : leg.exchange === 'Binance'
          ? (pos.liquidation_binance ?? 0)
          : (pos.liquidation_bybit ?? 0);
    if (liq <= 0) continue;
    const pct = (Math.abs(leg.markPrice - liq) / liq) * 100;
    if (minPct === null || pct < minPct) minPct = pct;
  }
  return minPct;
}

function usedMargin(pos: EnrichedPosition): number {
  const qty = totalQuantity(pos);
  if (qty <= 0) return 0;
  const avgEntry = pos.legs.reduce((s, l) => s + l.entryPrice, 0) / pos.legs.length;
  const leverage = pos.leverage ?? 2;
  return (avgEntry * qty) / leverage;
}

function nextFundingEst(pos: EnrichedPosition): number {
  const notional = pos.legs.reduce(
    (s, l) => s + Math.abs(l.size) * l.markPrice,
    0
  );
  const leverage = pos.leverage ?? 1;
  return notional * 0.0001 * leverage; // 0.01% * leverage
}

function totalQuantity(pos: GroupedPosition): number {
  return pos.legs.reduce((s, l) => s + Math.abs(l.size), 0);
}

function isHedged(pos: GroupedPosition): boolean {
  if (pos.legs.length === 0) return true;
  if (pos.legs.length === 1) return false;
  if (pos.legs.length === 2) {
    const [a, b] = pos.legs;
    const sizeA = Math.abs(a.size);
    const sizeB = Math.abs(b.size);
    const maxQ = Math.max(sizeA, sizeB);
    if (maxQ <= 0) return true;
    return Math.abs(sizeA - sizeB) / maxQ < 0.02;
  }
  const longQty = pos.legs
    .filter((l) => (l.side ?? '').toUpperCase() === 'LONG' || (l.side ?? '').toLowerCase() === 'buy')
    .reduce((s, l) => s + Math.abs(l.size), 0);
  const shortQty = pos.legs
    .filter((l) => (l.side ?? '').toUpperCase() === 'SHORT' || (l.side ?? '').toLowerCase() === 'sell')
    .reduce((s, l) => s + Math.abs(l.size), 0);
  const maxQ = Math.max(longQty, shortQty);
  if (maxQ <= 0) return true;
  return Math.abs(longQty - shortQty) / maxQ < 0.02;
}

function fundingPerLeg(position: EnrichedPosition, exchange: string): number {
  const ex = exchange.toLowerCase();
  const longEx = (position.long_exchange ?? '').toLowerCase();
  const shortEx = (position.short_exchange ?? '').toLowerCase();
  if (longEx && ex === longEx) {
    return position.long_funding_acc ?? 0;
  }
  if (shortEx && ex === shortEx) {
    return position.short_funding_acc ?? 0;
  }
  return 0;
}

export function LivePositionsPanel({ autoExitEnabled = true }: LivePositionsPanelProps) {
  const [slots, setSlots] = useState<SlotsInfo>({ total: 3, used: 0, available: 3 });
  const [positions, setPositions] = useState<EnrichedPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [closingSymbol, setClosingSymbol] = useState<string | null>(null);

  const fetchPositions = async (isInitial = false) => {
    if (!isInitial) setRefreshing(true);
    try {
      const res = await fetch('/api/positions');
      if (res.ok) {
        const data = await res.json();
        if (data.slots) setSlots(data.slots);
        const next = Array.isArray(data) ? data : data.positions ?? [];
        setPositions(next);
      } else if (isInitial) {
        setPositions([]);
      }
    } catch {
      if (isInitial) setPositions([]);
    } finally {
      if (isInitial) setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPositions(true);
    const interval = setInterval(() => fetchPositions(false), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkRisk = async () => {
      try {
        const res = await fetch('/api/risk/check');
        const data = await res.json();
        if (data.status === 'RISK_DETECTED') {
          showToast('⚠️ CRITICAL: Hedge Broken! Emergency Exit Triggered', 'error', {
            persistent: true,
          });
          console.error('[LivePositionsPanel] Risk detected, actions taken:', data.actionsTaken);
          await fetchPositions(false);
        }
      } catch {
        // ignore
      }
    };
    const interval = setInterval(checkRisk, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleClose = async (symbol: string) => {
    if (closingSymbol) return;
    setClosingSymbol(symbol);
    try {
      const res = await fetch('/api/trade/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Close failed');
      await fetchPositions(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Close failed', 'error');
    } finally {
      setClosingSymbol(null);
    }
  };

  const toggleExpanded = (symbol: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  };

  const totalPnl = positions.reduce((sum, p) => sum + p.netPnl, 0);
  const totalPnlColor = totalPnl > 0 ? 'text-[#10b981]' : totalPnl < 0 ? 'text-red-500' : 'text-white/60';
  const activeTradesCount = positions.length;
  const availableSlots = Math.max(0, 3 - activeTradesCount);

  if (loading && positions.length === 0) {
    return (
      <div className="glass rounded-xl p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Active Positions</h2>
        <div className="text-sm text-white/60">Loading positions...</div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <>
        {!autoExitEnabled && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-red-400">
            <span>⚠️</span>
            <span className="font-medium">Auto Protection Disabled - Monitor Manually</span>
          </div>
        )}
        <div className="glass rounded-xl p-4">
          <h2 className="mb-3 text-lg font-semibold text-white">Active Positions</h2>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex gap-1">
              {[1, 2, 3].map((n) => {
                const used = n <= activeTradesCount;
                return (
                  <div
                    key={n}
                    className={clsx(
                      'flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold',
                      used ? 'bg-cyan-500/20 text-cyan-400' : 'bg-gray-800 text-gray-500'
                    )}
                  >
                    {n}
                  </div>
                );
              })}
            </div>
            <span
              className={clsx(
                'text-sm font-medium',
                availableSlots > 0 ? 'text-[#10b981]' : 'animate-pulse text-red-500'
              )}
            >
              {availableSlots > 0
                ? `${availableSlots} Token Slots Available`
                : 'All Slots Full'}
            </span>
          </div>
          <div className="rounded-lg bg-white/5 py-8 text-center text-sm text-white/60">
            No active trades
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {!autoExitEnabled && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-red-400">
          <span>⚠️</span>
          <span className="font-medium">Auto Protection Disabled - Monitor Manually</span>
        </div>
      )}
      <div className="glass rounded-xl">
      <div className="border-b border-white/10 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            Active Positions
            {refreshing && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-white/60">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
                Updating...
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/60">Total Unrealized P&L:</span>
            <span className={`text-lg font-semibold tabular-nums ${totalPnlColor}`}>
              ${totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
        {/* Slot indicator: available = 3 - activeTrades.length */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {[1, 2, 3].map((n) => {
              const used = n <= activeTradesCount;
              return (
                <div
                  key={n}
                  className={clsx(
                    'flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold',
                    used ? 'bg-cyan-500/20 text-cyan-400' : 'bg-gray-800 text-gray-500'
                  )}
                >
                  {n}
                </div>
              );
            })}
          </div>
          <span
            className={clsx(
              'text-sm font-medium',
              availableSlots > 0 ? 'text-[#10b981]' : 'animate-pulse text-red-500'
            )}
          >
            {availableSlots > 0
              ? `${availableSlots} Token Slots Available`
              : 'All Slots Full'}
          </span>
        </div>
      </div>

      {/* Mobile: Card Layout */}
      <div className="space-y-3 p-4 md:hidden">
        {positions.map((pos) => {
          const isExpanded = expandedGroups.has(pos.symbol);
          const pnlColor = pos.netPnl > 0 ? 'text-[#10b981]' : pos.netPnl < 0 ? 'text-red-500' : 'text-white/60';
          const avgEntry = pos.legs.reduce((s, l) => s + l.entryPrice, 0) / pos.legs.length;
          const avgMark = pos.legs.reduce((s, l) => s + l.markPrice, 0) / pos.legs.length;
          const totalFunding = pos.funding_received ?? (pos.long_funding_acc ?? 0) + (pos.short_funding_acc ?? 0);
          const fundingColor = totalFunding > 0 ? 'text-[#10b981]' : totalFunding < 0 ? 'text-red-500' : 'text-white/60';
          const liqPct = liqBufferPercent(pos);
          const nextEst = nextFundingEst(pos);

          return (
            <div key={pos.symbol} className="glass rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold text-white">{pos.symbol}</span>
                <div className="flex items-center gap-2">
                  {isHedged(pos) ? (
                    <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                      ✅ Hedged
                    </span>
                  ) : (
                    <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
                      ⚠️ Unhedged
                    </span>
                  )}
                  <span className={`text-xl font-bold tabular-nums ${pnlColor}`}>
                    ${pos.netPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-white/50">Total Qty</span>
                  <p className="tabular-nums text-white">
                    {totalQuantity(pos).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  </p>
                </div>
                <div>
                  <span className="text-white/50">Entry</span>
                  <p className="tabular-nums text-white">${avgEntry.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</p>
                </div>
                <div>
                  <span className="text-white/50">Current</span>
                  <p className="tabular-nums text-white">${avgMark.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</p>
                </div>
                <div>
                  <span className="text-white/50">Used Margin</span>
                  <p className="tabular-nums text-white">
                    ${usedMargin(pos).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <span className="text-white/50">Total Funding</span>
                  <p className={`tabular-nums ${fundingColor}`}>
                    ${(totalFunding).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <span className="text-white/50">Next (Est.)</span>
                  <p className="tabular-nums text-white/80">${nextEst.toFixed(2)}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-white/50">Liq. Buffer</span>
                  <p className="tabular-nums text-white/90">
                    {liqPct !== null ? `${liqPct.toFixed(1)}% Safe` : 'N/A'}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => toggleExpanded(pos.symbol)}
                  className="w-full rounded-lg border border-white/20 py-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/5"
                >
                  {isExpanded ? 'Hide Details' : 'Expand Details'}
                </button>
                {isExpanded && (
                  <div className="space-y-2 rounded-lg bg-white/5 p-3">
                    {pos.legs.map((leg, i) => {
                      const fundingAmount = fundingPerLeg(pos, leg.exchange);
                      const fundingColor =
                        fundingAmount > 0 ? 'text-[#10b981]' : fundingAmount < 0 ? 'text-red-500' : 'text-white/60';
                      return (
                        <div key={`${pos.symbol}-${leg.exchange}-${i}`} className="space-y-1 rounded-lg bg-white/10 p-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-white/70">{leg.exchange} {leg.side}</span>
                            <span className={leg.pnl >= 0 ? 'text-[#10b981]' : 'text-red-500'}>
                              ${leg.pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="flex justify-between text-[11px]">
                            <span className="text-white/60">Quantity</span>
                            <span className="tabular-nums text-white/90">
                              {Math.abs(leg.size).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                            </span>
                          </div>
                          <div className="flex justify-between text-[11px]">
                            <span className="text-white/60">Funding</span>
                            <span className={`tabular-nums ${fundingColor}`}>
                              ${fundingAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => handleClose(pos.symbol)}
                  disabled={closingSymbol === pos.symbol}
                  className="w-full rounded-lg bg-red-600 py-3 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                >
                  {closingSymbol === pos.symbol ? 'Closing...' : 'Exit Trade'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: Table */}
      <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[780px] text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-3 py-3 text-left font-medium text-white">Token</th>
              <th className="px-3 py-3 text-right font-medium text-white">Total Qty</th>
              <th className="px-3 py-3 text-right font-medium text-white">Margin</th>
              <th className="px-3 py-3 text-right font-medium text-white">Funding</th>
              <th className="px-3 py-3 text-right font-medium text-white">Next (Est.)</th>
              <th className="px-3 py-3 text-right font-medium text-white">Unrealized P&L</th>
              <th className="px-3 py-3 text-right font-medium text-white">Entry / Current</th>
              <th className="px-3 py-3 text-right font-medium text-white">Liq. Buffer</th>
              <th className="px-3 py-3 text-center font-medium text-white">Status</th>
              <th className="px-3 py-3 text-center font-medium text-white">Details</th>
              <th className="px-3 py-3 text-center font-medium text-white">Close</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const isExpanded = expandedGroups.has(pos.symbol);
              const pnlColor = pos.netPnl > 0 ? 'text-[#10b981]' : pos.netPnl < 0 ? 'text-red-500' : 'text-white/60';
              const totalFunding = pos.funding_received ?? (pos.long_funding_acc ?? 0) + (pos.short_funding_acc ?? 0);
              const fundingColor = totalFunding > 0 ? 'text-[#10b981]' : totalFunding < 0 ? 'text-red-500' : 'text-white/60';
              const avgEntry = pos.legs.reduce((s, l) => s + l.entryPrice, 0) / pos.legs.length;
              const avgMark = pos.legs.reduce((s, l) => s + l.markPrice, 0) / pos.legs.length;
              const liqPct = liqBufferPercent(pos);
              const nextEst = nextFundingEst(pos);

              return (
                <Fragment key={pos.symbol}>
                  <tr className="border-b border-white/5 transition-colors hover:bg-white/5">
                    <td className="px-3 py-3 font-medium text-white">{pos.symbol}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-white/90">
                      {totalQuantity(pos).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-white/90">
                      ${usedMargin(pos).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className={`px-3 py-3 text-right tabular-nums ${fundingColor}`}>
                      ${(totalFunding).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-white/90">
                      ${nextEst.toFixed(2)}
                    </td>
                    <td className={`px-3 py-3 text-right tabular-nums font-medium ${pnlColor}`}>
                      ${pos.netPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-white/90">
                      ${avgEntry.toFixed(2)} / ${avgMark.toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-white/90">
                      {liqPct !== null ? `${liqPct.toFixed(1)}% Safe` : 'N/A'}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {isHedged(pos) ? (
                        <span className="inline-flex items-center rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                          ✅ Hedged
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
                          ⚠️ Unhedged
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(pos.symbol)}
                        className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                      >
                        {isExpanded ? 'Hide Details' : 'Show Details'}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleClose(pos.symbol)}
                        disabled={closingSymbol === pos.symbol}
                        className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                      >
                        {closingSymbol === pos.symbol ? 'Closing...' : 'Close'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={11} className="bg-white/5 p-4">
                        <div className="overflow-x-auto rounded-lg border border-white/10">
                          <table className="w-full min-w-[480px] text-xs">
                            <thead>
                              <tr className="border-b border-white/10 bg-white/5">
                                <th className="px-3 py-2 text-left font-medium text-white/80">Exchange</th>
                                <th className="px-3 py-2 text-left font-medium text-white/80">Side</th>
                                <th className="px-3 py-2 text-right font-medium text-white/80">Used Margin</th>
                                <th className="px-3 py-2 text-right font-medium text-white/80">Quantity</th>
                                <th className="px-3 py-2 text-right font-medium text-white/80">Entry Price</th>
                                <th className="px-3 py-2 text-right font-medium text-white/80">Mark Price</th>
                                <th className="px-3 py-2 text-right font-medium text-white/80">Liquidation Price</th>
                                <th className="px-3 py-2 text-right font-medium text-white/80">Funding</th>
                                <th className="px-3 py-2 text-right font-medium text-white/80">P&L</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pos.legs.map((leg, i) => {
                                const legPnlColor = leg.pnl > 0 ? 'text-[#10b981]' : leg.pnl < 0 ? 'text-red-500' : 'text-white/60';
                                const liqText =
                                  leg.liquidationPrice == null || leg.liquidationPrice <= 0
                                    ? 'Safe'
                                    : `$${leg.liquidationPrice.toLocaleString('en-US', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 6,
                                      })}`;
                                const fundingAmount = fundingPerLeg(pos, leg.exchange);
                                const fundingColor =
                                  fundingAmount > 0
                                    ? 'text-[#10b981]'
                                    : fundingAmount < 0
                                      ? 'text-red-500'
                                      : 'text-white/60';
                                return (
                                  <tr key={`${pos.symbol}-${leg.exchange}-${i}`} className="border-b border-white/5 last:border-0">
                                    <td className="px-3 py-2 text-white/90">{leg.exchange}</td>
                                    <td className="px-3 py-2 text-white/90">{leg.side}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-white/90">
                                      ${((leg.entryPrice * Math.abs(leg.size)) / (pos.leverage ?? 2)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-white/90">
                                      {Math.abs(leg.size).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-white/90">
                                      ${leg.entryPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-white/90">
                                      ${leg.markPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-white/70">{liqText}</td>
                                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${fundingColor}`}>
                                      ${fundingAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </td>
                                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${legPnlColor}`}>
                                      ${leg.pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}
