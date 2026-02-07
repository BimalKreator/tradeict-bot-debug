import fs from 'fs';
import path from 'path';
import { ExchangeManager } from '@/lib/exchanges/manager';

const DELAY_BETWEEN_FETCHES_MS = 100;
const INITIAL_SCAN_DELAY_MS = 300;
const STANDARD_INTERVALS = [1, 2, 4, 8] as const;
const MIN_CACHE_ENTRIES_TO_SKIP_SCAN = 50;

const CACHE_PATH = path.join(process.cwd(), 'data', 'interval-cache.json');

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Round hours to nearest standard interval (1, 2, 4, 8). */
function roundIntervalHours(h: number): number {
  if (h <= 0 || !Number.isFinite(h)) return 8;
  let best = 8;
  let bestDiff = Math.abs(h - 8);
  for (const c of STANDARD_INTERVALS) {
    const d = Math.abs(h - c);
    if (d < bestDiff) {
      bestDiff = d;
      best = c;
    }
  }
  return best;
}

/**
 * Smart Interval Discovery: chunked scanning of Binance funding rate history
 * to get TRUE intervals (1h, 2h, 4h, 8h) without triggering API rate limits.
 * Screener reads from cache only (lightning fast); batches run in background every 15 min.
 */
export class IntervalManager {
  private static instance: IntervalManager | null = null;
  private intervalCache: Record<string, number> = {};

  static getInstance(): IntervalManager {
    if (IntervalManager.instance === null) {
      IntervalManager.instance = new IntervalManager();
      IntervalManager.instance.loadCache();
    }
    return IntervalManager.instance;
  }

  /** Load cache from disk so bot has full interval data immediately after restart. */
  loadCache(): void {
    try {
      if (!fs.existsSync(CACHE_PATH)) return;
      const raw = fs.readFileSync(CACHE_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        this.intervalCache = { ...data };
        const n = Object.keys(this.intervalCache).length;
        console.log(`[IntervalManager] Loaded ${n} intervals from ${CACHE_PATH}`);
      }
    } catch {
      // File missing or invalid — start with empty cache
    }
  }

  /** Persist cache to disk. Call after each batch or initial scan completes. */
  saveCache(): void {
    try {
      const dir = path.dirname(CACHE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(CACHE_PATH, JSON.stringify(this.intervalCache, null, 0), 'utf-8');
    } catch (err) {
      console.warn('[IntervalManager] saveCache failed:', err);
    }
  }

  /**
   * Warm-up: full scan with 300ms delay between fetches to stay under Binance rate limit.
   * Skipped if cache already has > 50 entries (e.g. loaded from disk).
   */
  async runInitialFullScan(manager: ExchangeManager): Promise<void> {
    const entries = Object.keys(this.intervalCache).length;
    if (entries > MIN_CACHE_ENTRIES_TO_SKIP_SCAN) {
      console.log(`[IntervalManager] Cache has ${entries} entries, skipping initial full scan`);
      return;
    }
    const { binance } = await manager.getRates();
    const allSymbols = Object.keys(binance)
      .filter((s) => s.includes('USDT'))
      .sort();
    if (allSymbols.length === 0) {
      console.log('[IntervalManager] No symbols for initial scan');
      return;
    }
    console.log(`[IntervalManager] Initial full scan: ${allSymbols.length} symbols (${INITIAL_SCAN_DELAY_MS}ms between fetches)`);
    for (const symbol of allSymbols) {
      try {
        const history = await manager.fetchBinanceFundingRateHistory(symbol, 2);
        if (Array.isArray(history) && history.length >= 2) {
          const t0 = history[0]?.fundingTime ?? 0;
          const t1 = history[1]?.fundingTime ?? 0;
          if (t0 > 0 && t1 > 0) {
            const diffMs = Math.abs(t1 - t0);
            const rawHours = diffMs / 3600000;
            const hours = roundIntervalHours(Math.round(rawHours));
            this.setCached(symbol, hours);
          } else {
            this.setCached(symbol, 8);
          }
        } else {
          this.setCached(symbol, 8);
        }
      } catch {
        this.setCached(symbol, 8);
      }
      await delay(INITIAL_SCAN_DELAY_MS);
    }
    this.saveCache();
    console.log(`[IntervalManager] Initial full scan done. Cached ${Object.keys(this.intervalCache).length} intervals.`);
  }

  /**
   * Run one batch of the chunked scan (25% of symbols when totalBatches=4).
   * Fetches funding rate history for each symbol in the chunk and computes interval from time diff.
   */
  async runBatchScan(manager: ExchangeManager, batchIndex: number, totalBatches: number): Promise<void> {
    const { binance } = await manager.getRates();
    const allSymbols = Object.keys(binance)
      .filter((s) => s.includes('USDT'))
      .sort();
    if (allSymbols.length === 0) {
      console.log('[IntervalManager] No symbols from getRates(), skipping batch');
      return;
    }
    const chunkSize = Math.ceil(allSymbols.length / totalBatches);
    const start = batchIndex * chunkSize;
    const chunk = allSymbols.slice(start, start + chunkSize);
    if (chunk.length === 0) return;

    console.log(
      `[IntervalManager] Batch ${batchIndex + 1}/${totalBatches}: scanning ${chunk.length} symbols (${start}-${start + chunk.length - 1})`
    );

    for (const symbol of chunk) {
      try {
        const history = await manager.fetchBinanceFundingRateHistory(symbol, 2);
        if (Array.isArray(history) && history.length >= 2) {
          const t0 = history[0]?.fundingTime ?? 0;
          const t1 = history[1]?.fundingTime ?? 0;
          if (t0 > 0 && t1 > 0) {
            const diffMs = Math.abs(t1 - t0);
            const rawHours = diffMs / 3600000;
            const hours = roundIntervalHours(Math.round(rawHours));
            this.setCached(symbol, hours);
          } else {
            this.setCached(symbol, 8);
          }
        } else {
          this.setCached(symbol, 8);
        }
      } catch {
        this.setCached(symbol, 8);
      }
      await delay(DELAY_BETWEEN_FETCHES_MS);
    }

    const sample = chunk.slice(0, 3).map((s) => [s, this.intervalCache[s] ?? 8]);
    console.log('[IntervalManager] Batch done. Sample:', sample);
    this.saveCache();
  }

  private setCached(symbol: string, hours: number): void {
    this.intervalCache[symbol] = hours;
    const full = symbol.includes('/') ? symbol : (symbol.replace(/USDT$/i, '') || symbol) + '/USDT:USDT';
    const base = symbol.includes('/') ? symbol.split('/')[0] + 'USDT' : (symbol.replace(/USDT:?USDT?/i, '') || symbol) + 'USDT';
    if (full !== symbol) this.intervalCache[full] = hours;
    if (base !== symbol && base !== full) this.intervalCache[base] = hours;
  }

  /**
   * Returns cached interval in hours (1, 2, 4, 8). Defaults to 8 if not yet scanned.
   */
  getInterval(symbol: string): number {
    const full = symbol.includes('/') ? symbol : (symbol.replace(/USDT$/i, '') || symbol) + '/USDT:USDT';
    const base = symbol.includes('/') ? symbol.split('/')[0] + 'USDT' : (symbol.replace(/USDT:?USDT?/i, '') || symbol) + 'USDT';
    const v = this.intervalCache[symbol] ?? this.intervalCache[full] ?? this.intervalCache[base];
    return typeof v === 'number' && v > 0 ? v : 8;
  }
}
