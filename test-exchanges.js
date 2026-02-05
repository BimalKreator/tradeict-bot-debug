/**
 * Temporary script to test Binance and Bybit exchange clients.
 * Run with: npx tsx test-exchanges.js
 */
require('dotenv').config({ path: '.env.local' });

const { BinanceExchange } = require('./src/lib/exchanges/binance');
const { BybitExchange } = require('./src/lib/exchanges/bybit');

async function main() {
  const binance = new BinanceExchange();
  const bybit = new BybitExchange();

  try {
    const binanceBalance = await binance.getBalance();
    console.log('Binance USDT balance:', binanceBalance);
  } catch (err) {
    console.error('Binance error:', err.message);
  }

  try {
    const bybitBalance = await bybit.getBalance();
    console.log('Bybit USDT balance:', bybitBalance);
  } catch (err) {
    console.error('Bybit error:', err.message);
  }
}

main();
