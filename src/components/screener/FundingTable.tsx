import { useScreener } from '../../hooks/useScreener';
import { RefreshCw } from 'lucide-react';
import type { FundingSpreadOpportunity } from '../../lib/utils/screener';

export default function FundingTable() {
  const { opportunities, isLoading, lastUpdated, refresh } = useScreener();

  if (isLoading && opportunities.length === 0) {
    return (
      <div className="glass flex min-h-[200px] items-center justify-center rounded-xl">
        <div className="text-white/70">Loading opportunities...</div>
      </div>
    );
  }

  if (opportunities.length === 0) {
    return (
      <div className="glass flex min-h-[200px] items-center justify-center rounded-xl">
        <div className="text-white/70">No opportunities found matching your criteria.</div>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="flex justify-between items-center mb-4 px-4 pt-4">
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

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left min-w-[640px]">
          <thead className="text-xs text-white/70 uppercase bg-white/5 border-b border-white/10">
            <tr>
              <th className="px-4 py-3 font-medium text-white">Symbol</th>
              <th className="px-4 py-3 text-center font-medium text-white">Interval</th>
              <th className="px-4 py-3 text-right font-medium text-white">Spread (Net)</th>
              <th className="px-4 py-3 text-center font-medium text-white">Strategy</th>
              <th className="px-4 py-3 text-right font-medium text-white">Score</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((row: FundingSpreadOpportunity) => {
              const displaySpread = typeof row.displaySpread === 'number' ? row.displaySpread : row.spread;
              const score = typeof row.score === 'number' ? row.score : 0;
              const intervalLabel = row.primaryInterval ?? (row.binanceInterval && row.bybitInterval ? `${row.binanceInterval}/${row.bybitInterval}` : '-');
              const strategyLabel = row.strategy ?? `Long ${row.longExchange} / Short ${row.shortExchange}`;
              return (
                <tr
                  key={row.symbol}
                  className="border-b border-white/5 transition-colors hover:bg-white/5"
                >
                  <td className="px-4 py-3 font-medium text-white">
                    {row.symbol.replace('/USDT:USDT', '').replace('/USDT', '')}
                    <div className="text-xs text-white/60 font-normal">
                      L: {row.longExchange} / S: {row.shortExchange}
                    </div>
                  </td>

                  <td className="px-4 py-3 text-center">
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        row.isAsymmetric ? 'bg-purple-500/20 text-purple-300' : 'bg-white/10 text-white/80'
                      }`}
                    >
                      {intervalLabel}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right font-mono text-[#10b981]">
                    +{(displaySpread * 100).toFixed(3)}%
                  </td>

                  <td className="px-4 py-3 text-center">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                      {strategyLabel}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right text-white/60">
                    {score.toFixed(0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
