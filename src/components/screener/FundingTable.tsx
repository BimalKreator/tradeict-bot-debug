'use client';

import { useScreener } from '../../hooks/useScreener';
import { RefreshCw } from 'lucide-react';

interface FundingSpreadOpportunity {
  symbol: string;
  spread: number;
  binanceRate: number;
  bybitRate: number;
  binanceInterval: string;
  bybitInterval: string;
  strategy: string;
  score: number;
  displaySpread?: number;
}

export default function FundingTable() {
  const { opportunities, isLoading, lastUpdated, refresh } = useScreener();

  if (isLoading && (!opportunities || opportunities.length === 0)) {
    return (
      <div className="p-8 text-center text-white/50 animate-pulse">
        Scanning market...
      </div>
    );
  }

  if (!opportunities || opportunities.length === 0) {
    return (
      <div className="p-8 text-center text-white/50 bg-white/5 rounded-xl border border-white/10">
        No opportunities found.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center px-2">
        <div className="text-xs text-white/60">
          Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : '-'}
        </div>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-white/80"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="overflow-x-auto bg-[#0a0f1c] rounded-xl border border-white/10 shadow-2xl">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/10 text-xs text-white/40 uppercase tracking-wider">
              <th className="p-4 font-medium">Symbol</th>
              <th className="p-4 font-medium text-right">Binance (Rate/Int)</th>
              <th className="p-4 font-medium text-right">Bybit (Rate/Int)</th>
              <th className="p-4 font-medium text-right">Spread (Net)</th>
              <th className="p-4 font-medium text-right">Strategy</th>
              <th className="p-4 font-medium text-right">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {opportunities.map((row: FundingSpreadOpportunity) => (
              <tr key={row.symbol} className="hover:bg-white/5 transition-colors group">
                <td className="p-4 font-bold text-white group-hover:text-cyan-400 transition-colors">
                  {row.symbol.replace('/USDT', '').replace(':USDT', '')}
                  <div className="text-[10px] text-white/30 font-normal">USDT Perp</div>
                </td>

                <td className="p-4 text-right">
                  <div className="text-emerald-400 font-mono">{(row.binanceRate * 100).toFixed(4)}%</div>
                  <div className="text-[10px] text-white/30 font-mono">{row.binanceInterval}</div>
                </td>

                <td className="p-4 text-right">
                  <div className="text-emerald-400 font-mono">{(row.bybitRate * 100).toFixed(4)}%</div>
                  <div className="text-[10px] text-white/30 font-mono">{row.bybitInterval}</div>
                </td>

                <td className="p-4 text-right font-bold text-cyan-400 font-mono text-lg">
                  +{((row.displaySpread ?? row.spread) * 100).toFixed(4)}%
                </td>

                <td className="p-4 text-right">
                  <span className="inline-block px-2 py-1 rounded bg-white/10 border border-white/10 text-[10px] text-white/70">
                    {row.strategy}
                  </span>
                </td>

                <td className="p-4 text-right text-white/40 font-mono text-xs">
                  {Math.round(row.score)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
