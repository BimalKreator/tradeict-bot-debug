import { db } from '@/lib/db/sqlite';
import { getBestCandidates } from '../logic/candidate-selector';
import { canEnterTrade } from '../entry/validator';
import { executeEntry } from './auto-entry';

const T_MINUS_2_UPPER_SEC = 180;
const T_MINUS_2_LOWER_SEC = 90;
const TOO_LATE_SEC = 30;
const SLOTS_TOTAL = 3;

/**
 * Multi-Slot Sniper: Fill all available slots. Execute exactly 2 minutes before funding.
 * Runs every 10s to catch the 110–130s window.
 * Selects top N candidates per screener priority (1h > 2h > 4h > 8h, then spread).
 */
export async function handleSlotRefill(): Promise<void> {
  const probe = canEnterTrade('__probe__');
  if (!probe.allowed && probe.reason !== 'Duplicate Token') {
    return;
  }

  const settings = db.db
    .prepare('SELECT min_spread_percent FROM bot_settings WHERE id = 1')
    .get() as { min_spread_percent: number } | undefined;
  const minSpreadDecimal = (settings?.min_spread_percent ?? 0.075) / 100;

  const activeRows = db.db
    .prepare('SELECT symbol FROM active_trades WHERE status = ?')
    .all('ACTIVE') as { symbol: string }[];
  const activeSymbols = new Set<string>();
  for (const row of activeRows) {
    const sym = row.symbol;
    activeSymbols.add(sym);
    activeSymbols.add(sym.split('/')[0]);
  }
  const activeTradesCount = activeRows.length;
  const slotsNeeded = Math.max(0, SLOTS_TOTAL - activeTradesCount);

  if (slotsNeeded <= 0) {
    return;
  }

  let candidates;
  try {
    candidates = await getBestCandidates(
      { activeSymbols, minSpreadDecimal, minTimeToFundingSec: TOO_LATE_SEC },
      slotsNeeded
    );
  } catch (err) {
    console.error('[AutoEntry] getBestCandidates failed:', err);
    return;
  }

  const uniqueCandidates = [...new Set(candidates.map((c) => c.symbol))]
    .map((s) => candidates.find((c) => c.symbol === s))
    .filter((c): c is NonNullable<typeof c> => c != null);

  const anyInWindow = uniqueCandidates.some((c) => {
    const sec = (c.nextFundingAt.getTime() - Date.now()) / 1000;
    return sec >= T_MINUS_2_LOWER_SEC && sec <= T_MINUS_2_UPPER_SEC;
  });

  if (anyInWindow) {
    console.log(`🎯 Batch Refill: ${slotsNeeded} slot(s) available — executing Top ${uniqueCandidates.length} in order.`);
    for (const candidate of uniqueCandidates) {
      try {
        const symbol = candidate.symbol;
        const validation = canEnterTrade(symbol);
        if (!validation.allowed) {
          console.log(`[Refill] Skipping ${symbol}: ${validation.reason ?? 'not allowed'}`);
          continue;
        }
        const secondsLeft = (candidate.nextFundingAt.getTime() - Date.now()) / 1000;
        if (secondsLeft < TOO_LATE_SEC) {
          console.log(`[Refill] Skipping ${symbol}: missed window (${Math.round(secondsLeft)}s).`);
          continue;
        }
        console.log(`🎯 Executing ${symbol} (${uniqueCandidates.indexOf(candidate) + 1}/${uniqueCandidates.length}).`);
        await executeEntry(symbol, candidate.opportunity);
      } catch (error) {
        console.error(`[Refill] Failed to execute entry for ${candidate.symbol}, continuing to next candidate...`, error);
      }
    }
  } else {
    for (const candidate of uniqueCandidates) {
      const secondsLeft = (candidate.nextFundingAt.getTime() - Date.now()) / 1000;
      if (secondsLeft < TOO_LATE_SEC) {
        console.log(`⚠️ Missed window for ${candidate.symbol}. Skipping.`);
      } else {
        console.log(
          `Targeting ${candidate.symbol}. Time to funding: ${Math.round(secondsLeft)}s. Waiting for T-120s mark.`
        );
      }
    }
  }
}
