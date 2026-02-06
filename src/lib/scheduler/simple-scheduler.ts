import { checkPendingEntries } from './auto-entry';
import { handleSlotRefill } from './refill';
import { checkAllExits } from '../exit/controller';
import { startBackupJob } from './backup';
import { maybeRunFundingAccumulation } from './funding-job';
import { refreshScreenerCache } from '../utils/screener';

export class LocalScheduler {
  private static instance: LocalScheduler | null = null;
  intervals: NodeJS.Timeout[] = [];

  static getInstance(): LocalScheduler {
    if (LocalScheduler.instance === null) {
      LocalScheduler.instance = new LocalScheduler();
    }
    return LocalScheduler.instance;
  }

  start(): void {
    this.stop();
    startBackupJob();
    refreshScreenerCache().catch((err) =>
      console.warn('[Scheduler] Initial screener refresh failed:', err)
    );
    this.intervals.push(
      setInterval(() => {
        this.monitorExits();
      }, 2000)
    );
    this.intervals.push(
      setInterval(() => {
        this.checkFunding();
      }, 10_000)
    );
    this.intervals.push(
      setInterval(() => {
        checkPendingEntries();
      }, 10_000)
    );
    this.intervals.push(
      setInterval(() => {
        this.scanOpportunities();
      }, 30_000)
    );
    this.intervals.push(
      setInterval(() => {
        handleSlotRefill().catch((err) =>
          console.error('[Scheduler] handleSlotRefill failed:', err)
        );
      }, 10_000)
    );
    this.intervals.push(
      setInterval(() => {
        checkAllExits().catch((err) =>
          console.error('[Scheduler] exit check failed:', err)
        );
      }, 2_000)
    );
    // Funding accumulation at 8h intervals
    const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
    this.intervals.push(
      setInterval(() => {
        maybeRunFundingAccumulation();
      }, EIGHT_HOURS_MS)
    );
    // Daily rollover at 00:00 IST is handled by daily-rollover.ts (cron 18:30 UTC)
    // Screener cache refresh every 60s (dashboard uses cache for instant load)
    this.intervals.push(
      setInterval(() => {
        refreshScreenerCache().catch((err) =>
          console.warn('[Scheduler] refreshScreenerCache failed:', err)
        );
      }, 60_000)
    );
  }

  stop(): void {
    for (const id of this.intervals) {
      clearInterval(id);
    }
    this.intervals = [];
  }

  monitorExits(): void {
    console.log('🔍 Scanning active slots...');
  }

  checkFunding(): void {
    console.log('💰 Checking funding rates...');
  }

  scanOpportunities(): void {
    console.log('🚀 Looking for new trades...');
  }
}
