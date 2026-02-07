import type { FundingRate, Position } from 'ccxt';
import { saveTrade, type TradeLeg } from '../storage/trades';
import { insertActiveTrade } from '../db/active-trades';
import { archiveTrade } from '../db/history';
import { BinanceExchange } from './binance';
import { BybitExchange } from './bybit';
import { WebSocketManager } from './websocket';

export interface DualTradeSides {
  binance: 'BUY' | 'SELL';
  bybit: 'BUY' | 'SELL';
}

export interface FundingRatesResult {
  binance: Record<string, FundingRate>;
  bybit: Record<string, FundingRate>;
}

export interface AggregatedBalances {
  binance: number;
  bybit: number;
  total: number;
  binanceUsedMargin: number;
  bybitUsedMargin: number;
  totalUsedMargin: number;
  /** Available (free) balance per exchange: total balance minus used margin. */
  binanceAvailable: number;
  bybitAvailable: number;
}

export interface ExchangePositionsResult {
  ok: boolean;
  data: Position[];
  error?: string;
}

export interface RawPositionsResult {
  binance: ExchangePositionsResult;
  bybit: ExchangePositionsResult;
  /** True only when both exchanges returned successfully. */
  dataComplete: boolean;
}

/** Max wait for exchange API calls. 45s to avoid false timeouts when Binance/Bybit are slow. */
const EXCHANGE_TIMEOUT_MS = 45_000;
/** Positions cache TTL: use cache if age < this (ms). */
const POSITIONS_CACHE_TTL_MS = 1000;
/** Funding intervals cache TTL to avoid API spam. */
const INTERVAL_CACHE_TTL_MS = 60_000;
/** Refresh Binance/Bybit funding intervals at most once per hour (new tokens, interval changes). */
const INTERVAL_REFRESH_RATE_MS = 60 * 60 * 1000;
/** Run resolveBinanceIntervals every 30 min to catch interval changes (e.g. 8h -> 4h). */
const INTERVAL_SCAN_PERIOD_MS = 30 * 60 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function logExchangeError(context: string, err: unknown) {
  if (err instanceof Error) {
    console.error(`🔥 CRITICAL FETCH ERROR: ${context}`, err.message, err.stack);
  } else {
    console.error(`🔥 CRITICAL FETCH ERROR: ${context}`, err);
  }
}

export class ExchangeManager {
  private binance: BinanceExchange;
  private bybit: BybitExchange;
  /** WebSocket manager for real-time price & funding rate; interval logic stays REST/history-based. */
  readonly wsManager: WebSocketManager;
  /** 30-min interval scan timer for resolveBinanceIntervals. */
  private intervalScanTimer: ReturnType<typeof setInterval> | null = null;
  /** Static cache shared across all instances so UI does not flicker on new requests. */
  private static lastValidBalances: { binance: number; bybit: number } = { binance: 0, bybit: 0 };
  private static lastValidPositions: { binance: Position[]; bybit: Position[] } = { binance: [], bybit: [] };
  /** Raw positions result cache for hybrid fetch (UI = cached, emergency = live). */
  private static lastRawPositionsFetchTime = 0;
  private static lastRawPositionsResult: RawPositionsResult | null = null;
  /** Funding rates cache for getFundingIntervals (60s TTL). */
  private static intervalCache: {
    binance: Record<string, FundingRate>;
    bybit: Record<string, FundingRate>;
    ts: number;
  } = { binance: {}, bybit: {}, ts: 0 };
  /**
   * Binance interval in HOURS from funding history only (history[1].fundingTime - history[0].fundingTime).
   * No guessing; 0 means unknown → screener excludes the token.
   */
  private static binanceIntervalCache: Record<string, number> = {};
  /** Bybit interval in HOURS from rate info (fundingIntervalHour). Populated from rates when available. */
  private static bybitIntervalCache: Record<string, number> = {};
  /** Last time we ran the full interval scan (for hourly refresh). */
  private static lastIntervalScan = 0;
  /** True once intervals have been loaded at least once. */
  private static areIntervalsLoaded = false;

  /** Round interval hours to standard 1, 2, 4, 8. */
  private static roundIntervalHours(h: number): number {
    if (h <= 0 || !Number.isFinite(h)) return 0;
    const candidates = [1, 2, 4, 8];
    let best = 1;
    let bestDiff = Math.abs(h - 1);
    for (const c of candidates) {
      const d = Math.abs(h - c);
      if (d < bestDiff) {
        bestDiff = d;
        best = c;
      }
    }
    return best;
  }

  constructor() {
    this.binance = new BinanceExchange();
    this.bybit = new BybitExchange();
    this.wsManager = new WebSocketManager();
    this.wsManager.start();
    this.scheduleIntervalScan();
    this.initialize().catch((err) => console.warn('[ExchangeManager] initialize failed', err));
  }

