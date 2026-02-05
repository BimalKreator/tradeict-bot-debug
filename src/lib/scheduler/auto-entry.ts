import { db } from '../db/sqlite';
import { addNotification } from '../db/notifications';
import { canEnterTrade } from '../entry/validator';
import { executeDualTrade } from '../logic/trade-executor';
import { cooldownManager } from '../utils/cooldown';
import type { FundingSpreadOpportunity } from '../utils/screener';

function normalizeSymbol(symbol: string): string {
  if (!symbol) return '';
  if (symbol.includes('/')) return symbol.split('/')[0];
  return symbol.replace(/USDT:?USDT?$/i, '');
}

export async function executeEntry(
  symbol: string,
  opportunity: FundingSpreadOpportunity
): Promise<void> {
  const base = normalizeSymbol(symbol);

  if (!cooldownManager.isReady(symbol)) {
    console.log(`[AutoEntry] 🛑 Skipping ${symbol} (Cooldown)`);
    return;
  }

  const validation = canEnterTrade(symbol);
  if (!validation.allowed) {
    console.log(`[AutoEntry] Skipping ${symbol}: validation failed — ${validation.reason ?? 'not allowed'}`);
    return;
  }

  console.log(`[AutoEntry] 🚀 Executing ${symbol}...`);

  try {
    const settingsRow = db.db
      .prepare('SELECT max_capital_percent FROM bot_settings WHERE id = 1')
      .get() as { max_capital_percent?: number } | undefined;
    const maxCapitalPercent = settingsRow?.max_capital_percent ?? 30;

    const success = await executeDualTrade({
      symbol: symbol.includes('/') ? symbol : `${symbol}/USDT:USDT`,
      longExchange: opportunity.longExchange,
      shortExchange: opportunity.shortExchange,
      amountPercent: maxCapitalPercent,
      reason: 'Auto-Entry',
    });

    if (success) {
      addNotification('SUCCESS', `Opened trade for ${base}`);
    } else {
      console.warn(`[AutoEntry] ⚠️ Trade Failed for ${symbol}. Triggering 20m Cooldown.`);
      cooldownManager.add(symbol);
      addNotification('ERROR', `Trade entry failed for ${base}`);
    }
  } catch (err) {
    console.error(`[AutoEntry] Error on ${symbol}:`, err);
    cooldownManager.add(symbol);
    addNotification('ERROR', `Trade entry failed for ${base}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function checkPendingEntries(): void {
  // No-op: sniper mode executes immediately, no scheduled entries
}
