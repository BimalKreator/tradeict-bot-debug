'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

function strategyToDirection(strategy: string): string {
  const s = (strategy || '').toLowerCase();
  if (s.includes('long bin') && s.includes('short byb')) return 'LongBinance_ShortBybit';
  if (s.includes('long byb') && s.includes('short bin')) return 'LongBybit_ShortBinance';
  return 'LongBinance_ShortBybit';
}

export interface TradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  strategy: string;
  binancePrice: number;
  bybitPrice: number;
}

export function TradeModal({
  isOpen,
  onClose,
  symbol,
  strategy,
  binancePrice,
  bybitPrice,
}: TradeModalProps) {
  const [quantity, setQuantity] = useState('');
  const [leverage, setLeverage] = useState(2);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');

  const qty = parseFloat(quantity) || 0;
  const binanceNotional = binancePrice * qty;
  const bybitNotional = bybitPrice * qty;
  const binanceMargin = leverage > 0 ? binanceNotional / leverage : 0;
  const bybitMargin = leverage > 0 ? bybitNotional / leverage : 0;
  const totalMargin = binanceMargin + bybitMargin;

  const handleConfirm = async () => {
    if (qty <= 0) {
      setError('Enter a valid quantity');
      return;
    }
    setError('');
    setExecuting(true);
    try {
      const res = await fetch('/api/trade/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`,
          quantity: qty,
          leverage,
          direction: strategyToDirection(strategy),
          strategy,
          isManual: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error(data.error ?? 'Manual trading is disabled');
        }
        throw new Error(data.error ?? 'Trade failed');
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trade failed');
    } finally {
      setExecuting(false);
    }
  };

  if (!isOpen) return null;

  const displaySymbol = (symbol || '').replace('/USDT:USDT', '').replace(':USDT', '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-xl border border-white/10 bg-[#0a0f1c] p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-white/50 hover:text-white"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <h3 className="mb-4 text-lg font-semibold text-white">
          Manual Trade — {displaySymbol}
        </h3>

        <div className="mb-4 rounded-lg bg-white/5 p-3 text-sm">
          <div className="flex justify-between text-white/70">
            <span>Binance Mark Price:</span>
            <span className="font-mono text-white">
              ${binancePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-white/70">
            <span>Bybit Mark Price:</span>
            <span className="font-mono text-white">
              ${bybitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
            </span>
          </div>
        </div>

        <p className="mb-3 text-xs text-white/60">{strategy}</p>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-white/60">Quantity (Token Amount)</label>
            <input
              type="number"
              step="any"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-white placeholder:text-white/30 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-white/60">Leverage (1x–20x)</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="20"
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="flex-1 accent-cyan-500"
              />
              <span className="w-10 text-right font-mono text-white">{leverage}x</span>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/40 p-3">
            <div className="text-xs text-white/60">
              Binance Margin: ${binanceMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="mt-1 text-xs text-white/60">
              Bybit Margin: ${bybitMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="mt-2 border-t border-white/10 pt-2 text-sm font-semibold text-cyan-400">
              Total Margin: ${totalMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-white/20 py-2 text-white/80 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={executing || qty <= 0}
              className="flex-1 rounded-lg bg-cyan-600 py-2 font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
            >
              {executing ? 'Executing...' : 'Confirm Trade'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
