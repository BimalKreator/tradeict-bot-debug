import * as ccxt from 'ccxt';
import { db } from '../db/sqlite';

/**
 * Sync daily deposits/withdrawals from exchanges into daily_balance_snapshots.
 * Requires API keys with deposit/withdrawal history permission.
 */
export async function syncDailyTransfers(): Promise<void> {
  console.log('[TransferSync] 🔄 Fetching deposits/withdrawals from exchanges...');

  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).getTime();

  let totalDeposits = 0;
  let totalWithdrawals = 0;

  try {
    const binance = new ccxt.binanceusdm({
      apiKey: process.env.BINANCE_API_KEY,
      secret: process.env.BINANCE_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'future' },
    });

    const bybit = new ccxt.bybit({
      apiKey: process.env.BYBIT_API_KEY,
      secret: process.env.BYBIT_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'linear' },
    });

    // Fetch from Binance (may require spot/funding permissions)
    try {
      const deps = await binance.fetchDeposits?.('USDT', startOfDay) ?? [];
      const wths = await binance.fetchWithdrawals?.('USDT', startOfDay) ?? [];
      for (const d of deps) totalDeposits += (d.amount as number) || 0;
      for (const w of wths) totalWithdrawals += (w.amount as number) || 0;
    } catch (e) {
      console.warn('[TransferSync] Binance fetch failed:', (e as Error).message);
    }

    // Fetch from Bybit
    try {
      const deps = await bybit.fetchDeposits?.('USDT', startOfDay) ?? [];
      const wths = await bybit.fetchWithdrawals?.('USDT', startOfDay) ?? [];
      for (const d of deps) totalDeposits += (d.amount as number) || 0;
      for (const w of wths) totalWithdrawals += (w.amount as number) || 0;
    } catch (e) {
      console.warn('[TransferSync] Bybit fetch failed:', (e as Error).message);
    }

    console.log(
      `[TransferSync] 💰 Found: Deposits=$${totalDeposits.toFixed(2)}, Withdrawals=$${totalWithdrawals.toFixed(2)}`
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
      console.log('[TransferSync] ✅ Inserted new snapshot row with transfers.');
    }
  } catch (error) {
    console.error('[TransferSync] ❌ Failed to sync transfers:', error);
  }
}
