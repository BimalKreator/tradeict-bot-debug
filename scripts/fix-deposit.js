#!/usr/bin/env node
/**
 * Update total_deposits for a given date in daily_balance_snapshots.
 * Run: node scripts/fix-deposit.js
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

const today = '2026-02-06';
const depositAmount = 106.32;

try {
  db.prepare(
    `UPDATE daily_balance_snapshots SET total_deposits = ? WHERE date = ?`
  ).run(depositAmount, today);

  console.log(`✅ Success! Updated Deposit to $${depositAmount} for ${today}`);

  const row = db.prepare('SELECT * FROM daily_balance_snapshots WHERE date = ?').get(today);
  console.log('Current Record:', row);
} catch (e) {
  console.error('Error:', e.message);
} finally {
  db.close();
}
