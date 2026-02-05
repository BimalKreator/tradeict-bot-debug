/**
 * Temporary script to test the funding rate screener.
 * Run with: npx tsx test-screener.js
 */
require('dotenv').config({ path: '.env.local' });

const { ExchangeManager } = require('./src/lib/exchanges/manager');
const { getCommonTokens, calculateFundingSpreads } = require('./src/lib/utils/screener');

async function main() {
  const manager = new ExchangeManager();

  const { binance: binanceRates, bybit: bybitRates } = await manager.getFundingRates();
  const commonTokens = getCommonTokens(binanceRates, bybitRates);
  const opportunities = calculateFundingSpreads(commonTokens, binanceRates, bybitRates);

  console.log('Top 3 funding rate opportunities:');
  opportunities.slice(0, 3).forEach((opp, i) => {
    console.log(`\n${i + 1}. ${opp.symbol}`);
    console.log(`   Spread: ${(opp.spread * 100).toFixed(4)}%`);
    console.log(`   Binance: ${(opp.binanceRate * 100).toFixed(4)}% | Bybit: ${(opp.bybitRate * 100).toFixed(4)}%`);
    console.log(`   Direction: LONG ${opp.longExchange.toUpperCase()} / SHORT ${opp.shortExchange.toUpperCase()}`);
    console.log(`   Interval: ${opp.interval}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