  /**
   * Load Binance markets and update WS symbol map so cache uses unified symbols (BTC/USDT:USDT).
   * Called automatically from constructor; can also be called at startup to ensure map is ready.
   */
  async initialize(): Promise<void> {
    try {
      const markets = await this.binance.loadMarketsAndGet();
      this.wsManager.updateSymbolMap(markets);
    } catch (err) {
      console.warn('[ExchangeManager] initialize (load markets) failed:', err);
    }
  }

  /**
   * Runs resolveBinanceIntervals every 30 minutes so interval changes (e.g. 8h -> 4h) are detected.
   * Uses symbols from the current WS (or REST) rates so no separate symbol list is required.
   */
  private scheduleIntervalScan(): void {
    if (this.intervalScanTimer != null) return;
    this.intervalScanTimer = setInterval(() => {
      this.getRates()
        .then((r) => {
          const symbols = Object.keys(r.binance).filter((s) => s.includes('/'));
          if (symbols.length > 0) {
            const baseSymbols = symbols.map((s) => s.split('/')[0] + 'USDT');
            return this.resolveBinanceIntervals(baseSymbols, true);
          }
        })
        .catch(() => {});
    }, INTERVAL_SCAN_PERIOD_MS);
    console.log('[ExchangeManager] Interval scan scheduled every 30 minutes');
  }

  /**
   * Returns funding rates from WebSocket cache (real-time). Waits 500ms if cache empty (mapping warm-up), then falls back to REST.
   * Use this for the screener so updates are instant and API limits are saved.
   */
  async getRates(): Promise<FundingRatesResult> {
    if (!this.wsManager.isReady()) {
      await new Promise((r) => setTimeout(r, 500));
    }

    const cache = this.wsManager.ratesCache;
    const binanceKeys = Object.keys(cache.binance).filter((s) => s.includes('/'));
    const bybitKeys = Object.keys(cache.bybit).filter((s) => s.includes('/'));
    if (binanceKeys.length > 0 && bybitKeys.length > 0) {
      const binance: Record<string, FundingRate> = {};
      const bybit: Record<string, FundingRate> = {};
      for (const sym of binanceKeys) {
        const e = cache.binance[sym];
        if (e) {
          binance[sym] = {
            symbol: sym,
            fundingRate: e.fundingRate,
            fundingTimestamp: e.nextFundingTime,
            markPrice: e.price,
            info: {},
          };
        }
      }
      for (const sym of bybitKeys) {
        const e = cache.bybit[sym];
        if (e) {
          bybit[sym] = {
            symbol: sym,
            fundingRate: e.fundingRate,
            fundingTimestamp: e.nextFundingTime,
            markPrice: e.price,
            info: {},
          };
        }
      }
      return { binance, bybit };
    }
    // Fallback: REST when WS still empty after wait (e.g. connection fail)
    const rest = await this.getFundingRates();
    const bybitSymbols = Object.keys(rest.bybit);
    if (bybitSymbols.length > 0) {
      this.wsManager.setBybitSymbols(bybitSymbols);
    }
    return rest;
  }

  /**
   * Fetches funding rates from both Binance and Bybit in parallel (REST).
   * Returns only USDT perpetuals. Used as fallback when WS cache is empty.
   */
  async getFundingRates(): Promise<FundingRatesResult> {
    const binanceRatesFetch = (async () => {
      const start = Date.now();
      try {
        const r = await withTimeout(
          this.binance.fetchFundingRates(),
          EXCHANGE_TIMEOUT_MS,
          'Binance fetchFundingRates'
        );
        console.log(`⚡ [${Date.now() - start}ms] Binance fetchFundingRates`);
        return r;
      } catch (err) {
        console.log(`⚡ [${Date.now() - start}ms] Binance fetchFundingRates FAILED`);
        logExchangeError('[ExchangeManager] Binance fetchFundingRates failed', err);
        return {};
      }
    })();
    const bybitRatesFetch = (async () => {
      const start = Date.now();
      try {
        const r = await withTimeout(
          this.bybit.fetchFundingRates(),
          EXCHANGE_TIMEOUT_MS,
          'Bybit fetchFundingRates'
        );
        console.log(`⚡ [${Date.now() - start}ms] Bybit fetchFundingRates`);
        return r;
      } catch (err) {
        console.log(`⚡ [${Date.now() - start}ms] Bybit fetchFundingRates FAILED`);
        logExchangeError('[ExchangeManager] Bybit fetchFundingRates failed', err);
        return {};
      }
    })();
    const [binanceRates, bybitRates] = await Promise.all([binanceRatesFetch, bybitRatesFetch]);
    return { binance: binanceRates, bybit: bybitRates };
  }

