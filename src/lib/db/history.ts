import { db } from './sqlite';

export interface ArchiveTradeData {
  symbol: string;
  leverage: number;
  quantity: number;
  entryPriceLong: number | null;
  entryPriceShort: number | null;
  exitPriceLong: number | null;
  exitPriceShort: number | null;
  pnlLong: number | null;
  pnlShort: number | null;
  netPnl: number;
  fundingReceived: number;
  exitReason: string;
  executedBy: string;
  entryTime: string;
  exitTime: string;
}

/**
 * Archives a closed trade to trade_history.
 * Handles null/undefined values for emergency exits (Broken Hedge, etc).
 */
export function archiveTrade(data: ArchiveTradeData): void {
  const netPnl = data.netPnl ?? 0;
  const fundingReceived = data.fundingReceived ?? 0;
  const quantity = data.quantity ?? 0;
  const leverage = data.leverage ?? 1;

  db.db
    .prepare(
      `INSERT INTO trade_history (
        symbol, leverage, quantity,
        entry_price_long, entry_price_short,
        exit_price_long, exit_price_short,
        pnl_long, pnl_short, net_pnl,
        funding_received, exit_reason, executed_by,
        entry_time, exit_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.symbol,
      leverage,
      quantity,
      data.entryPriceLong ?? null,
      data.entryPriceShort ?? null,
      data.exitPriceLong ?? null,
      data.exitPriceShort ?? null,
      data.pnlLong ?? null,
      data.pnlShort ?? null,
      netPnl,
      fundingReceived,
      data.exitReason,
      data.executedBy,
      data.entryTime,
      data.exitTime
    );
}
