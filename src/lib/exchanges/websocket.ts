/**
 * WebSocket manager for real-time mark price and funding rate from Binance and Bybit.
 * Used by the screener for instant rates; interval logic remains REST/history-based.
 */

import WebSocket from 'ws';

export interface RateEntry {
  price: number;
  fundingRate: number;
  nextFundingTime: number;
}

export interface RatesCache {
  binance: Record<string, RateEntry>;
  bybit: Record<string, RateEntry>;
}

const BINANCE_WS_MAIN = 'wss://fstream.binance.com/ws/!markPrice@arr@1s';
const BINANCE_WS_TEST = 'wss://stream.binancefuture.com/ws/!markPrice@arr@1s';
const BYBIT_WS_MAIN = 'wss://stream.bybit.com/v5/public/linear';
const BYBIT_WS_TEST = 'wss://stream-testnet.bybit.com/v5/public/linear';

const INITIAL_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 60_000;
const BYBIT_SUBSCRIBE_CHUNK = 100;

/** Normalize Binance symbol "BTCUSDT" -> "BTC/USDT:USDT" for consistency with REST/CCXT. */
function toCcxtSymbol(s: string): string {
  if (s.includes('/')) return s;
  const base = s.replace(/USDT$/i, '');
  return base ? `${base}/USDT:USDT` : s;
}

/** "BTC/USDT:USDT" or "BTCUSDT" -> "BTCUSDT" for Bybit subscription. */
function toBybitSymbol(s: string): string {
  if (!s.includes('/')) return s.replace(/USDT:?USDT?/i, '') + 'USDT';
  return s.split('/')[0] + 'USDT';
}

export class WebSocketManager {
  /** Public cache: symbol -> { price, fundingRate, nextFundingTime }. Keys are unified CCXT form (e.g. BTC/USDT:USDT) only. */
  public ratesCache: RatesCache = { binance: {}, bybit: {} };

  /** Map exchange symbol id (e.g. BTCUSDT) -> unified symbol (e.g. BTC/USDT:USDT). Populated via updateSymbolMap() from CCXT markets. */
  private symbolMap: Record<string, string> = {};

  /** Lazy map raw symbol -> unified when symbolMap not yet populated. */
  private reverseSymbolMap: Record<string, string> = {};

  private binanceWs: WebSocket | null = null;
  private bybitWs: WebSocket | null = null;
  private binanceReconnectAttempt = 0;
  private bybitReconnectAttempt = 0;
  private binanceReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private bybitReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private bybitSubscribed = new Set<string>();
  private isTestnet = process.env.USE_TESTNET === 'true';
  private destroyed = false;

  /** Resolve unified symbol: prefer CCXT symbolMap, else lazy toCcxtSymbol. */
  private unifiedKey(raw: string): string {
    return this.symbolMap[raw] ?? this.reverseSymbolMap[raw] ?? (this.reverseSymbolMap[raw] = toCcxtSymbol(raw));
  }

  /**
   * Bridge WS symbol (e.g. BTCUSDT) to screener symbol (e.g. BTC/USDT:USDT).
   * Call after loading CCXT markets: maps market.id -> market.symbol.
   */
  updateSymbolMap(markets: { id?: string; symbol?: string }[]): void {
    for (const m of markets) {
      if (m.id != null && m.symbol != null) this.symbolMap[m.id] = m.symbol;
    }
    console.log(`[WS] Symbol map updated: ${Object.keys(this.symbolMap).length} entries`);
  }

  private get binanceUrl(): string {
    return this.isTestnet ? BINANCE_WS_TEST : BINANCE_WS_MAIN;
  }

  private get bybitUrl(): string {
    return this.isTestnet ? BYBIT_WS_TEST : BYBIT_WS_MAIN;
  }

  private reconnectDelay(attempt: number): number {
    const ms = Math.min(INITIAL_RECONNECT_MS * Math.pow(2, attempt), MAX_RECONNECT_MS);
    return ms + Math.random() * 1000;
  }

  private connectBinance(): void {
    if (this.destroyed) return;
    try {
      this.binanceWs = new WebSocket(this.binanceUrl);
      this.binanceWs.on('open', () => {
        this.binanceReconnectAttempt = 0;
        console.log('[WS] Binance connected');
      });
      this.binanceWs.on('message', (data: WebSocket.RawData) => {
        try {
          const arr = JSON.parse(data.toString()) as unknown[];
          if (!Array.isArray(arr)) return;
          for (const item of arr) {
            const o = item as { s?: string; p?: string; r?: string; T?: number };
            const sym = o.s;
            if (!sym || typeof sym !== 'string') continue;
            const price = parseFloat(String(o.p ?? 0)) || 0;
            const fundingRate = parseFloat(String(o.r ?? 0)) || 0;
            const nextFundingTime = typeof o.T === 'number' ? o.T : parseInt(String(o.T ?? 0), 10) || 0;
            const unified = this.symbolMap[sym] ?? this.unifiedKey(sym);
            this.ratesCache.binance[unified] = { price, fundingRate, nextFundingTime };
          }
          // After first successful message, ensure Bybit is subscribed to the same symbols (if not yet)
          if (this.bybitWs?.readyState === WebSocket.OPEN && this.bybitSubscribed.size === 0) {
            // Fix: Cast 'arr' to 'any[]' first to avoid type conflict with 'unknown'
            const rawData = arr as any[];
            const symbols = Array.from(new Set(rawData.map((x: any) => x.s).filter((s: any) => typeof s === 'string'))) as string[];
            this.subscribeBybitTickers(symbols);
          }
        } catch (e) {
          // ignore parse errors
        }
      });
      this.binanceWs.on('close', () => {
        this.binanceWs = null;
        if (this.destroyed) return;
        const delay = this.reconnectDelay(this.binanceReconnectAttempt++);
        console.warn(`[WS] Binance closed, reconnecting in ${Math.round(delay)}ms`);
        this.binanceReconnectTimer = setTimeout(() => this.connectBinance(), delay);
      });
      this.binanceWs.on('error', (err) => {
        console.warn('[WS] Binance error:', err?.message ?? err);
      });
    } catch (err) {
      console.warn('[WS] Binance connect error:', err);
      const delay = this.reconnectDelay(this.binanceReconnectAttempt++);
      this.binanceReconnectTimer = setTimeout(() => this.connectBinance(), delay);
    }
  }

