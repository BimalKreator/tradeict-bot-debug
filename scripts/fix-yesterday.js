#!/usr/bin/env node
/**
 * Fix Opening Balance: Yesterday's Closing = Today's Opening = $75.
 * Run: node scripts/fix-yesterday.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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

const yesterday = '2026-02-05';
const today = '2026-02-06';

try {
  // 1. Fix Yesterday: Set closing_balance = 75 (source for today's opening in ensureTodaySnapshot)
  const yRow = db.prepare('SELECT 1 FROM daily_balance_snapshots WHERE date = ?').get(yesterday);
  if (yRow) {
    db.prepare('UPDATE daily_balance_snapshots SET closing_balance = 75 WHERE date = ?').run(yesterday);
    console.log(`✅ Set Yesterday's (${yesterday}) closing_balance to $75`);
  } else {
    db.prepare(
      'INSERT INTO daily_balance_snapshots (date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage) VALUES (?, 75, 75, 0, 0, 0)'
    ).run(yesterday);
    console.log(`✅ Inserted Yesterday (${yesterday}) with opening_balance=$75, closing_balance=$75`);
  }

  // 2. Fix Today: Set opening_balance = 75
  const tRow = db.prepare('SELECT 1 FROM daily_balance_snapshots WHERE date = ?').get(today);
  if (tRow) {
    db.prepare('UPDATE daily_balance_snapshots SET opening_balance = 75 WHERE date = ?').run(today);
    console.log(`✅ Set Today's (${today}) opening_balance to $75`);
  } else {
    db.prepare(
      'INSERT INTO daily_balance_snapshots (date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage) VALUES (?, 75, NULL, 0, 0, 0)'
    ).run(today);
    console.log(`✅ Inserted Today (${today}) with opening_balance=$75`);
  }

  // 3. Fix daily_ledger (stats API uses this for opening_balance)
  db.prepare('INSERT OR REPLACE INTO daily_ledger (date, total_balance, created_at) VALUES (?, 75, CURRENT_TIMESTAMP)').run(yesterday);
  db.prepare('INSERT OR REPLACE INTO daily_ledger (date, total_balance, created_at) VALUES (?, 75, CURRENT_TIMESTAMP)').run(today);
  console.log('✅ Updated daily_ledger for yesterday and today');

  // 4. Fix portfolio_history (if table exists)
  try {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='portfolio_history'").get();
    if (exists) {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - 60000;
      const info = db.prepare('UPDATE portfolio_history SET total_balance = 75 WHERE timestamp > ? AND timestamp < ?').run(oneDayAgo, cutoff);
      console.log(`✅ Updated ${info.changes} portfolio_history records to $75`);
    }
  } catch (_) {
    // Table may not exist
  }

  // Verify
  console.log('\n--- Verify ---');
  console.log('Yesterday:', db.prepare('SELECT * FROM daily_balance_snapshots WHERE date = ?').get(yesterday));
  console.log('Today:', db.prepare('SELECT * FROM daily_balance_snapshots WHERE date = ?').get(today));
  console.log('Ledger yesterday:', db.prepare('SELECT * FROM daily_ledger WHERE date = ?').get(yesterday));
  console.log('Ledger today:', db.prepare('SELECT * FROM daily_ledger WHERE date = ?').get(today));
} catch (e) {
  console.error('Error:', e.message);
} finally {
  db.close();
}
