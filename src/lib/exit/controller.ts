import { db } from '@/lib/db/sqlite';
import { archiveTrade, type ArchiveTradeData } from '@/lib/db/history';
import { addNotification } from '@/lib/db/notifications';
import { insertActiveTrade } from '../db/active-trades';
import { invalidatePositionsCache } from '../cache/positions-cache';
import { ExchangeManager } from '../exchanges/manager';
import { PositionTracker } from '../exchanges/position-tracker';
import type { GroupedPosition } from '../exchanges/position-tracker';
import {
  checkLiquidationBuffer,
  checkNegativeFunding,
  checkMTMStoploss,
  checkStrategyFlip,
  checkIntervalChange,
  type ActiveTrade,
  type BotSettings,
} from './strategies';

type TradeRow = ActiveTrade & {
  id: number;
  leverage?: number | null;
  created_at?: string | null;
};

type SettingsRow = {
  auto_exit_enabled: number;
  liquidation_buffer: number;
  negative_funding_exit: number;
  mtm_stoploss_enabled: number;
  mtm_stoploss_percent: number;
};

function normalizeSymbol(symbol: string): string {
  if (!symbol) return '';
  if (symbol.includes('/')) return symbol.split('/')[0];
  return symbol.replace(/USDT:?USDT?$/i, '');
}

function fetchSettings(): BotSettings & { auto_exit_enabled: number } {
  const row = db.db
    .prepare<[], SettingsRow>(
      `SELECT auto_exit_enabled, liquidation_buffer, negative_funding_exit,
              mtm_stoploss_enabled, mtm_stoploss_percent
         FROM bot_settings WHERE id = 1`
    )
    .get() ?? {
    auto_exit_enabled: 0,
    liquidation_buffer: 0,
    negative_funding_exit: 0,
    mtm_stoploss_enabled: 0,
    mtm_stoploss_percent: 0,
  };

  return row;
}

function fetchActiveTrades(): TradeRow[] {
  return db.db
    .prepare(
      `SELECT id, symbol, long_exchange, short_exchange, quantity,
              allocated_capital, entry_price_binance, entry_price_bybit,
              liquidation_binance, liquidation_bybit, next_funding_time,
              funding_received, leverage, created_at, interval
         FROM active_trades
        WHERE status = 'ACTIVE'`
    )
    .all() as TradeRow[];
}

/** Map exchange name to exit price key. */
function exitPriceForExchange(
  exitPrices: { binance?: number; bybit?: number },
  exchange: string
): number | null {
  const ex = (exchange ?? '').toLowerCase();
  if (ex === 'binance' && exitPrices.binance != null && exitPrices.binance > 0)
    return exitPrices.binance;
  if (ex === 'bybit' && exitPrices.bybit != null && exitPrices.bybit > 0)
    return exitPrices.bybit;
  return null;
}

function entryPriceForExchange(trade: TradeRow, exchange: string): number | null {
  const ex = (exchange ?? '').toLowerCase();
  if (ex === 'binance') return trade.entry_price_binance ?? null;
  if (ex === 'bybit') return trade.entry_price_bybit ?? null;
  return null;
}

/** Build archive data and mark trade closed. */
function archiveAndMarkClosed(
  trade: TradeRow,
  exitReason: string,
  executedBy: string,
  exitPrices: { binance?: number; bybit?: number }
): void {
  const qty = trade.quantity ?? 0;
  const longEx = (trade.long_exchange ?? '').toString();
  const shortEx = (trade.short_exchange ?? '').toString();

  const entryLong = entryPriceForExchange(trade, longEx);
  const entryShort = entryPriceForExchange(trade, shortEx);
  const exitLong = exitPriceForExchange(exitPrices, longEx);
  const exitShort = exitPriceForExchange(exitPrices, shortEx);

  let pnlLong: number | null = null;
  let pnlShort: number | null = null;
  if (entryLong != null && exitLong != null && qty > 0) {
    pnlLong = (exitLong - entryLong) * qty;
  }
  if (entryShort != null && exitShort != null && qty > 0) {
    pnlShort = (entryShort - exitShort) * qty;
  }

  const funding = trade.funding_received ?? 0;
  const netPnl = (pnlLong ?? 0) + (pnlShort ?? 0) + funding;
  const entryTime = trade.created_at ?? new Date().toISOString();
  const exitTime = new Date().toISOString();

  const data: ArchiveTradeData = {
    symbol: trade.symbol,
    leverage: trade.leverage ?? 1,
    quantity: qty,
    entryPriceLong: entryLong,
    entryPriceShort: entryShort,
    exitPriceLong: exitLong ?? null,
    exitPriceShort: exitShort ?? null,
    pnlLong,
    pnlShort,
    netPnl,
    fundingReceived: funding,
    exitReason,
    executedBy,
    entryTime,
    exitTime,
  };

  try {
    archiveTrade(data);
  } catch (err) {
    console.error('[ExitController] archiveTrade failed:', err);
  }
  const base = normalizeSymbol(trade.symbol);
  addNotification('INFO', `Closed trade ${base}. P&L: $${netPnl.toFixed(2)}`);
  markTradeClosed(trade, exitReason);
}

