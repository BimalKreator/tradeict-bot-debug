import { db } from '@/lib/db/sqlite';
import { getBestCandidates } from '../logic/candidate-selector';
import { canEnterTrade } from '../entry/validator';
import { executeEntry } from './auto-entry';

const SLOTS_TOTAL = 3;
const MIN_TIME_TO_FUNDING_SEC = 60;

/**
 * Unlock Auto Trade: Enter ANYTIME if time to funding > 60s (no restrictive window).
 */
export async function handleSlotRefill(): Promise<void> {
  try {
    const settings = db.db
      .prepare('SELECT auto_entry_enabled, max_capital_percent, min_spread_percent FROM bot_settings WHERE id = 1')
      .get() as
      | { auto_entry_enabled?: number; max_capital_percent?: number; min_spread_percent?: number }
      | undefined;

    if (!settings?.auto_entry_enabled) return;

    const activeRows = db.db
      .prepare("SELECT symbol FROM active_trades WHERE status = 'ACTIVE'")
      .all() as { symbol: string }[];
    const activeSymbols = new Set<string>();
    for (const row of activeRows) {
      const sym = row.symbol;
      activeSymbols.add(sym);
      activeSymbols.add(sym.split('/')[0]);
    }

    const activeCount = activeRows.length;
    const slotsNeeded = Math.max(0, SLOTS_TOTAL - activeCount);

    if (slotsNeeded <= 0) return;

    const minSpreadDecimal = (settings?.min_spread_percent ?? 0) / 100;

    const candidates = await getBestCandidates(
      {
        activeSymbols,
        minSpreadDecimal,
        minTimeToFundingSec: MIN_TIME_TO_FUNDING_SEC,
      },
      slotsNeeded
    );

    console.log(`[Refill] Found ${candidates.length} candidates for ${slotsNeeded} slots.`);

    for (const candidate of candidates) {
      const validation = canEnterTrade(candidate.symbol);
      if (!validation.allowed) {
        console.log(`[Refill] Skipping ${candidate.symbol}: ${validation.reason ?? 'not allowed'}`);
        continue;
      }

      const secondsLeft = (candidate.nextFundingAt.getTime() - Date.now()) / 1000;
      if (secondsLeft < MIN_TIME_TO_FUNDING_SEC) {
        console.log(`[Refill] Skipping ${candidate.symbol}: too late (${Math.round(secondsLeft)}s left)`);
        continue;
      }

      console.log(`[Refill] Executing Auto-Entry on ${candidate.symbol}`);
      await executeEntry(candidate.symbol, candidate.opportunity);
    }
  } catch (error) {
    console.error('[Refill] Error:', error);
  }
}
