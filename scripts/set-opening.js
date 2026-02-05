#!/usr/bin/env node
/**
 * Set Opening Balance for a given date (default: 2026-02-06).
 * Run: node scripts/set-opening.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 1. Find DB (matches src/lib/db/sqlite.ts: data/trading_bot.db)
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
  console.error('❌ DB not found. Tried:', possiblePaths);
  process.exit(1);
}

console.log(`Checking DB at: ${dbPath}`);
const db = new Database(dbPath);

// 2. Identify Table
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all()
  .map((t) => t.name);

const targetTable = tables.find(
  (t) =>
    t.includes('daily') && (t.includes('balance') || t.includes('snapshot'))
);

if (!targetTable) {
  console.error('❌ Could not find a balance history table. Tables found:', tables);
  db.close();
  process.exit(1);
}

console.log(`🎯 Found table: ${targetTable}`);

// 3. Get columns (daily_balance_snapshots: date, opening_balance, closing_balance, ...)
const tableInfo = db.prepare(`PRAGMA table_info(${targetTable})`).all();
const dateCol = tableInfo.find((c) => c.name === 'date' || c.name.includes('date'))?.name;
const balCol =
  tableInfo.find((c) => c.name === 'opening_balance')?.name ||
  tableInfo.find((c) => c.name.includes('opening'))?.name ||
  tableInfo.find((c) => c.name.includes('balance'))?.name ||
  tableInfo.find((c) => c.name.includes('total'))?.name;

if (!dateCol || !balCol) {
  console.error(`❌ Could not identify columns in ${targetTable}`, tableInfo);
  db.close();
  process.exit(1);
}

const todayStr = '2026-02-06';

try {
  const existing = db.prepare(`SELECT * FROM ${targetTable} WHERE ${dateCol} = ?`).get(todayStr);

  if (existing) {
    db.prepare(`UPDATE ${targetTable} SET ${balCol} = 75 WHERE ${dateCol} = ?`).run(todayStr);
    console.log(`✅ Updated Opening Balance to $75 for ${todayStr}`);
  } else {
    // Insert new record
    if (targetTable === 'daily_balance_snapshots') {
      db.prepare(
        `INSERT INTO daily_balance_snapshots (date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage) VALUES (?, 75, NULL, 0, 0, 0)`
      ).run(todayStr);
      console.log(`✅ Inserted new record: Opening Balance $75 for ${todayStr}`);
    } else if (targetTable === 'daily_ledger') {
      db.prepare(`INSERT INTO daily_ledger (date, total_balance) VALUES (?, 75)`).run(todayStr);
      console.log(`✅ Inserted new record: Total Balance $75 for ${todayStr}`);
    } else {
      console.log(`⚠️ No record for ${todayStr}. Insert schema unknown for ${targetTable}.`);
      console.log('Columns:', tableInfo.map((c) => c.name).join(', '));
    }
  }

  const row = db.prepare(`SELECT * FROM ${targetTable} WHERE ${dateCol} = ?`).get(todayStr);
  console.log('Current Record:', row);
} catch (e) {
  console.error('Error:', e.message);
} finally {
  db.close();
}
