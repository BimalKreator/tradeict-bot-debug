import { ExchangeManager } from '../exchanges/manager';
import { db } from '../db/sqlite';

/**
 * Sync daily deposits/withdrawals from exchanges into daily_balance_snapshots.
 * Requires API keys with deposit/withdrawal history permission.
 */
export async function syncDailyTransfers(): Promise<void> {
  console.log('[TransferSync] 🔄 Syncing deposits/withdrawals...');
  const manager = new ExchangeManager();

  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).getTime();

  try {
    const { deposits: totalDeposits, withdrawals: totalWithdrawals } =
      await manager.fetchDailyTransfers(startOfDay);

    console.log(
      `[TransferSync] 💰 Total Deposits: $${totalDeposits.toFixed(2)}, Withdrawals: $${totalWithdrawals.toFixed(2)}`
    );

    const todayStr = db.getISTDate();

    const result = db.db
      .prepare(
        `UPDATE daily_balance_snapshots SET total_deposits = ?, total_withdrawals = ? WHERE date = ?`
      )
      .run(totalDeposits, totalWithdrawals, todayStr);

    if (result.changes > 0) {
      console.log('[TransferSync] ✅ Database updated.');
    } else {
      const lastRow = db.db
        .prepare(
          'SELECT closing_balance, opening_balance FROM daily_balance_snapshots ORDER BY date DESC LIMIT 1'
        )
        .get() as { closing_balance: number | null; opening_balance: number } | undefined;
      const opening = lastRow?.closing_balance ?? lastRow?.opening_balance ?? 95;
      db.db
        .prepare(
          `INSERT INTO daily_balance_snapshots (date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage) VALUES (?, ?, NULL, ?, ?, 0)`
        )
        .run(todayStr, opening, totalDeposits, totalWithdrawals);
      console.log('[TransferSync] ✅ Inserted new snapshot row.');
    }
  } catch (error) {
    console.error('[TransferSync] Critical Error:', error);
  }
}
