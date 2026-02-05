'use client';

import { useEffect, useState, useRef } from 'react';

function getBaseSymbol(symbol: string): string {
  if (symbol.includes('/')) {
    return symbol.split('/')[0];
  }
  return symbol;
}

export function useTicker(symbol: string, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const [binancePrice, setBinancePrice] = useState<number>(0);
  const [bybitPrice, setBybitPrice] = useState<number>(0);
  const [binanceColor, setBinanceColor] = useState<string>('');
  const [bybitColor, setBybitColor] = useState<string>('');
  const binancePrevRef = useRef<number>(0);
  const bybitPrevRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
    const base = getBaseSymbol(symbol);
    const binanceSymbol = `${base.toLowerCase()}usdt`;
    const bybitSymbol = `${base}USDT`;

    const binanceUrl = `wss://stream.binance.com:9443/ws/${binanceSymbol}@ticker`;
    const bybitUrl = 'wss://stream.bybit.com/v5/public/linear';

    let binanceWs: WebSocket | null = null;
    let bybitWs: WebSocket | null = null;

    binanceWs = new WebSocket(binanceUrl);
    binanceWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const price = parseFloat(data.c ?? data.p ?? 0);
        if (price > 0) {
          setBinancePrice(price);
          setBinanceColor(
            binancePrevRef.current === 0
              ? ''
              : price > binancePrevRef.current
                ? 'text-green-500'
                : price < binancePrevRef.current
                  ? 'text-red-500'
                  : ''
          );
          binancePrevRef.current = price;
        }
      } catch {
        // ignore parse errors
      }
    };

    bybitWs = new WebSocket(bybitUrl);
    bybitWs.onopen = () => {
      bybitWs?.send(
        JSON.stringify({
          op: 'subscribe',
          args: [`tickers.${bybitSymbol}`],
        })
      );
    };
    bybitWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.topic?.startsWith('tickers.') && data.data?.lastPrice) {
          const price = parseFloat(data.data.lastPrice);
          if (price > 0) {
            setBybitPrice(price);
            setBybitColor(
              bybitPrevRef.current === 0
                ? ''
                : price > bybitPrevRef.current
                  ? 'text-green-500'
                  : price < bybitPrevRef.current
                    ? 'text-red-500'
                    : ''
            );
            bybitPrevRef.current = price;
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      binanceWs?.close();
      bybitWs?.close();
    };
  }, [symbol, enabled]);

  return { binancePrice, bybitPrice, binanceColor, bybitColor };
}
