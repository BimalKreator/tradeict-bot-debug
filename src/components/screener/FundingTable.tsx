import { useScreener } from '../../hooks/useScreener';
import { RefreshCw } from 'lucide-react';
import type { FundingSpreadOpportunity } from '../../lib/utils/screener';

export default function FundingTable() {
  const { opportunities, isLoading, lastUpdated, refresh } = useScreener();

  if (isLoading && opportunities.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        Loading opportunities...
      </div>
    );
  }

  if (opportunities.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No opportunities found matching your criteria.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex justify-between items-center mb-4 px-2">
        <div className="text-xs text-gray-500">
          Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : '-'}
        </div>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="p-1.5 hover:bg-gray-800 rounded-full transition-colors"
        >
          <RefreshCw className={`w-4 h-4 text-gray-400 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <table className="w-full text-sm text-left text-gray-400">
        <thead className="text-xs text-gray-500 uppercase bg-gray-800/50">
          <tr>
            <th className="px-4 py-3">Symbol</th>
            <th className="px-4 py-3 text-center">Interval</th>
            <th className="px-4 py-3 text-right">Spread (Net)</th>
            <th className="px-4 py-3 text-center">Strategy</th>
            <th className="px-4 py-3 text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((row: FundingSpreadOpportunity) => (
            <tr key={row.symbol} className="border-b border-gray-800 hover:bg-gray-800/20">
              <td className="px-4 py-3 font-medium text-white">
                {row.symbol}
                <div className="text-xs text-gray-600 font-normal">
                  L: {row.longExchange} / S: {row.shortExchange}
                </div>
              </td>

              <td className="px-4 py-3 text-center">
                <span className={`px-2 py-1 rounded text-xs ${
                  row.isAsymmetric ? 'bg-purple-900/30 text-purple-400' : 'bg-gray-800 text-gray-300'
                }`}>
                  {row.isAsymmetric
                    ? `${row.binanceInterval}/${row.bybitInterval}`
                    : row.primaryInterval}
                </span>
              </td>

              <td className="px-4 py-3 text-right font-mono text-green-400">
                +{(row.displaySpread * 100).toFixed(3)}%
              </td>

              <td className="px-4 py-3 text-center">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  row.isAsymmetric
                    ? 'bg-blue-900/20 text-blue-400 border border-blue-900/50'
                    : 'bg-green-900/20 text-green-400 border border-green-900/50'
                }`}>
                  {row.isAsymmetric ? 'Freq. Arb' : 'Standard'}
                </span>
              </td>

              <td className="px-4 py-3 text-right text-gray-500">
                {row.score.toFixed(0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
