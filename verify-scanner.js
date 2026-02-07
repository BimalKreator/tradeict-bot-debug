const ccxt = require('ccxt');

async function verifyIntervals() {
    console.log("🕵️  Verifying Interval Detection Logic (Live Test)...\n");

    const binance = new ccxt.binance({
        'options': { 'defaultType': 'future' } // Futures market jaruri hai
    });

    // Ye tokens aksar 1h/4h interval wale hote hain
    const testTokens = ['OG/USDT', 'UMA/USDT', 'API3/USDT', 'BTC/USDT'];

    for (const symbol of testTokens) {
        try {
            // Last 3 funding rates fetch karo
            const history = await binance.fetchFundingRateHistory(symbol, undefined, 3);

            if (history.length < 2) {
                console.log(`❌ ${symbol}: Not enough data.`);
                continue;
            }

            // Time difference nikalo (Latest - Previous)
            const latest = history[history.length - 1].timestamp;
            const prev = history[history.length - 2].timestamp;
            const diffHours = Math.round((latest - prev) / (1000 * 60 * 60));

            let status = "⚠️ Standard (8h)";
            if (diffHours < 8) status = "🔥 FAST CYCLE (1h/2h/4h) DETECTED!";

            console.log(`Token: ${symbol.padEnd(12)} | Detected Interval: ${diffHours}h  | ${status}`);

        } catch (error) {
            console.log(`❌ ${symbol}: Error fetching - ${error.message}`);
        }
    }
    console.log("\n✅ Agar upar 1h/4h dikh raha hai, to logic 100% sahi hai!");
}

verifyIntervals();
