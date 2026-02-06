import cron from 'node-cron';
import { db } from '@/lib/db/sqlite';
import { ExchangeManager } from '@/lib/exchanges/manager';

/**
 * Daily rollover at 00:00 IST (18:30 UTC):
 * 1. Fetch live balance from Binance + Bybit
 * 2. Close yesterday: set closing_balance
 * 3. Open today: set opening_balance = yesterday's closing
 */
export function startDailyRollover(): void {
  // 18:30 UTC = 00:00 IST
  cron.schedule('30 18 * * *', async () => {
    console.log('[DailyRollover] 🕛 Midnight IST! Taking Snapshot...');

    try {
      // 1. Fetch live balance
      const manager = new ExchangeManager();
      const balances = await manager.getAggregatedBalances();
      const totalBalance = balances.total;

      // 2. IST dates: at 18:30 UTC we're at 00:00 IST (start of new day)
      const todayStr = db.getISTDate(0);
      const yesterdayStr = db.getISTDate(1);

      console.log(
        `[DailyRollover] Closing ${yesterdayStr} -> Opening ${todayStr} | Balance: $${totalBalance.toFixed(2)}`
      );

      // 3. Close yesterday: set closing_balance and growth_percentage
      const yesterdayRow = db.db
        .prepare(
          'SELECT opening_balance, total_deposits, total_withdrawals FROM daily_balance_snapshots WHERE date = ?'
        )
        .get(yesterdayStr) as
        | { opening_balance: number; total_deposits: number; total_withdrawals: number }
        | undefined;

      if (yesterdayRow) {
        const { opening_balance, total_deposits, total_withdrawals } =
          yesterdayRow;
        const growthAmt =
          totalBalance - opening_balance - total_deposits + total_withdrawals;
        const growthPct =
          opening_balance > 0 ? (growthAmt * 100) / opening_balance : 0;

        db.db
          .prepare(
            'UPDATE daily_balance_snapshots SET closing_balance = ?, growth_percentage = ? WHERE date = ?'
          )
          .run(totalBalance, growthPct, yesterdayStr);
      } else {
        db.db
          .prepare(
            'INSERT OR REPLACE INTO daily_balance_snapshots (date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage) VALUES (?, 0, ?, 0, 0, 0)'
          )
          .run(yesterdayStr, totalBalance);
      }

      // 4. Update daily_ledger
      db.db
        .prepare(
          'INSERT OR REPLACE INTO daily_ledger (date, total_balance, created_at) VALUES (?, ?, ?)'
        )
        .run(todayStr, totalBalance, new Date().toISOString());

      // 5. Open today: ensure row exists with opening = yesterday's closing
      const existing = db.db
        .prepare('SELECT 1 FROM daily_balance_snapshots WHERE date = ?')
        .get(todayStr);

      if (!existing) {
        db.db
          .prepare(
            'INSERT INTO daily_balance_snapshots (date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage) VALUES (?, ?, NULL, 0, 0, 0)'
          )
          .run(todayStr, totalBalance);
      } else {
        db.db
          .prepare(
            'UPDATE daily_balance_snapshots SET opening_balance = ? WHERE date = ?'
          )
          .run(totalBalance, todayStr);
      }

      console.log('[DailyRollover] ✅ Rollover Complete.');
    } catch (error) {
      console.error('[DailyRollover] ❌ Error:', error);
    }
  });

  console.log('[DailyRollover] 📅 Scheduler started (00:00 IST / 18:30 UTC).');
}
