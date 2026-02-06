#!/usr/bin/env node
/**
 * Lock 5 Feb closing at $75 and set 6 Feb opening to $75.
 * Run: node scripts/fix-timeline.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(process.cwd(), 'data/trading_bot.db');
if (!fs.existsSync(dbPath)) {
  console.error('❌ DB not found at', dbPath);
  process.exit(1);
}

const db = new Database(dbPath);
console.log('🛠️ Fixing Timeline for 5th & 6th Feb...');

try {
  // 1. HARDCODE 5th Feb 2026 (The Baseline) — Closing Balance = $75
  db.prepare(`
    INSERT OR REPLACE INTO daily_balance_snapshots 
    (date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage)
    VALUES ('2026-02-05', 0, 75, 0, 0, 0)
  `).run();
  console.log('✅ 5 Feb 2026: Closing Balance set to $75.00');

  // 2. FIX 6th Feb 2026 (Today) — Opening = 5th's Closing ($75)
  db.prepare(`
    INSERT OR REPLACE INTO daily_balance_snapshots 
    (date, opening_balance, closing_balance, total_deposits, total_withdrawals, growth_percentage)
    VALUES ('2026-02-06', 75, NULL, 0, 0, 0)
  `).run();
  console.log('✅ 6 Feb 2026: Opening Balance set to $75.00');

  db.close();
} catch (e) {
  console.error('❌ Error:', e.message);
  db.close();
  process.exit(1);
}
