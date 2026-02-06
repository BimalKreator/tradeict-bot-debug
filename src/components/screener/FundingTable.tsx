'use client';

import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

function normalizeSymbol(s: string): string {
  return s.replace('/USDT:USDT', '').replace('/USDT', '').replace(':USDT', '');
}

export default function FundingTable() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextSymbol, setNextSymbol] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchData = () => {
    fetch('/api/screener')
      .then((res) => res.json())
      .then((json) => {
        setData(Array.isArray(json) ? json : []);
      })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkNext = () => {
      fetch('/api/next-entry')
        .then((r) => r.json())
        .then((d) => {
          if (d.symbol && d.readyToTrade) setNextSymbol(d.symbol);
          else setNextSymbol(null);
        })
        .catch(() => {});
    };
    checkNext();
    const interval = setInterval(checkNext, 3000);
    return () => clearInterval(interval);
  }, []);

  const filteredData = data.filter((item) =>
    (item.symbol || '').toLowerCase().includes(search.toLowerCase())
  );

  if (loading && data.length === 0) {
    return (
      <div className="p-8 text-center text-white/50 animate-pulse">
        Scanning market...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <input
            type="text"
            placeholder="🔍 Search Token (e.g. BTC, ETH)..."
            className="w-full bg-[#1e2329] border border-white/10 rounded-lg px-4 py-2 text-white placeholder:text-white/40 focus:outline-none focus:border-cyan-500/50 transition-colors"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => {
            setLoading(true);
            fetchData();
          }}
          disabled={loading}
          className="p-2.5 hover:bg-white/10 rounded-lg transition-colors text-white/80 border border-white/10"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
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
            {filteredData.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-white/50">
                  {search ? `No results for "${search}"` : 'No opportunities found.'}
                </td>
              </tr>
            ) : (
              filteredData.map((row) => {
                const isNext =
                  nextSymbol &&
                  (row.symbol === nextSymbol || normalizeSymbol(row.symbol) === normalizeSymbol(nextSymbol));
                return (
                  <tr
                    key={row.symbol}
                    className={`transition-colors group ${
                      isNext
                        ? 'bg-yellow-500/10 border-l-4 border-l-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.2)]'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <td className="p-4 font-bold text-white group-hover:text-cyan-400 transition-colors">
                      {(row.symbol || '').replace('/USDT', '').replace(':USDT', '')}
                      <div className="text-[10px] text-white/30 font-normal">USDT Perp</div>
                      {isNext && (
                        <span className="ml-1 text-[10px] bg-yellow-500 text-black px-1 rounded animate-pulse">
                          NEXT
                        </span>
                      )}
                    </td>

                    <td className="p-4 text-right">
                      <div
                        className={`font-mono ${
                          (row.binanceRate ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {((row.binanceRate ?? 0) * 100).toFixed(4)}%
                      </div>
                      <div className="text-[10px] text-white/30 font-mono">
                        {row.binanceInterval || '-'}
                      </div>
                    </td>

                    <td className="p-4 text-right">
                      <div
                        className={`font-mono ${
                          (row.bybitRate ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {((row.bybitRate ?? 0) * 100).toFixed(4)}%
                      </div>
                      <div className="text-[10px] text-white/30 font-mono">
                        {row.bybitInterval || '-'}
                      </div>
                    </td>

                    <td className="p-4 text-right font-bold text-cyan-400 font-mono text-lg">
                      +{((row.displaySpread ?? row.spread ?? 0) * 100).toFixed(4)}%
                    </td>

                    <td className="p-4 text-right">
                      <span className="inline-block px-2 py-1 rounded bg-white/10 border border-white/10 text-[10px] text-white/70">
                        {row.strategy}
                      </span>
                    </td>

                    <td className="p-4 text-right text-white/40 font-mono text-xs">
                      {Math.round(row.score ?? 0)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
