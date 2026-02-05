import type { Position } from 'ccxt';
import { ExchangeManager } from './manager';
import type { RawPositionsResult } from './manager';

/** Normalize symbol to base (e.g. BTC/USDT:USDT, BTCUSDT, BTC/USDT -> BTC). */
function normalizeSymbol(symbol: string): string {
  if (!symbol || typeof symbol !== 'string') return '';
  const s = symbol.trim();
  if (s.includes('/')) return s.split('/')[0].trim();
  return s.replace(/USDT:?USDT?$/i, '').replace(/USDT$/i, '').trim() || s;
}

export interface PositionLeg {
  exchange: 'Binance' | 'Bybit';
  side: string;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  size: number;
  liquidationPrice: number;
}

export interface GroupedPosition {
  symbol: string;
  netPnl: number;
  legs: PositionLeg[];
}

export interface GroupedPositionsResult {
  positions: GroupedPosition[];
  /** True only when both exchanges returned successfully. */
  dataComplete: boolean;
}

function toLeg(pos: Position, exchange: 'Binance' | 'Bybit'): PositionLeg | null {
      const rawAmt = (pos as unknown as { positionAmt?: number }).positionAmt;
      const contractsNum = pos.contracts ?? 0;
      const positionAmtNum = typeof rawAmt === 'number' ? rawAmt : 0;
      const absSize = Math.abs(contractsNum || positionAmtNum);
      if (absSize <= 0) return null;

      let side: string;
      if (typeof pos.side === 'string' && pos.side) {
        side = pos.side;
      } else if (typeof rawAmt === 'number' && rawAmt !== 0) {
        side = rawAmt > 0 ? 'long' : 'short';
      } else {
        side = 'long';
      }
      const sideNorm = side.toLowerCase();
      const size = sideNorm === 'short' || sideNorm === 'sell' ? -absSize : absSize;

  return {
    exchange,
    side: sideNorm === 'short' || sideNorm === 'sell' ? 'SHORT' : 'LONG',
    entryPrice: pos.entryPrice ?? 0,
    markPrice: pos.markPrice ?? pos.lastPrice ?? 0,
    pnl: pos.unrealizedPnl ?? 0,
    size: absSize,
    liquidationPrice: pos.liquidationPrice ?? 0,
  };
}

function buildGroupedFromRaw(binance: Position[], bybit: Position[], dataComplete: boolean): GroupedPositionsResult {
  const groups = new Map<string, PositionLeg[]>();
  for (const pos of binance) {
    const leg = toLeg(pos, 'Binance');
    if (leg) {
      const key = normalizeSymbol(pos.symbol);
      const list = groups.get(key) ?? [];
      list.push(leg);
      groups.set(key, list);
    }
  }
  for (const pos of bybit) {
    const leg = toLeg(pos, 'Bybit');
    if (leg) {
      const key = normalizeSymbol(pos.symbol);
      const list = groups.get(key) ?? [];
      list.push(leg);
      groups.set(key, list);
    }
  }
  const positions = Array.from(groups.entries()).map(([symbol, legs]) => {
    const netPnl = legs.reduce((sum, l) => sum + l.pnl, 0);
    return { symbol, netPnl, legs };
  });
  return { positions, dataComplete };
}

/** Build grouped positions from raw result (e.g. for risk monitor live re-check). */
export function groupRawPositions(raw: RawPositionsResult): GroupedPositionsResult {
  return buildGroupedFromRaw(raw.binance.data, raw.bybit.data, raw.dataComplete);
}

export class PositionTracker {
  private manager: ExchangeManager;

  constructor() {
    this.manager = new ExchangeManager();
  }

  async getGroupedPositions(): Promise<GroupedPosition[]>;
  async getGroupedPositions(opts: { withDataComplete: true; forceRefresh?: boolean }): Promise<GroupedPositionsResult>;
  async getGroupedPositions(opts?: { withDataComplete?: true; forceRefresh?: boolean }): Promise<GroupedPosition[] | GroupedPositionsResult> {
    const forceRefresh = opts?.forceRefresh ?? false;
    const raw = await this.manager.getRawPositions(forceRefresh);
    const result = buildGroupedFromRaw(raw.binance.data, raw.bybit.data, raw.dataComplete);
    if (opts?.withDataComplete) {
      return result;
    }
    return result.positions;
  }
}
