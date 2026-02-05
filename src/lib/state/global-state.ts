import { db } from '../db/sqlite';

export const GlobalState = {
  config: {
    autoEntry: true,
    autoExit: true,
    maxSlots: 3,
  },
  market: {
    binanceConnected: false,
    bybitConnected: false,
  },
  runtime: {
    activeSlots: 0,
    lastFundingCheck: 0,
  },
};

type BotSettingsRow = {
  auto_entry_enabled: number;
  auto_exit_enabled: number;
  max_capital_percent?: number;
  leverage?: number;
};

export function init(): void {
  const row = db.db.prepare('SELECT * FROM bot_settings WHERE id = 1').get() as BotSettingsRow | undefined;
  if (row) {
    GlobalState.config.autoEntry = row.auto_entry_enabled === 1;
    GlobalState.config.autoExit = row.auto_exit_enabled === 1;
    GlobalState.config.maxSlots = 3;
  }
  console.log('Global State Initialized from DB');
}

export function refreshSettings(): void {
  const row = db.db.prepare('SELECT * FROM bot_settings WHERE id = 1').get() as BotSettingsRow | undefined;
  if (row) {
    GlobalState.config.autoEntry = row.auto_entry_enabled === 1;
    GlobalState.config.autoExit = row.auto_exit_enabled === 1;
    GlobalState.config.maxSlots = 3;
  }
}
