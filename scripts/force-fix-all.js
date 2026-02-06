#!/usr/bin/env node
/**
 * Master Fix: Set 2026-02-06 opening_balance to $75 across all DB locations.
 * Run: node scripts/force-fix-all.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const possiblePaths = [
  path.join(process.cwd(), 'data/trading_bot.db'),
  path.join(process.cwd(), '.next/standalone/data/trading_bot.db'),
  path.join(__dirname, '../data/trading_bot.db'),
];
const uniquePaths = [...new Set(possiblePaths)];

console.log('🔍 Scanning for databases to fix...');

let fixedCount = 0;

uniquePaths.forEach((dbPath) => {
  if (fs.existsSync(dbPath)) {
    console.log(`\n🛠️  Found DB at: ${dbPath}`);
    try {
      const db = new Database(dbPath);

      const before = db
        .prepare("SELECT * FROM daily_balance_snapshots WHERE date = '2026-02-06'")
        .get();
      console.log('   Current State:', before || 'No record');

      db.prepare(`
        UPDATE daily_balance_snapshots 
        SET opening_balance = 75
        WHERE date = '2026-02-06'
      `).run();

      const after = db
        .prepare("SELECT * FROM daily_balance_snapshots WHERE date = '2026-02-06'")
        .get();
      console.log('   ✅ FIXED State:', after);
      console.log('   Success: Opening Balance is now $75.00');
      fixedCount++;

      db.close();
    } catch (e) {
      console.error('   ❌ Error fixing this DB:', e.message);
    }
  }
});

if (fixedCount === 0) {
  console.error(
    '\n❌ No database file found! Please check if data/trading_bot.db exists.'
  );
  process.exit(1);
} else {
  console.log(
    `\n✅ Finished. Updated ${fixedCount} database file(s). Please Refresh Dashboard.`
  );
}
