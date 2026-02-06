import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'trading_bot.db');

const SCHEMA = `
-- 1. Active Trades
CREATE TABLE IF NOT EXISTS active_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT UNIQUE NOT NULL,
    slot_number INTEGER CHECK(slot_number BETWEEN 1 AND 3),
    status TEXT DEFAULT 'ACTIVE',
    long_exchange TEXT,
    short_exchange TEXT,
    quantity REAL,
    leverage INTEGER DEFAULT 1,
    entry_price_binance REAL,
    entry_price_bybit REAL,
    liquidation_binance REAL,
    liquidation_bybit REAL,
    allocated_capital REAL,
    funding_received REAL DEFAULT 0,
    long_funding_acc REAL DEFAULT 0,
    short_funding_acc REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    next_funding_time DATETIME
);

-- 2. Funding History
CREATE TABLE IF NOT EXISTS funding_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id INTEGER,
    exchange TEXT,
    amount REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Bot Settings
CREATE TABLE IF NOT EXISTS bot_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    auto_entry_enabled INTEGER DEFAULT 0,
    auto_exit_enabled INTEGER DEFAULT 1,
    max_capital_percent REAL DEFAULT 30,
    min_spread_percent REAL DEFAULT 0,
    leverage INTEGER DEFAULT 2,
    liquidation_buffer REAL DEFAULT 30,
    negative_funding_exit INTEGER DEFAULT 1,
    mtm_stoploss_enabled INTEGER DEFAULT 1,
    mtm_stoploss_percent REAL DEFAULT 0.5,
    manual_trading_enabled INTEGER DEFAULT 1
);

-- 4. Daily Balance Snapshots (IST-based)
CREATE TABLE IF NOT EXISTS daily_balance_snapshots (
    date TEXT PRIMARY KEY,
    opening_balance REAL NOT NULL,
    closing_balance REAL,
    total_deposits REAL DEFAULT 0,
    total_withdrawals REAL DEFAULT 0,
    growth_percentage REAL DEFAULT 0
);

-- 5. Trade Logs
CREATE TABLE IF NOT EXISTS trade_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    action TEXT,
    reason TEXT,
    pnl REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Trade History (archived closed trades)
CREATE TABLE IF NOT EXISTS trade_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    leverage INTEGER,
    quantity REAL,
    entry_price_long REAL,
    entry_price_short REAL,
    exit_price_long REAL,
    exit_price_short REAL,
    pnl_long REAL,
    pnl_short REAL,
    net_pnl REAL,
    funding_received REAL DEFAULT 0,
    exit_reason TEXT,
    executed_by TEXT,
    entry_time TEXT,
    exit_time TEXT
);

-- 7. Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_read INTEGER DEFAULT 0
);

-- 8. Daily Ledger (00:00 IST snapshot for true opening balance)
CREATE TABLE IF NOT EXISTS daily_ledger (
    date TEXT PRIMARY KEY,
    total_balance REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed default settings
INSERT OR IGNORE INTO bot_settings (id) VALUES (1);
`;

class DatabaseClient {
  private _db: Database.Database | null = null;

  get db(): Database.Database {
    if (!this._db) {
      if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
      }
      this._db = new Database(DB_PATH);
      this._db.pragma('journal_mode = WAL');
    }
    return this._db;
  }

  init(): void {
    this.db.exec(SCHEMA);
    this.migrateFundingColumns();
    this.migrateBotSettingsColumns();
    this.migrateDailySnapshotsColumns();
    this.migrateDailyLedger();
    this.ensureTodaySnapshot();
  }

  private migrateDailyLedger(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS daily_ledger (
          date TEXT PRIMARY KEY,
          total_balance REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch {
      // ignore
    }
  }

  private migrateDailySnapshotsColumns(): void {
    try {
      const info = this.db.pragma('table_info(daily_balance_snapshots)') as { name: string }[];
      const names = info.map((c) => c.name);
      if (!names.includes('closing_balance')) {
        this.db.exec('ALTER TABLE daily_balance_snapshots ADD COLUMN closing_balance REAL');
      }
      if (!names.includes('growth_percentage')) {
        this.db.exec('ALTER TABLE daily_balance_snapshots ADD COLUMN growth_percentage REAL DEFAULT 0');
      }
    } catch {
      // ignore
    }
  }

  /**
   * Get date in IST (Asia/Kolkata) as YYYY-MM-DD. Pass daysAgo to get past dates.
   */
  getISTDate(daysAgo = 0): string {
    const d = new Date();
    if (daysAgo > 0) {
      d.setDate(d.getDate() - daysAgo);
    }
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }

  /**
   * Ensure today's snapshot row exists. On first ever entry, use opening_balance = 95.
   */
  ensureTodaySnapshot(): void {
    try {
      const today = this.getISTDate();
      const existing = this.db
        .prepare('SELECT 1 FROM daily_balance_snapshots WHERE date = ?')
        .get(today);
      if (existing) return;

      const countRow = this.db
        .prepare('SELECT COUNT(*) as c FROM daily_balance_snapshots')
        .get() as { c: number };
      const lastRow =
        countRow.c > 0
          ? (this.db
              .prepare(
                'SELECT closing_balance, opening_balance FROM daily_balance_snapshots ORDER BY date DESC LIMIT 1'
              )
              .get() as { closing_balance: number | null; opening_balance: number })
          : null;
      const opening =
        countRow.c === 0
          ? 95
          : (lastRow?.closing_balance ?? lastRow?.opening_balance ?? 95);

      this.db
        .prepare(
          'INSERT INTO daily_balance_snapshots (date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage) VALUES (?, ?, NULL, 0, 0, 0)'
        )
        .run(today, opening);
    } catch (e) {
      console.error('[DB] ensureTodaySnapshot failed:', e);
    }
  }

  private migrateFundingColumns(): void {
    try {
      const info = this.db.pragma('table_info(active_trades)') as { name: string }[];
      const names = info.map((c) => c.name);
      if (!names.includes('long_funding_acc')) {
        this.db.exec('ALTER TABLE active_trades ADD COLUMN long_funding_acc REAL DEFAULT 0');
      }
      if (!names.includes('short_funding_acc')) {
        this.db.exec('ALTER TABLE active_trades ADD COLUMN short_funding_acc REAL DEFAULT 0');
      }
      if (!names.includes('interval')) {
        this.db.exec("ALTER TABLE active_trades ADD COLUMN interval TEXT DEFAULT '8h'");
      }
    } catch {
      // ignore if table doesn't exist yet
    }
  }

  private migrateBotSettingsColumns(): void {
    try {
      const info = this.db.pragma('table_info(bot_settings)') as { name: string }[];
      const names = info.map((c) => c.name);
      if (!names.includes('manual_trading_enabled')) {
        this.db.exec('ALTER TABLE bot_settings ADD COLUMN manual_trading_enabled INTEGER DEFAULT 1');
      }
    } catch {
      // ignore
    }
  }
}

const db = new DatabaseClient();
db.init();

export { db, DatabaseClient };
