#!/usr/bin/env node
/**
 * Force-fix Opening Balance for a given date.
 * Updates daily_balance_snapshots, daily_ledger, and portfolio_history (if exists).
 * Run: node scripts/force-fix-balance.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 1. Find DB (matches src/lib/db/sqlite.ts)
const possiblePaths = [
  path.join(process.cwd(), 'data/trading_bot.db'),
  path.join(process.cwd(), 'data/data.db'),
  path.join(process.cwd(), '.next/standalone/data/trading_bot.db'),
  path.join(process.cwd(), '.next/standalone/data/data.db'),
  path.join(process.cwd(), 'data/trade.db'),
  path.join(process.cwd(), 'data.db'),
];

const dbPath = possiblePaths.find((p) => fs.existsSync(p));
if (!dbPath) {
  console.error('❌ DB not found');
  process.exit(1);
}

const db = new Database(dbPath);
console.log(`Using DB: ${dbPath}`);

const targetDate = '2026-02-06';

try {
  // 1. Fix Daily Snapshot (daily_balance_snapshots)
  try {
    const u1 = db.prepare('UPDATE daily_balance_snapshots SET opening_balance = 75 WHERE date = ?').run(targetDate);
    if (u1.changes > 0) {
      console.log('✅ Updated daily_balance_snapshots (opening_balance = 75)');
    } else {
      db.prepare(
        'INSERT OR REPLACE INTO daily_balance_snapshots (date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage) VALUES (?, 75, NULL, 0, 0, 0)'
      ).run(targetDate);
      console.log('✅ Inserted daily_balance_snapshots for ' + targetDate);
    }
  } catch (e) {
    console.warn('⚠️ daily_balance_snapshots:', e.message);
  }

  // 2. Fix Daily Ledger (THIS is what the stats API uses for opening_balance!)
  try {
    const u2 = db.prepare('UPDATE daily_ledger SET total_balance = 75 WHERE date = ?').run(targetDate);
    if (u2.changes > 0) {
      console.log('✅ Updated daily_ledger (total_balance = 75)');
    } else {
      db.prepare('INSERT OR REPLACE INTO daily_ledger (date, total_balance, created_at) VALUES (?, 75, CURRENT_TIMESTAMP)').run(targetDate);
      console.log('✅ Inserted daily_ledger for ' + targetDate);
    }
  } catch (e) {
    console.warn('⚠️ daily_ledger:', e.message);
  }

  // 3. Fix Portfolio History (if table exists - some setups may have it)
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_history'").get();
    if (tables) {
      const startOfDay = new Date(targetDate + 'T00:00:00Z').getTime();
      const endOfDay = new Date(targetDate + 'T23:59:59Z').getTime();

      const firstRecord = db
        .prepare(
          `SELECT id, timestamp, total_balance FROM portfolio_history WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC LIMIT 1`
        )
        .get(startOfDay, endOfDay);

      if (firstRecord) {
        db.prepare('UPDATE portfolio_history SET total_balance = 75 WHERE id = ?').run(firstRecord.id);
        console.log(`✅ Updated portfolio_history ID ${firstRecord.id} to $75`);
      } else {
        const info = db.prepare('PRAGMA table_info(portfolio_history)').all();
        const cols = info.map((c) => c.name).join(', ');
        if (cols.includes('timestamp') && cols.includes('total_balance')) {
          db.prepare(
            `INSERT INTO portfolio_history (timestamp, total_balance, available_balance, locked_balance, pnl) VALUES (?, 75, 75, 0, 0)`
          ).run(startOfDay + 1000);
          console.log('✅ Inserted portfolio_history record for 00:00:01');
        }
      }
    }
  } catch (e) {
    // Table may not exist - ignore
  }

  // Verify
  const snap = db.prepare('SELECT * FROM daily_balance_snapshots WHERE date = ?').get(targetDate);
  const ledg = db.prepare('SELECT * FROM daily_ledger WHERE date = ?').get(targetDate);
  console.log('\n--- Verify ---');
  console.log('daily_balance_snapshots:', snap || '(none)');
  console.log('daily_ledger:', ledg || '(none)');
} catch (e) {
  console.error('Error:', e.message);
} finally {
  db.close();
}
