import { db } from './sqlite';

/**
 * Records a funding payment and updates the trade's total funding received.
 */
export function recordFunding(
  tradeId: string,
  exchange: string,
  amount: number
): void {
  const id = Number(tradeId);
  if (!Number.isFinite(id)) return;

  db.db
    .prepare(
      'INSERT INTO funding_history (trade_id, exchange, amount) VALUES (?, ?, ?)'
    )
    .run(id, exchange, amount);

  db.db
    .prepare(
      'UPDATE active_trades SET funding_received = funding_received + ? WHERE id = ?'
    )
    .run(amount, id);
}

/**
 * Records funding at an 8h interval: updates long_funding_acc, short_funding_acc, and funding_received.
 * longExchange/shortExchange are used for funding_history (e.g. 'binance', 'bybit').
 */
export function recordFundingLegs(
  tradeId: number,
  longExchange: string,
  shortExchange: string,
  longAmount: number,
  shortAmount: number
): void {
  if (!Number.isFinite(tradeId)) return;
  const total = longAmount + shortAmount;

  db.db
    .prepare(
      `INSERT INTO funding_history (trade_id, exchange, amount) VALUES (?, ?, ?), (?, ?, ?)`
    )
    .run(tradeId, longExchange, longAmount, tradeId, shortExchange, shortAmount);

  db.db
    .prepare(
      `UPDATE active_trades SET
        long_funding_acc = long_funding_acc + ?,
        short_funding_acc = short_funding_acc + ?,
        funding_received = funding_received + ?
       WHERE id = ?`
    )
    .run(longAmount, shortAmount, total, tradeId);
}