  /**
   * Fetches daily deposits and withdrawals from both exchanges.
   * Requires API keys with deposit/withdrawal history permission.
   */
  async fetchDailyTransfers(since: number): Promise<{ deposits: number; withdrawals: number }> {
    let deposits = 0;
    let withdrawals = 0;
    const sumOne = async (name: string, fn: () => Promise<{ deps: any[]; wths: any[] }>) => {
      try {
        const { deps, wths } = await fn();
        for (const d of deps) deposits += (d.amount as number) || 0;
        for (const w of wths) withdrawals += (w.amount as number) || 0;
      } catch (err) {
        console.warn(`[TransferSync] ${name} fetch failed:`, err);
      }
    };
    await Promise.all([
      sumOne('Binance', () =>
        Promise.all([
          this.binance.fetchDeposits('USDT', since),
          this.binance.fetchWithdrawals('USDT', since),
        ]).then(([deps, wths]) => ({ deps, wths }))
      ),
      sumOne('Bybit', () =>
        Promise.all([
          this.bybit.fetchDeposits('USDT', since),
          this.bybit.fetchWithdrawals('USDT', since),
        ]).then(([deps, wths]) => ({ deps, wths }))
      ),
    ]);
    return { deposits, withdrawals };
  }

  async getPrices(symbol: string): Promise<{ binance: number; bybit: number } | null> {
    const fullSymbol = symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`;
    try {
      const [binance, bybit] = await Promise.all([
        this.binance.getMarkPrice(fullSymbol),
        this.bybit.getMarkPrice(fullSymbol),
      ]);
      if (binance > 0 && bybit > 0) return { binance, bybit };
    } catch (err) {
      console.error('[ExchangeManager] getPrices failed:', err);
    }
    return null;
  }

  /**
   * Fetches USDT balances and used margin from both exchanges in parallel.
   * Uses Promise.allSettled so one failure does not block the other.
   */
  async getAggregatedBalances(): Promise<AggregatedBalances & { dataComplete: boolean }> {
    const binanceBalanceFetch = (async () => {
      const start = Date.now();
      try {
        const r = await withTimeout(
          this.binance.getBalanceWithMargin(),
          EXCHANGE_TIMEOUT_MS,
          'Binance getBalanceWithMargin'
        );
        console.log(`⚡ [${Date.now() - start}ms] Binance getBalanceWithMargin`);
        return r;
      } catch (e) {
        console.log(`⚡ [${Date.now() - start}ms] Binance getBalanceWithMargin FAILED`);
        throw e;
      }
    })();
    const bybitBalanceFetch = (async () => {
      const start = Date.now();
      try {
        const r = await withTimeout(
          this.bybit.getBalanceWithMargin(),
          EXCHANGE_TIMEOUT_MS,
          'Bybit getBalanceWithMargin'
        );
        console.log(`⚡ [${Date.now() - start}ms] Bybit getBalanceWithMargin`);
        return r;
      } catch (e) {
        console.log(`⚡ [${Date.now() - start}ms] Bybit getBalanceWithMargin FAILED`);
        throw e;
      }
    })();
    const [binanceSettled, bybitSettled] = await Promise.allSettled([binanceBalanceFetch, bybitBalanceFetch]);

    let binanceBalance: number;
    let binanceUsedMargin: number;
    let bybitBalance: number;
    let bybitUsedMargin: number;

    if (binanceSettled.status === 'fulfilled') {
      binanceBalance = binanceSettled.value.balance;
      binanceUsedMargin = binanceSettled.value.usedMargin;
      ExchangeManager.lastValidBalances.binance = binanceBalance;
    } else {
      console.warn('⚠️ Binance getBalanceWithMargin failed, using cached balance.', binanceSettled.reason);
      logExchangeError('[ExchangeManager] Binance getBalanceWithMargin failed', binanceSettled.reason);
      binanceBalance = ExchangeManager.lastValidBalances.binance;
      binanceUsedMargin = 0;
    }

    if (bybitSettled.status === 'fulfilled') {
      bybitBalance = bybitSettled.value.balance;
      bybitUsedMargin = bybitSettled.value.usedMargin;
      ExchangeManager.lastValidBalances.bybit = bybitBalance;
    } else {
      console.warn('⚠️ Bybit getBalanceWithMargin failed, using cached balance.', bybitSettled.reason);
      logExchangeError('[ExchangeManager] Bybit getBalanceWithMargin failed', bybitSettled.reason);
      bybitBalance = ExchangeManager.lastValidBalances.bybit;
      bybitUsedMargin = 0;
    }

    const dataComplete = binanceSettled.status === 'fulfilled' && bybitSettled.status === 'fulfilled';
    const total = binanceBalance + bybitBalance;

    if (!dataComplete && total === 0 && ExchangeManager.lastValidBalances.binance === 0 && ExchangeManager.lastValidBalances.bybit === 0) {
      throw new Error('Initial fetch failed');
    }

    return {
      binance: binanceBalance,
      bybit: bybitBalance,
      total,
      binanceUsedMargin,
      bybitUsedMargin,
      totalUsedMargin: binanceUsedMargin + bybitUsedMargin,
      binanceAvailable: Math.max(0, binanceBalance - binanceUsedMargin),
      bybitAvailable: Math.max(0, bybitBalance - bybitUsedMargin),
      dataComplete,
    };
  }

  /**
   * Returns last known per-exchange balances from cache (populated by any successful getAggregatedBalances call).
   * Use as fallback when live API times out so the UI does not show $0.00.
   */
  static getLastKnownBalances(): { binance: number; bybit: number } {
    return { ...ExchangeManager.lastValidBalances };
  }

  /**
   * Fetches raw positions from both exchanges in parallel via Promise.allSettled.
   * Returns ok/data per exchange so callers can detect fetch failure (incomplete data).
   * @param forceRefresh - If true, always fetch from API (for emergency exit verification). If false, return cache when age < 1000ms.
   */
  async getRawPositions(forceRefresh: boolean = false): Promise<RawPositionsResult> {
    if (!forceRefresh && ExchangeManager.lastRawPositionsResult != null) {
      const age = Date.now() - ExchangeManager.lastRawPositionsFetchTime;
      if (age < POSITIONS_CACHE_TTL_MS) {
        return ExchangeManager.lastRawPositionsResult;
      }
    }

    const binancePositionsFetch = (async () => {
      const start = Date.now();
      try {
        const r = await withTimeout(
          this.binance.fetchPositions(),
          EXCHANGE_TIMEOUT_MS,
          'Binance fetchPositions'
        );
        console.log(`⚡ [${Date.now() - start}ms] Binance fetchPositions`);
        return r;
      } catch (e) {
        console.log(`⚡ [${Date.now() - start}ms] Binance fetchPositions FAILED`);
        throw e;
      }
    })();
    const bybitPositionsFetch = (async () => {
      const start = Date.now();
      try {
        const r = await withTimeout(
          this.bybit.fetchPositions(),
          EXCHANGE_TIMEOUT_MS,
          'Bybit fetchPositions'
        );
        console.log(`⚡ [${Date.now() - start}ms] Bybit fetchPositions`);
        return r;
      } catch (e) {
        console.log(`⚡ [${Date.now() - start}ms] Bybit fetchPositions FAILED`);
        throw e;
      }
    })();
    const [binanceSettled, bybitSettled] = await Promise.allSettled([binancePositionsFetch, bybitPositionsFetch]);

    const binanceOk = binanceSettled.status === 'fulfilled';
    const bybitOk = bybitSettled.status === 'fulfilled';

    if (binanceOk) {
      ExchangeManager.lastValidPositions.binance = binanceSettled.value;
    } else {
      logExchangeError('[ExchangeManager] Binance fetchPositions failed', binanceSettled.reason);
      if (ExchangeManager.lastValidPositions.binance.length === 0) {
        throw new Error('Initial fetch failed');
      }
    }
    if (bybitOk) {
      ExchangeManager.lastValidPositions.bybit = bybitSettled.value;
    } else {
      logExchangeError('[ExchangeManager] Bybit fetchPositions failed', bybitSettled.reason);
      if (ExchangeManager.lastValidPositions.bybit.length === 0) {
        throw new Error('Initial fetch failed');
      }
    }

    const binanceData = binanceOk ? binanceSettled.value : ExchangeManager.lastValidPositions.binance;
    const bybitData = bybitOk ? bybitSettled.value : ExchangeManager.lastValidPositions.bybit;

    const result: RawPositionsResult = {
      binance: {
        ok: binanceOk,
        data: binanceData,
        error: !binanceOk ? (binanceSettled.reason instanceof Error ? binanceSettled.reason.message : String(binanceSettled.reason)) : undefined,
      },
      bybit: {
        ok: bybitOk,
        data: bybitData,
        error: !bybitOk ? (bybitSettled.reason instanceof Error ? bybitSettled.reason.message : String(bybitSettled.reason)) : undefined,
      },
      dataComplete: binanceOk && bybitOk,
    };

    ExchangeManager.lastRawPositionsFetchTime = Date.now();
    ExchangeManager.lastRawPositionsResult = result;
    return result;
  }

  /** Normalize interval to '1h', '2h', '4h', or '8h'. */
  private static normalizeInterval(interval: string | undefined): string {
    const s = (interval ?? '').toLowerCase().trim();
    if (s === '1h' || s === '1') return '1h';
    if (s === '2h' || s === '2') return '2h';
    if (s === '4h' || s === '4') return '4h';
    if (s === '8h' || s === '8') return '8h';
    return s || '8h';
  }

  /** Robust interval detection (same as screener). Returns 0 when unknown — no default to 8h. */
  private static getHoursFromRate(rate: FundingRate | undefined, exchange: string): number {
    if (!rate) return 0;
    const info = ((rate as unknown as { info?: Record<string, unknown> }).info || {}) as Record<string, unknown>;
    if (exchange === 'binance') {
      if (info.fundingIntervalHours != null) return parseFloat(String(info.fundingIntervalHours));
      if (rate.interval) {
        const s = String(rate.interval).toLowerCase();
        if (s.includes('h')) return parseFloat(s) || 0;
        if (s.includes('m')) return parseFloat(s) / 60 || 0;
      }
      return 0;
    }
    if (exchange === 'bybit') {
      if (info.fundingIntervalHour != null) return parseFloat(String(info.fundingIntervalHour));
      if (info.fundingInterval != null) return parseInt(String(info.fundingInterval), 10) / 60;
    }
    return 0;
  }

  /** Delay helper to let event loop and GC run between batches. */
  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Resolves Binance funding interval from HISTORY for the given symbols only.
   * Processes in small batches with delay between batches to avoid heap pressure and timeouts.
   */
  async resolveBinanceIntervals(symbols: string[], force: boolean = false): Promise<void> {
    const BATCH_SIZE = 15;
    const DELAY_BETWEEN_BATCHES_MS = 500;
    const toFetch = force ? symbols : symbols.filter((s) => !this.getCachedInterval(s, 'binance'));
    if (toFetch.length === 0) return;

    const binanceRates = ExchangeManager.intervalCache.binance;

    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const batch = toFetch.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (symbol) => {
          let hours = 0;
          const history = await this.binance.fetchFundingRateHistory(symbol, 2).catch(() => []);
          if (Array.isArray(history) && history.length >= 2) {
            const ts0 = history[0]?.fundingTime ?? 0;
            const ts1 = history[1]?.fundingTime ?? 0;
            if (ts0 > 0 && ts1 > 0) {
              const intervalMs = Math.abs(ts1 - ts0);
              const rawHours = intervalMs / (3600 * 1000);
              hours = ExchangeManager.roundIntervalHours(Math.round(rawHours));
            }
          }
          if (hours === 0) {
            const rate = binanceRates[symbol] ?? binanceRates[symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`];
            const apiHours = ExchangeManager.getHoursFromRate(rate, 'binance');
            hours = apiHours > 0 ? ExchangeManager.roundIntervalHours(apiHours) : 8;
          }
          return { symbol, hours };
        })
      );
      for (const { symbol, hours } of results) {
        ExchangeManager.binanceIntervalCache[symbol] = hours;
        const full = symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`;
        const base = symbol.includes('/') ? symbol.split('/')[0] + 'USDT' : symbol.replace(/USDT:?USDT?/i, '') + 'USDT';
        if (full !== symbol) ExchangeManager.binanceIntervalCache[full] = hours;
        if (base !== symbol && base !== full) ExchangeManager.binanceIntervalCache[base] = hours;
      }
      if (i + BATCH_SIZE < toFetch.length) {
        await ExchangeManager.delay(DELAY_BETWEEN_BATCHES_MS);
      }
    }
  }

  /**
   * Populates Bybit interval cache from rate info (fundingIntervalHour / fundingInterval).
   * Call before evaluation so getCachedInterval(symbol, 'bybit') returns correct values.
   */
  populateBybitIntervalsFromRates(bybitRates: Record<string, FundingRate>): void {
    for (const [symbol, rate] of Object.entries(bybitRates)) {
      const hours = ExchangeManager.getHoursFromRate(rate, 'bybit');
      if (hours > 0) {
        ExchangeManager.bybitIntervalCache[symbol] = hours;
        const base = symbol.includes('/') ? symbol.split('/')[0] + 'USDT' : symbol.replace(/USDT:?USDT?/i, '') + 'USDT';
        if (base !== symbol) ExchangeManager.bybitIntervalCache[base] = hours;
      }
    }
  }

  /**
   * Returns cached interval HOURS (1, 2, 4, 8) for the symbol on the given exchange.
   * Binance: history-based cache only (0 if not resolved). Bybit: from rate info cache.
   * Use for strict matching: if (binHours && byHours && binHours !== byHours) reject.
   */
  getCachedInterval(symbol: string, exchange: 'binance' | 'bybit'): number {
    const full = symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`;
    const base = symbol.includes('/') ? symbol.split('/')[0] + 'USDT' : symbol.replace(/USDT:?USDT?/i, '') + 'USDT';
    const cache = exchange === 'binance' ? ExchangeManager.binanceIntervalCache : ExchangeManager.bybitIntervalCache;
    const v = cache[full] ?? cache[symbol] ?? cache[base];
    return typeof v === 'number' && v > 0 ? v : 0;
  }

  /**
   * Returns Binance funding interval HOURS from history-based cache ONLY.
   * Returns 0 if not in cache or unknown. DO NOT fall back to guessing or 8h.
   */
  getBinanceIntervalHours(symbol: string): number {
    return this.getCachedInterval(symbol, 'binance');
  }

  /**
   * Refreshes funding rates cache (intervalCache) at most once per hour.
   * Does NOT resolve Binance intervals; screener must call resolveBinanceIntervals(commonTokens) before evaluation.
   */
  async refreshIntervalsIfNeeded(): Promise<void> {
    const now = Date.now();
    if (
      now - ExchangeManager.lastIntervalScan < INTERVAL_REFRESH_RATE_MS &&
      ExchangeManager.areIntervalsLoaded
    ) {
      return;
    }
    console.log('[System] ⏳ Refreshing funding rates cache...');
    try {
      const [binanceRates, bybitRates] = await Promise.all([
        withTimeout(this.binance.fetchFundingRates(), EXCHANGE_TIMEOUT_MS, 'Binance fetchFundingRates').catch(() => ({})),
        withTimeout(this.bybit.fetchFundingRates(), EXCHANGE_TIMEOUT_MS, 'Bybit fetchFundingRates').catch(() => ({})),
      ]);
      ExchangeManager.intervalCache = {
        binance: binanceRates as Record<string, FundingRate>,
        bybit: bybitRates as Record<string, FundingRate>,
        ts: Date.now(),
      };
      ExchangeManager.lastIntervalScan = Date.now();
      ExchangeManager.areIntervalsLoaded = true;
      console.log('[System] ✅ Funding rates cache updated.');
    } catch (err) {
      console.warn('[System] Interval refresh failed, keeping previous cache:', err);
    }
  }

  /**
   * Returns current funding interval HOURS (1, 2, 4, 8) or 0 when unknown.
   * Used by exit controller to avoid false interval-change exits.
   */
  async getFundingIntervalHours(symbol: string): Promise<{ binance: number; bybit: number }> {
    const fullSymbol = symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`;
    const now = Date.now();
    const cache = ExchangeManager.intervalCache;
    const cacheValid = now - cache.ts < INTERVAL_CACHE_TTL_MS;

    if (!cacheValid) {
      try {
        const [binanceRates, bybitRates] = await Promise.all([
          withTimeout(this.binance.fetchFundingRates(), EXCHANGE_TIMEOUT_MS, 'Binance fetchFundingRates').catch(() => ({})),
          withTimeout(this.bybit.fetchFundingRates(), EXCHANGE_TIMEOUT_MS, 'Bybit fetchFundingRates').catch(() => ({})),
        ]);
        ExchangeManager.intervalCache = {
          binance: binanceRates as Record<string, FundingRate>,
          bybit: bybitRates as Record<string, FundingRate>,
          ts: Date.now(),
        };
      } catch {
        /* keep previous cache */
      }
    }

    const binanceRate = ExchangeManager.intervalCache.binance[fullSymbol] ?? ExchangeManager.intervalCache.binance[symbol];
    const bybitRate = ExchangeManager.intervalCache.bybit[fullSymbol] ?? ExchangeManager.intervalCache.bybit[symbol];

    return {
      binance: ExchangeManager.getHoursFromRate(binanceRate, 'binance'),
      bybit: ExchangeManager.getHoursFromRate(bybitRate, 'bybit'),
    };
  }

  /**
   * Returns current funding intervals for a symbol on both exchanges.
   * Uses 60s in-memory cache. On API failure, does not assume change (returns cached or '8h').
   */
  async getFundingIntervals(symbol: string): Promise<{ binance: string; bybit: string }> {
    const fullSymbol = symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`;
    const now = Date.now();
    const cache = ExchangeManager.intervalCache;
    const cacheValid = now - cache.ts < INTERVAL_CACHE_TTL_MS;

    if (!cacheValid) {
      try {
        const [binanceRates, bybitRates] = await Promise.all([
          withTimeout(this.binance.fetchFundingRates(), EXCHANGE_TIMEOUT_MS, 'Binance fetchFundingRates').catch(() => ({})),
          withTimeout(this.bybit.fetchFundingRates(), EXCHANGE_TIMEOUT_MS, 'Bybit fetchFundingRates').catch(() => ({})),
        ]);
        ExchangeManager.intervalCache = {
          binance: binanceRates as Record<string, FundingRate>,
          bybit: bybitRates as Record<string, FundingRate>,
          ts: Date.now(),
        };
      } catch {
        // On failure keep previous cache; if no cache, use defaults below
      }
    }

    const binanceRate = ExchangeManager.intervalCache.binance[fullSymbol] ?? ExchangeManager.intervalCache.binance[symbol];
    const bybitRate = ExchangeManager.intervalCache.bybit[fullSymbol] ?? ExchangeManager.intervalCache.bybit[symbol];

    const binanceInterval = ExchangeManager.normalizeInterval(
      binanceRate?.interval ?? (binanceRate as unknown as { info?: { interval?: string } })?.info?.interval
    );
    const bybitInterval = ExchangeManager.normalizeInterval(
      bybitRate?.interval ?? (bybitRate as unknown as { info?: { interval?: string } })?.info?.interval
    );

    return { binance: binanceInterval, bybit: bybitInterval };
  }

  /**
   * Closes BOTH legs (Binance & Bybit). Uses Promise.allSettled so one failure does not stop the other.
   * Failed legs are retried once; if still failed, logs BROKEN HEDGE for Safety Watchman.
   * Returns exit prices for successful legs (for P&L / archive).
   */
  async closeAllPositions(symbol: string): Promise<{
    success: boolean;
    results: unknown[];
    exitPrices: { binance?: number; bybit?: number };
  }> {
    const fullSymbol = symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`;

    type CloseResult = { exchange: 'binance' | 'bybit'; ok: boolean; price?: number; error?: string };
    const closeBinance = (): Promise<CloseResult> =>
      this.binance
        .closePosition(fullSymbol)
        .then((r) => ({ exchange: 'binance' as const, ok: true, price: r.price }))
        .catch((err) => ({ exchange: 'binance' as const, ok: false, error: err?.message ?? String(err) }));
    const closeBybit = (): Promise<CloseResult> =>
      this.bybit
        .closePosition(fullSymbol)
        .then((r) => ({ exchange: 'bybit' as const, ok: true, price: r.price }))
        .catch((err) => ({ exchange: 'bybit' as const, ok: false, error: err?.message ?? String(err) }));

    const settled = await Promise.allSettled([closeBinance(), closeBybit()]);
    const results: CloseResult[] = settled.map((s, i) => {
      const name: 'binance' | 'bybit' = i === 0 ? 'binance' : 'bybit';
      if (s.status === 'fulfilled') return s.value;
      return { exchange: name, ok: false, error: (s.reason?.message ?? String(s.reason)) as string };
    });

    // Retry any failed leg once
    for (let i = 0; i < results.length; i++) {
      if (!results[i].ok) {
        const retry = i === 0 ? closeBinance() : closeBybit();
        const retried = await retry;
        results[i] = retried;
      }
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error(`BROKEN HEDGE: Failed to close ${symbol} on: ${failed.map((f) => f.exchange).join(', ')}. ${failed.map((f) => f.error).join('; ')}`);
    }

    const exitPrices: { binance?: number; bybit?: number } = {};
    for (const r of results) {
      if (r.ok && r.price != null && r.price > 0) {
        exitPrices[r.exchange] = r.price;
      }
    }

    return { success: failed.length === 0, results, exitPrices };
  }

  /**
   * Closes a position completely on the specified exchange with a market order.
   * Returns the exit price for the closed leg.
   */
  async closeInteractivePosition(symbol: string, exchange: string): Promise<{ price: number }> {
    const fullSymbol = symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`;
    if (exchange.toLowerCase() === 'binance') {
      return this.binance.closePosition(fullSymbol);
    }
    if (exchange.toLowerCase() === 'bybit') {
      return this.bybit.closePosition(fullSymbol);
    }
    throw new Error(`Unknown exchange: ${exchange}`);
  }

  /**
   * Returns the common (most restrictive) lot size step for both exchanges.
   * Use this to round quantity down so both legs execute identical amounts.
   */
  async getCommonLotSizeStep(symbol: string): Promise<number> {
    const [binStep, bybitStep] = await Promise.all([
      this.binance.getLotSizeStep(symbol).catch(() => 0.001),
      this.bybit.getLotSizeStep(symbol).catch(() => 0.001),
    ]);
    const step = Math.max(binStep, bybitStep, 0.001);
    return step;
  }

  /**
   * Executes a dual-legged trade on Binance and Bybit with rollback on failure.
   * Rounds quantity to common lot size so both legs execute identical amounts.
   */
  async executeDualTrade(
    symbol: string,
    quantity: number,
    leverage: number,
    sides: DualTradeSides
  ): Promise<{ success: true; tradeId: string }> {
    const step = await this.getCommonLotSizeStep(symbol);
    const finalQuantity = Math.floor(quantity / step) * step;
    if (finalQuantity <= 0) {
      throw new Error(`Quantity ${quantity} rounds to zero with step ${step}`);
    }
    if (Math.abs(finalQuantity - quantity) > step * 0.5) {
      console.log(`[Executor] Raw: ${quantity}, Step: ${step}, Final: ${finalQuantity}`);
    }
    quantity = finalQuantity;

    // a. Check balances on both exchanges
    const [binanceBalance, bybitBalance] = await Promise.all([
      this.binance.getBalance(),
      this.bybit.getBalance(),
    ]);
    const [binancePrice, bybitPrice] = await Promise.all([
      this.binance.getMarkPrice(symbol),
      this.bybit.getMarkPrice(symbol),
    ]);
    const binanceMarginRequired = (binancePrice * quantity) / leverage;
    const bybitMarginRequired = (bybitPrice * quantity) / leverage;
    if (binanceBalance < binanceMarginRequired) {
      throw new Error(
        `Insufficient Binance balance: need $${binanceMarginRequired.toFixed(2)}, have $${binanceBalance.toFixed(2)}`
      );
    }
    if (bybitBalance < bybitMarginRequired) {
      throw new Error(
        `Insufficient Bybit balance: need $${bybitMarginRequired.toFixed(2)}, have $${bybitBalance.toFixed(2)}`
      );
    }

    // b. Set leverage on both exchanges
    await Promise.all([
      this.binance.setLeverage(leverage, symbol),
      this.bybit.setLeverage(leverage, symbol),
    ]);

    const binanceSide = sides.binance.toLowerCase() as 'buy' | 'sell';
    const bybitSide = sides.bybit.toLowerCase() as 'buy' | 'sell';

    let leg1Result: { orderId: string; price: number; quantity: number } | null = null;

    try {
      // c. Execute Leg 1 (Binance)
      leg1Result = await this.binance.createMarketOrder(symbol, binanceSide, quantity);
    } catch (err) {
      // d. Leg 1 fails: Stop
      throw new Error(`Binance order failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      // e. Execute Leg 2 (Bybit)
      const leg2Result = await this.bybit.createMarketOrder(symbol, bybitSide, quantity);

      // g. Both succeed: Save to trades
      const legs: TradeLeg[] = [
        {
          exchange: 'binance',
          orderId: leg1Result.orderId,
          side: sides.binance,
          price: leg1Result.price,
          quantity: leg1Result.quantity,
        },
        {
          exchange: 'bybit',
          orderId: leg2Result.orderId,
          side: sides.bybit,
          price: leg2Result.price,
          quantity: leg2Result.quantity,
        },
      ];
      const trade = saveTrade({
        symbol,
        status: 'OPEN',
        legs,
      });

      const longEx = sides.binance === 'BUY' ? 'binance' : 'bybit';
      const shortEx = sides.binance === 'BUY' ? 'bybit' : 'binance';
      const entryBinance = legs.find((l) => l.exchange.toLowerCase() === 'binance')?.price ?? 0;
      const entryBybit = legs.find((l) => l.exchange.toLowerCase() === 'bybit')?.price ?? 0;
      insertActiveTrade({
        symbol,
        longExchange: longEx,
        shortExchange: shortEx,
        quantity: leg1Result.quantity,
        leverage,
        entryPriceBinance: entryBinance,
        entryPriceBybit: entryBybit,
      });

      return { success: true, tradeId: trade.id };
    } catch (err) {
      // f. Leg 2 fails: Rollback (close Leg 1 with market order)
      if (leg1Result) {
        const closeSide = sides.binance === 'BUY' ? 'sell' : 'buy';
        try {
          await this.binance.createMarketOrder(symbol, closeSide as 'buy' | 'sell', leg1Result.quantity);
        } catch (rollbackErr) {
          console.error('[ExchangeManager] Rollback failed:', rollbackErr);
        }
        // Record failed entry / rollback in trade_history
        try {
          archiveTrade({
            symbol,
            leverage,
            quantity: leg1Result.quantity,
            entryPriceLong: sides.binance === 'BUY' ? leg1Result.price : null,
            entryPriceShort: sides.binance === 'SELL' ? leg1Result.price : null,
            exitPriceLong: null,
            exitPriceShort: null,
            pnlLong: null,
            pnlShort: null,
            netPnl: 0,
            fundingReceived: 0,
            exitReason: 'Failed Entry / Rollback',
            executedBy: 'Bot',
            entryTime: new Date().toISOString(),
            exitTime: new Date().toISOString(),
          });
        } catch (archiveErr) {
          console.error('[ExchangeManager] archiveTrade (rollback) failed:', archiveErr);
        }
      }
      throw new Error(`Bybit order failed (Leg 1 rolled back): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
