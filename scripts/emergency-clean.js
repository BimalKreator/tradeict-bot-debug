const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Use ONLY trading_bot.db (matches src/lib/db/sqlite.ts) — never data.db
const possiblePaths = [
  path.join(process.cwd(), 'data/trading_bot.db'),
  path.join(process.cwd(), '.next/standalone/data/trading_bot.db'),
];

let dbPath = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    console.log(`Found DB at: ${p}`);
    dbPath = p;
    break;
  }
}

if (!dbPath) {
  console.error('❌ Could not find any .db file!');
  process.exit(1);
}

const db = new Database(dbPath);

try {
  // 1. Clear the stuck trades
  db.prepare('DELETE FROM active_trades').run();
  console.log('✅ CLEARED active_trades table.');

  // 2. Clear positions just in case (table may not exist)
  try {
    db.prepare('DELETE FROM positions WHERE status = "OPEN"').run();
    console.log('✅ CLEARED stuck open positions.');
  } catch (_) {
    // positions table may not exist
  }
} catch (error) {
  console.error('❌ Error cleaning DB:', error.message);
} finally {
  db.close();
}
