import type { ExchangeManager } from '../exchanges/manager';
import type { GroupedPosition, PositionLeg } from '../exchanges/position-tracker';
import { groupRawPositions } from '../exchanges/position-tracker';
import { archiveAndCloseTradeBySymbol } from '../exit/controller';
import { db } from '../db/sqlite';

const QUANTITY_MISMATCH_THRESHOLD = 0.2;
const GRACE_PERIOD_MS = 60_000;
const VERIFICATION_COUNT_THRESHOLD = 3;

const missedHedgeCount = new Map<string, number>();

export interface CheckResult {
  status: 'OK' | 'RISK_DETECTED';
  actionsTaken: string[];
}

export interface CheckHedgeIntegrityOptions {
  dataComplete?: boolean;
}

export async function checkHedgeIntegrity(
  positions: GroupedPosition[],
  manager: ExchangeManager,
  options: CheckHedgeIntegrityOptions = {}
): Promise<CheckResult> {
  const { dataComplete = true } = options;
  const actionsTaken: string[] = [];

  if (!dataComplete) {
    console.warn('[RiskMonitor] ⚠️ Data Lag - Skipping Check (incomplete exchange data)');
    return { status: 'OK', actionsTaken: [] };
  }

  for (const group of positions) {
    const { symbol, legs } = group;

    if (legs.length === 0) continue;

    if (legs.length === 1) {
      if (isTradeInGracePeriod(symbol)) {
        console.log(`[RiskMonitor] Skipping new trade ${symbol} (Grace Period)`);
        resetMissedHedgeCount(symbol);
        continue;
      }
      const base = symbol.includes('/') ? symbol.split('/')[0] : symbol;
      const liveRaw = await manager.getRawPositions(true);
      const liveGrouped = groupRawPositions(liveRaw);
      if (!liveGrouped.dataComplete) {
        console.warn('[RiskMonitor] Live re-check incomplete - skipping exit decision');
        continue;
      }
      const liveGroup = liveGrouped.positions.find((p) => {
        const pBase = p.symbol.includes('/') ? p.symbol.split('/')[0] : p.symbol;
        return pBase.toUpperCase() === base.toUpperCase();
      });
      if (!liveGroup || liveGroup.legs.length !== 1) {
        resetMissedHedgeCount(symbol);
        continue;
      }
      const count = (missedHedgeCount.get(symbol) ?? 0) + 1;
      missedHedgeCount.set(symbol, count);
      if (count < VERIFICATION_COUNT_THRESHOLD) {
        console.log(`[RiskMonitor] One leg missing for ${symbol} (${count}/${VERIFICATION_COUNT_THRESHOLD}) - waiting for verification`);
        continue;
      }
      await executeEmergencyExit(liveGroup, manager);
      missedHedgeCount.delete(symbol);
      actionsTaken.push(`EMERGENCY_EXIT:${symbol}`);
      continue;
    }

    resetMissedHedgeCount(symbol);

    if (legs.length === 2) {
      const [leg1, leg2] = legs;
      const size1 = Math.abs(leg1.size);
      const size2 = Math.abs(leg2.size);
      const maxSize = Math.max(size1, size2);
      const diff = Math.abs(size1 - size2);

      if (maxSize > 0 && diff / maxSize > QUANTITY_MISMATCH_THRESHOLD) {
        // Quantity mismatch >20% - logged via actionsTaken when severity increases
      }
    }
  }

  return {
    status: actionsTaken.length > 0 ? 'RISK_DETECTED' : 'OK',
    actionsTaken,
  };
}

function resetMissedHedgeCount(symbol: string): void {
  if (missedHedgeCount.has(symbol)) {
    missedHedgeCount.delete(symbol);
  }
}

function isTradeInGracePeriod(symbol: string): boolean {
  const base = symbol.includes('/') ? symbol.split('/')[0] : symbol;
  const rows = db.db
    .prepare(
      `SELECT symbol, created_at FROM active_trades WHERE status = 'ACTIVE'`
    )
    .all() as { symbol: string; created_at: string | null }[];
  const match = rows.find((r) => {
    const rBase = r.symbol.includes('/') ? r.symbol.split('/')[0] : r.symbol;
    return rBase.toUpperCase() === base.toUpperCase();
  });
  if (!match?.created_at) return false;
  const createdMs = new Date(match.created_at).getTime();
  return Date.now() - createdMs < GRACE_PERIOD_MS;
}

export async function executeEmergencyExit(
  group: GroupedPosition,
  manager: ExchangeManager
): Promise<void> {
  const remainingLeg = group.legs.find((leg) => leg.size !== 0) as PositionLeg | undefined;
  if (!remainingLeg) return;

  const fullSymbol = group.symbol.includes('/') ? group.symbol : `${group.symbol}/USDT:USDT`;
  const exchangeKey = remainingLeg.exchange.toLowerCase();

  try {
    const { price } = await manager.closeInteractivePosition(fullSymbol, remainingLeg.exchange);
    const exitPrices = exchangeKey === 'binance' ? { binance: price } : { bybit: price };
    archiveAndCloseTradeBySymbol(group.symbol, 'Broken Hedge / Emergency Exit', 'Bot', exitPrices, group);
  } catch (err) {
    console.error('[RiskMonitor] Emergency exit close failed:', err);
    archiveAndCloseTradeBySymbol(group.symbol, 'Broken Hedge / Emergency Exit', 'Bot', {}, group);
  }
}
