'use client';

import { useRef, useEffect, useState } from 'react';
import { useTicker } from '../../hooks/useTicker';
import { showToast } from '../../lib/utils/toast';

interface TradeEntryDropdownProps {
  symbol: string;
  direction: string;
  binancePrice: number;
  bybitPrice: number;
  variant?: 'default' | 'card' | 'compact';
  disabled?: boolean;
  disabledReason?: string;
}

export function TradeEntryDropdown({
  symbol,
  direction,
  binancePrice: binancePriceProp,
  bybitPrice: bybitPriceProp,
  variant = 'default',
  disabled = false,
  disabledReason = 'Manual Trading Disabled',
}: TradeEntryDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [leverage, setLeverage] = useState(1);
  const [executing, setExecuting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { binancePrice: liveBinance, bybitPrice: liveBybit, binanceColor, bybitColor } = useTicker(symbol, {
    enabled: isOpen,
  });

  const binancePrice = liveBinance > 0 ? liveBinance : binancePriceProp;
  const bybitPrice = liveBybit > 0 ? liveBybit : bybitPriceProp;

  const qty = parseFloat(quantity) || 0;
  const binanceNotional = binancePrice * qty;
  const bybitNotional = bybitPrice * qty;
  const binanceMargin = leverage > 0 ? binanceNotional / leverage : 0;
  const bybitMargin = leverage > 0 ? bybitNotional / leverage : 0;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  const handleExecute = async () => {
    if (executing || qty <= 0) return;
    setExecuting(true);
    try {
      const res = await fetch('/api/trade/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`,
          quantity: qty,
          leverage,
          direction,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Trade failed');
      }
      setIsOpen(false);
    } catch (err) {
      console.error('Execute trade error:', err);
      showToast(err instanceof Error ? err.message : 'Trade failed', 'error');
    } finally {
      setExecuting(false);
    }
  };

  const isCard = variant === 'card';
  const isCompact = variant === 'compact';
  const buttonClass = (() => {
    if (isCard) {
      return 'w-full rounded-lg bg-gradient-to-r from-[#00d4ff] to-blue-500 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90';
    }
    if (isCompact) {
      return 'rounded-md bg-cyan-500/20 px-2 py-1 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/30';
    }
    return 'rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
  })();
  const finalButtonClass = `${buttonClass} ${
    disabled ? 'cursor-not-allowed opacity-50 hover:opacity-50' : ''
  }`;

  return (
    <div ref={containerRef} className={isCard ? 'w-full' : 'relative'}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setIsOpen(!isOpen);
        }}
        className={finalButtonClass}
        aria-disabled={disabled}
        title={disabled ? disabledReason : undefined}
      >
        {isCard ? 'Trade Now' : 'Trade'}
      </button>

      {isOpen && (
        <div className={`absolute top-full z-50 mt-1 rounded-lg border border-white/10 bg-[#0a0a0f] p-4 shadow-xl ${isCard ? 'left-0 right-0 w-full' : 'right-0 w-80'}`}>
          <div className="mb-3 font-medium text-zinc-900 dark:text-zinc-100">
            {symbol.replace('/USDT:USDT', '')} — {direction}
          </div>

          <div className="mb-3 text-xs text-zinc-600 dark:text-zinc-400">
            Prices: <span className={binanceColor || undefined}>Binance ${binancePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
            {' | '}
            <span className={bybitColor || undefined}>Bybit ${bybitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-white/60">
                Quantity (Token Amount)
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                className="w-full rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-[#00d4ff] focus:outline-none focus:ring-1 focus:ring-[#00d4ff]"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-white/60">
                Leverage (1x–125x)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="1"
                  max="125"
                  value={leverage}
                  onChange={(e) => setLeverage(Number(e.target.value))}
                  className="flex-1"
                />
                <input
                  type="number"
                  min="1"
                  max="125"
                  value={leverage}
                  onChange={(e) => setLeverage(Math.min(125, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-center text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
                <span className="text-xs text-zinc-500">x</span>
              </div>
            </div>

            <div className="rounded-md bg-white/5 px-3 py-2 text-xs">
              <div className="text-white/60">
                Binance Notional: ${binanceNotional.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Bybit Notional: ${bybitNotional.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="mt-1 font-medium text-white">
                Binance Margin: ${binanceMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Bybit Margin: ${bybitMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            <button
              type="button"
              onClick={handleExecute}
              disabled={executing || qty <= 0}
              className="w-full rounded-lg bg-gradient-to-r from-[#00d4ff] to-blue-500 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {executing ? 'Executing...' : 'Execute Trade'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
