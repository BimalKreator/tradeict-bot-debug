#!/usr/bin/env node
/**
 * Inspect raw funding rate JSON from Binance and Bybit.
 * Run: node scripts/inspect-raw.js
 * Loads .env.local if present (optional; funding rates are public).
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const ccxt = require('ccxt');

const TARGETS = ['FLOW', 'JST'];
const FIELDS = ['fundingInterval', 'fundingIntervalHours', 'interval', 'nextFundingTime'];

function findRate(rates, base) {
  const key = Object.keys(rates).find((k) => k.startsWith(base + '/'));
  return key ? rates[key] : null;
}

function inspect(rate, exchangeId, symbol) {
  if (!rate) {
    console.log(`\n--- ${exchangeId} ${symbol}: NOT FOUND ---`);
    return;
  }
  const info = rate.info || {};
  console.log(`\n========== ${exchangeId} ${symbol} ==========`);
  console.log('FULL info object (JSON):');
  console.log(JSON.stringify(info, null, 2));
  console.log('\nCCXT unified fields:');
  console.log('  symbol:', rate.symbol);
  console.log('  fundingRate:', rate.fundingRate);
  console.log('  fundingTimestamp:', rate.fundingTimestamp);
  console.log('  datetime:', rate.datetime);
  console.log('  interval (CCXT):', rate.interval);
  console.log('\nRequested fields from info:');
  for (const f of FIELDS) {
    console.log(`  ${f}:`, info[f] ?? '(not present)');
  }
}

async function main() {
  const binance = new ccxt.binanceusdm({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_SECRET,
    enableRateLimit: true,
    options: { defaultType: 'future' },
  });

  const bybit = new ccxt.bybit({
    apiKey: process.env.BYBIT_API_KEY,
    secret: process.env.BYBIT_SECRET,
    enableRateLimit: true,
    options: { defaultType: 'linear' },
  });

  console.log('Fetching Binance funding rates...');
  const binanceRates = await binance.fetchFundingRates();
  console.log('Fetching Bybit funding rates...');
  const bybitRates = await bybit.fetchFundingRates(undefined, { type: 'swap', subType: 'linear' });

  for (const base of TARGETS) {
    const binRate = findRate(binanceRates, base);
    const bybitRate = findRate(bybitRates, base);
    inspect(binRate, 'Binance', base);
    inspect(bybitRate, 'Bybit', base);
  }

  console.log('\n\n--- DONE ---');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