async function checkBrokenHedge(
  trade: TradeRow,
  manager: ExchangeManager
): Promise<boolean> {
  const raw = await manager.getRawPositions();
  if (!raw.dataComplete) {
    console.warn('[ExitController] Data incomplete - skipping broken hedge check');
    return false;
  }
  const { binance, bybit } = raw;
  const target = normalizeSymbol(trade.symbol);

  const hasPosition = (positions: { contracts?: number; positionAmt?: number; symbol?: string }[]): boolean => {
    return positions.some((pos) => {
      const size = Math.abs(pos.contracts ?? pos.positionAmt ?? 0);
      if (size <= 0) return false;
      const sym = normalizeSymbol(pos.symbol ?? '');
      return sym === target;
    });
  };

  const binanceHas = hasPosition(binance.data);
  const bybitHas = hasPosition(bybit.data);

  if ((binanceHas && bybitHas) || (!binanceHas && !bybitHas)) {
    return false;
  }

  console.error(`🚨 BROKEN HEDGE DETECTED for ${trade.symbol}`);
  const remainingExchange = binanceHas ? 'binance' : 'bybit';

  try {
    const { price } = await manager.closeInteractivePosition(trade.symbol, remainingExchange);
    const exitPrices = remainingExchange === 'binance' ? { binance: price } : { bybit: price };
    archiveAndMarkClosed(trade, 'Broken Hedge', 'Bot', exitPrices);
  } catch (err) {
    console.error('[ExitController] Failed to close broken leg:', err);
    archiveAndMarkClosed(trade, 'Broken Hedge / Error', 'Bot', {});
  }
  return true;
}

async function executeExit(
  trade: TradeRow,
  reason: string,
  manager: ExchangeManager
): Promise<void> {
  try {
    const result = await manager.closeAllPositions(trade.symbol);
    if (!result.success) {
      console.error('[ExitController] Exit incomplete (BROKEN HEDGE logged by manager):', result.results);
      return; // Do not mark closed so Safety Watchman / checkBrokenHedge can pick up
    }
    archiveAndMarkClosed(trade, reason, 'Bot', result.exitPrices);
  } catch (err) {
    console.error('[ExitController] closeAllPositions failed:', err);
    // Do not mark closed so retry / Safety Watchman can act
  }
}


function markTradeClosed(trade: TradeRow, reason: string) {
  try {
    db.db
      .prepare("UPDATE active_trades SET status = 'CLOSED' WHERE id = ?")
      .run(trade.id);

    db.db
      .prepare(
        'INSERT INTO trade_logs (symbol, action, reason, pnl) VALUES (?, ?, ?, ?)'
      )
      .run(trade.symbol, 'EXIT', reason, null);
    invalidatePositionsCache();
  } catch (err) {
    console.error('[ExitController] Failed to mark trade closed:', err);
  }
}

/** Fetch active trade by symbol (full or base). */
function fetchActiveTradeBySymbol(symbol: string): TradeRow | null {
  const base = normalizeSymbol(symbol);
  const rows = db.db
    .prepare(
      `SELECT id, symbol, long_exchange, short_exchange, quantity,
              allocated_capital, entry_price_binance, entry_price_bybit,
              liquidation_binance, liquidation_bybit, next_funding_time,
              funding_received, leverage, created_at, interval
         FROM active_trades
        WHERE status = 'ACTIVE'`
    )
    .all() as TradeRow[];
  return rows.find((r) => normalizeSymbol(r.symbol) === base) ?? null;
}

/**
 * Archive and mark closed a trade by symbol (e.g. for Emergency Exit from risk monitor).
 * Fetches the active trade from DB and archives it. If no DB row exists but fallbackGroup
 * is provided (from exchange positions), archives from position data so history is never lost.
 */
export function archiveAndCloseTradeBySymbol(
  symbol: string,
  exitReason: string,
  executedBy: string,
  exitPrices: { binance?: number; bybit?: number },
  fallbackGroup?: GroupedPosition
): void {
  const trade = fetchActiveTradeBySymbol(symbol);
  if (trade) {
    archiveAndMarkClosed(trade, exitReason, executedBy, exitPrices);
    return;
  }
  // No DB row: archive from position group so emergency exits are never lost
  if (fallbackGroup) {
    archiveEmergencyExitFromPosition(fallbackGroup, exitReason, executedBy, exitPrices);
  }
}