  private subscribeBybitTickers(symbols: string[]): void {
    const ws = this.bybitWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const toSub = symbols.filter((s) => !this.bybitSubscribed.has(s));
    if (toSub.length === 0) return;
    for (let i = 0; i < toSub.length; i += BYBIT_SUBSCRIBE_CHUNK) {
      const chunk = toSub.slice(i, i + BYBIT_SUBSCRIBE_CHUNK);
      const args = chunk.map((s) => `tickers.${s}`);
      ws.send(JSON.stringify({ op: 'subscribe', args }));
      chunk.forEach((s) => this.bybitSubscribed.add(s));
    }
    console.log(`[WS] Bybit subscribed to ${toSub.length} tickers (total ${this.bybitSubscribed.size})`);
  }

  /**
   * Call this when you have a list of symbols (e.g. from REST fallback) so Bybit gets tickers for them.
   * Symbols can be "BTCUSDT" or "BTC/USDT:USDT".
   */
  setBybitSymbols(symbols: string[]): void {
    const bybitSym = symbols.map((s) => toBybitSymbol(s));
    this.subscribeBybitTickers(bybitSym);
  }

  private connectBybit(): void {
    if (this.destroyed) return;
    try {
      this.bybitWs = new WebSocket(this.bybitUrl);
      this.bybitWs.on('open', () => {
        this.bybitReconnectAttempt = 0;
        console.log('[WS] Bybit connected');
        // Re-subscribe to previously known symbols after reconnect
        if (this.bybitSubscribed.size > 0) {
          this.subscribeBybitTickers(Array.from(this.bybitSubscribed));
        }
      });
      this.bybitWs.on('message', (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString()) as { topic?: string; data?: Record<string, string> };
          const topic = msg?.topic;
          const dataObj = msg?.data;
          if (!topic?.startsWith('tickers.') || !dataObj) return;
          const symbol = dataObj.symbol ?? topic.replace('tickers.', '');
          const price = parseFloat(String(dataObj.markPrice ?? 0)) || 0;
          const fundingRate = parseFloat(String(dataObj.fundingRate ?? 0)) || 0;
          const nextFundingTime = parseInt(String(dataObj.nextFundingTime ?? 0), 10) || 0;
          const key = this.unifiedKey(symbol);
          this.ratesCache.bybit[key] = { price, fundingRate, nextFundingTime };
        } catch {
          // ignore
        }
      });
      this.bybitWs.on('close', () => {
        this.bybitWs = null;
        if (this.destroyed) return;
        const delay = this.reconnectDelay(this.bybitReconnectAttempt++);
        console.warn(`[WS] Bybit closed, reconnecting in ${Math.round(delay)}ms`);
        this.bybitReconnectTimer = setTimeout(() => this.connectBybit(), delay);
      });
      this.bybitWs.on('error', (err) => {
        console.warn('[WS] Bybit error:', err?.message ?? err);
      });
    } catch (err) {
      console.warn('[WS] Bybit connect error:', err);
      const delay = this.reconnectDelay(this.bybitReconnectAttempt++);
      this.bybitReconnectTimer = setTimeout(() => this.connectBybit(), delay);
    }
  }

  start(): void {
    this.destroyed = false;
    this.connectBinance();
    this.connectBybit();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.binanceReconnectTimer) {
      clearTimeout(this.binanceReconnectTimer);
      this.binanceReconnectTimer = null;
    }
    if (this.bybitReconnectTimer) {
      clearTimeout(this.bybitReconnectTimer);
      this.bybitReconnectTimer = null;
    }
    if (this.binanceWs) {
      this.binanceWs.removeAllListeners();
      this.binanceWs.close();
      this.binanceWs = null;
    }
    if (this.bybitWs) {
      this.bybitWs.removeAllListeners();
      this.bybitWs.close();
      this.bybitWs = null;
    }
  }

  /** True if we have at least some data from both exchanges (unified keys only). */
  hasData(): boolean {
    const binanceKeys = Object.keys(this.ratesCache.binance).filter((k) => k.includes('/'));
    const bybitKeys = Object.keys(this.ratesCache.bybit).filter((k) => k.includes('/'));
    return binanceKeys.length > 0 && bybitKeys.length > 0;
  }

  /** True when WS cache is populated and ready for getRates() (alias for hasData for clarity). */
  isReady(): boolean {
    return this.hasData();
  }
}
