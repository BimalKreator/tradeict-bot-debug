import { db } from '@/lib/db/sqlite';
import { ExchangeManager } from '../exchanges/manager';

type AllocationResult = { quantity: number; capitalUsed: number };
type SettingsRow = { max_capital_percent: number };

export async function calculateAllocation(
  currentPrice: number
): Promise<AllocationResult> {
  if (currentPrice <= 0) return { quantity: 0, capitalUsed: 0 };

  const settings = db.db
    .prepare('SELECT max_capital_percent FROM bot_settings WHERE id = 1')
    .get() as SettingsRow | undefined;

  const maxPercent = settings?.max_capital_percent ?? 0;

  const manager = new ExchangeManager();
  const balances = await manager.getAggregatedBalances();
  const minBalance = Math.min(balances.binance, balances.bybit);

  if (!Number.isFinite(minBalance) || minBalance <= 0 || maxPercent <= 0) {
    return { quantity: 0, capitalUsed: 0 };
  }

  const allocation = minBalance * (maxPercent / 100);
  const quantity = Math.floor(allocation / currentPrice);

  return { quantity, capitalUsed: allocation };
}