/** Archives an emergency exit when no active_trades row exists (e.g. legacy / race). */
function archiveEmergencyExitFromPosition(
  group: GroupedPosition,
  exitReason: string,
  executedBy: string,
  exitPrices: { binance?: number; bybit?: number }
): void {
  const leg = group.legs.find((l) => l.size !== 0);
  if (!leg) return;
  const qty = Math.abs(leg.size);
  const entryPrice = leg.entryPrice ?? 0;
  const ex = leg.exchange.toLowerCase();
  const exitPrice = ex === 'binance' ? exitPrices.binance : exitPrices.bybit;
  const fullSymbol = group.symbol.includes('/') ? group.symbol : `${group.symbol}/USDT:USDT`;
  const isLong = (leg.side ?? '').toUpperCase() === 'LONG' || (leg.side ?? '').toLowerCase() === 'buy';
  const pnl = exitPrice != null && exitPrice > 0
    ? (isLong ? (exitPrice - entryPrice) * qty : (entryPrice - exitPrice) * qty)
    : 0;
  const data: ArchiveTradeData = {
    symbol: fullSymbol,
    leverage: 1,
    quantity: qty,
    entryPriceLong: isLong ? entryPrice : null,
    entryPriceShort: isLong ? null : entryPrice,
    exitPriceLong: isLong && exitPrice != null ? exitPrice : null,
    exitPriceShort: !isLong && exitPrice != null ? exitPrice : null,
    pnlLong: isLong ? pnl : null,
    pnlShort: !isLong ? pnl : null,
    netPnl: pnl,
    fundingReceived: 0,
    exitReason: exitReason || 'Emergency: Broken Hedge',
    executedBy,
    entryTime: new Date().toISOString(),
    exitTime: new Date().toISOString(),
  };
  try {
    archiveTrade(data);
    const base = normalizeSymbol(group.symbol);
    addNotification('INFO', `Closed trade ${base} (emergency). P&L: $${pnl.toFixed(2)}`);
    console.log(`[ExitController] Archived emergency exit for ${group.symbol} (no DB row)`);
  } catch (err) {
    console.error('[ExitController] archiveEmergencyExitFromPosition failed:', err);
  }
}

/**
 * Close a trade via API (User). Archives to trade_history and marks closed.
 */
export async function closeTradeAsUser(symbol: string): Promise<{
  success: boolean;
  results?: unknown[];
  error?: string;
}> {
  const trade = fetchActiveTradeBySymbol(symbol);
  if (!trade) {
    return { success: false, error: 'Active trade not found' };
  }
  const manager = new ExchangeManager();
  const result = await manager.closeAllPositions(trade.symbol);
  if (!result.success) {
    return { success: false, results: result.results, error: 'Close incomplete' };
  }
  archiveAndMarkClosed(trade, 'Manual', 'User', result.exitPrices);
  return { success: true, results: result.results };
}

/**
 * Zombie Cleaner: DB says Active, Exchange says Empty.
 * Mark trade as CLOSED if it has no valid hedged position on exchange.
 */
function runZombieCleaner(
  trades: TradeRow[],
  livePositions: GroupedPosition[]
): void {
  const byBase = new Map<string, GroupedPosition>();
  for (const g of livePositions) byBase.set(normalizeSymbol(g.symbol), g);

  for (const trade of trades) {
    const base = normalizeSymbol(trade.symbol);
    const group = byBase.get(base);
    const hasValidHedge = group && group.legs.length >= 2;
    if (hasValidHedge) continue;
    if (group && group.legs.length === 1) continue; // broken hedge: let Risk Monitor / checkBrokenHedge handle
    console.warn(`👻 Zombie Trade Detected: ${trade.symbol}. Marking as Closed.`);
    markTradeClosed(trade, 'Zombie: Not found on exchange');
  }
}

/**
 * Ghost Import: Exchange says Active, DB says Empty.
 * Insert valid hedged positions from exchange into active_trades.
 */
