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

/** Persisted cache shape: intervals + updatedAt for priority ordering. */
interface PersistedCache {
  intervals?: Record<string, number>;
  updatedAt?: Record<string, number>;
}

/**
 * Smart Interval Discovery: chunked scanning of Binance funding rate history
 * to get TRUE intervals (1h, 2h, 4h, 8h) without triggering API rate limits.
 * Symbols are scanned by priority (1h first, then 2h, 4h, 8h) so fast-funding tokens stay in Batch 0.
 */
export class IntervalManager {
  private static instance: IntervalManager | null = null;
  private intervalCache: Record<string, number> = {};
  /** When each symbol was last updated; used to sort by "oldest checked first" within same tier. */
  private lastUpdatedAt: Record<string, number> = {};

  static getInstance(): IntervalManager {
    if (IntervalManager.instance === null) {
      IntervalManager.instance = new IntervalManager();
      IntervalManager.instance.loadCache();
    }
    return IntervalManager.instance;
  }

  /** Load cache from disk (intervals + updatedAt). Supports legacy format (intervals only). */
  loadCache(): void {
    try {
      if (!fs.existsSync(CACHE_PATH)) return;
      const raw = fs.readFileSync(CACHE_PATH, 'utf-8');
      const data = JSON.parse(raw) as PersistedCache | Record<string, number>;
      if (!data || typeof data !== 'object') return;
      if ('intervals' in data && data.intervals && typeof data.intervals === 'object') {
        this.intervalCache = { ...data.intervals };
        this.lastUpdatedAt = data.updatedAt && typeof data.updatedAt === 'object' ? { ...data.updatedAt } : {};
      } else {
        this.intervalCache = { ...(data as Record<string, number>) };
        this.lastUpdatedAt = {};
      }
      const n = Object.keys(this.intervalCache).length;
      console.log(`[IntervalManager] Loaded ${n} intervals from ${CACHE_PATH}`);
    } catch {
      // File missing or invalid — start with empty cache
    }
  }

  /** Persist intervals + updatedAt to disk. Call after every batch or initial scan. */
  saveCache(): void {
    try {
      const dir = path.dirname(CACHE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const payload: PersistedCache = {
        intervals: this.intervalCache,
        updatedAt: this.lastUpdatedAt,
      };
      fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 0), 'utf-8');
    } catch (err) {
      console.warn('[IntervalManager] saveCache failed:', err);
    }
  }

  /**
   * Returns all USDT symbols sorted by priority: 1h first, then 2h, 4h, 8h.
   * Within same interval, oldest-checked first (rotation). Batch 0 will thus scan high-priority tokens.
   */
  async getPrioritizedSymbols(manager: ExchangeManager): Promise<string[]> {
    const { binance } = await manager.getRates();
    const all = Object.keys(binance)
      .filter((s) => s.includes('USDT'))
      .sort();
    return all.slice().sort((a, b) => {
      const hoursA = this.getInterval(a);
      const hoursB = this.getInterval(b);
      if (hoursA !== hoursB) return hoursA - hoursB;
      const atA = this.getUpdatedAt(a);
      const atB = this.getUpdatedAt(b);
      return atA - atB;
    });
  }

  private getUpdatedAt(symbol: string): number {
    const full = symbol.includes('/') ? symbol : (symbol.replace(/USDT$/i, '') || symbol) + '/USDT:USDT';
    const base = symbol.includes('/') ? symbol.split('/')[0] + 'USDT' : (symbol.replace(/USDT:?USDT?/i, '') || symbol) + 'USDT';
    return this.lastUpdatedAt[symbol] ?? this.lastUpdatedAt[full] ?? this.lastUpdatedAt[base] ?? 0;
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
    const allSymbols = await this.getPrioritizedSymbols(manager);
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
   * Uses priority order (1h → 2h → 4h → 8h) so Batch 0 always scans fast-funding tokens.
   */
  async runBatchScan(manager: ExchangeManager, batchIndex: number, totalBatches: number): Promise<void> {
    const allSymbols = await this.getPrioritizedSymbols(manager);
    if (allSymbols.length === 0) {
      console.log('[IntervalManager] No symbols from getPrioritizedSymbols(), skipping batch');
      return;
    }
    const chunkSize = Math.ceil(allSymbols.length / totalBatches);
    const batchSymbols = allSymbols.slice(
      batchIndex * chunkSize,
      (batchIndex + 1) * chunkSize
    );
    if (batchSymbols.length === 0) return;
    const chunk = batchSymbols;
    const start = batchIndex * chunkSize;

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
    const now = Date.now();
    this.intervalCache[symbol] = hours;
    this.lastUpdatedAt[symbol] = now;
    const full = symbol.includes('/') ? symbol : (symbol.replace(/USDT$/i, '') || symbol) + '/USDT:USDT';
    const base = symbol.includes('/') ? symbol.split('/')[0] + 'USDT' : (symbol.replace(/USDT:?USDT?/i, '') || symbol) + 'USDT';
    if (full !== symbol) {
      this.intervalCache[full] = hours;
      this.lastUpdatedAt[full] = now;
    }
    if (base !== symbol && base !== full) {
      this.intervalCache[base] = hours;
      this.lastUpdatedAt[base] = now;
    }
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