function runGhostImport(
  livePositions: GroupedPosition[],
  activeSymbols: Set<string>
): void {
  for (const group of livePositions) {
    if (group.legs.length !== 2) continue;
    const base = normalizeSymbol(group.symbol);
    if (activeSymbols.has(base)) continue;

    const longLeg = group.legs.find((l) => (l.side ?? '').toUpperCase() === 'LONG');
    const shortLeg = group.legs.find((l) => (l.side ?? '').toUpperCase() === 'SHORT');
    if (!longLeg || !shortLeg) continue;

    const fullSymbol = group.symbol.includes('/') ? group.symbol : `${group.symbol}/USDT:USDT`;
    const quantity = longLeg.size ?? shortLeg.size ?? 0;
    if (quantity <= 0) continue;

    const longEx = longLeg.exchange.toLowerCase();
    const shortEx = shortLeg.exchange.toLowerCase();
    const entryPriceBinance = longEx === 'binance' ? longLeg.entryPrice : shortLeg.entryPrice;
    const entryPriceBybit = longEx === 'bybit' ? longLeg.entryPrice : shortLeg.entryPrice;

    try {
      insertActiveTrade({
        symbol: fullSymbol,
        longExchange: longEx,
        shortExchange: shortEx,
        quantity,
        leverage: 1,
        entryPriceBinance: entryPriceBinance ?? 0,
        entryPriceBybit: entryPriceBybit ?? 0,
      });
      console.log(`📥 Restored missing trade from Exchange: ${group.symbol}`);
      invalidatePositionsCache();
    } catch (err) {
      console.error('[ExitController] Ghost import failed for', group.symbol, err);
    }
  }
}

function getFundingRatesForSymbol(
  binanceRates: Record<string, { fundingRate?: number }>,
  bybitRates: Record<string, { fundingRate?: number }>,
  symbol: string
): { binRate: number; bybRate: number } {
  const base = normalizeSymbol(symbol);
  const full = symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`;
  const bin = binanceRates[full] ?? binanceRates[base] ?? binanceRates[`${base}/USDT:USDT`];
  const byb = bybitRates[full] ?? bybitRates[base] ?? bybitRates[`${base}/USDT:USDT`];
  return {
    binRate: typeof bin?.fundingRate === 'number' ? bin.fundingRate : 0,
    bybRate: typeof byb?.fundingRate === 'number' ? byb.fundingRate : 0,
  };
}

export async function checkAllExits(): Promise<void> {
  const settings = fetchSettings();
  let trades = fetchActiveTrades();

  const manager = new ExchangeManager();
  const tracker = new PositionTracker();
  const { positions: livePositions, dataComplete } = await tracker.getGroupedPositions({ withDataComplete: true });

  if (dataComplete) {
    runZombieCleaner(trades, livePositions);
    trades = fetchActiveTrades();
    const activeSymbols = new Set<string>(trades.map((t) => normalizeSymbol(t.symbol)));
    runGhostImport(livePositions, activeSymbols);
    trades = fetchActiveTrades();
  }

  let fundingRates: { binance: Record<string, { fundingRate?: number }>; bybit: Record<string, { fundingRate?: number }> } | null = null;
  if (trades.length > 0) {
    try {
      fundingRates = await manager.getFundingRates();
    } catch (err) {
      console.warn('[ExitController] getFundingRates failed, skipping strategy-flip checks:', err);
    }
  }

  for (const trade of trades) {
    try {
      const brokenHandled = await checkBrokenHedge(trade, manager);
      if (brokenHandled) continue;

      if (fundingRates) {
        const { binRate, bybRate } = getFundingRatesForSymbol(
          fundingRates.binance,
          fundingRates.bybit,
          trade.symbol
        );
        if (binRate !== 0 || bybRate !== 0) {
          const flip = checkStrategyFlip(trade, binRate, bybRate);
          if (flip.shouldExit) {
            await executeExit(trade, flip.reason, manager);
            continue;
          }
        }
      }

      const intervalResult = await checkIntervalChange(trade, manager);
      if (intervalResult.shouldExit) {
        await executeExit(trade, intervalResult.reason, manager);
        continue;
      }

      if (!settings.auto_exit_enabled) {
        console.log(`Auto Exit OFF: Monitoring ${trade.symbol} only.`);
        continue;
      }

      if (settings.liquidation_buffer > 0) {
        const liq = checkLiquidationBuffer(trade, settings);
        if (liq.shouldExit) {
          await executeExit(trade, liq.reason, manager);
          continue;
        }
      }

      if (settings.negative_funding_exit) {
        const funding = checkNegativeFunding(trade, settings);
        if (funding.shouldExit) {
          await executeExit(trade, funding.reason, manager);
          continue;
        }
      }

      if (settings.mtm_stoploss_enabled) {
        const mtm = checkMTMStoploss(trade, settings);
        if (mtm.shouldExit) {
          await executeExit(trade, mtm.reason, manager);
        }
      }
    } catch (err) {
      console.error('[ExitController] Error while evaluating exits:', err);
    }
  }
}
