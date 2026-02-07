const ccxt = require('ccxt');

async function debugScreener() {
    console.log("🔍 Starting Deep Debug of Screener Logic (Fixed)...");

    // 1. Initialize exchanges with 'swap' (Futures) option
    const binance = new ccxt.binance({
        enableRateLimit: true,
        options: { defaultType: 'swap' } // Critical: Tells CCXT to look at Futures
    });
    
    const bybit = new ccxt.bybit({
        enableRateLimit: true,
        options: { defaultType: 'swap' }
    });

    const symbol = 'BTC/USDT:USDT'; // Use Unified Symbol
    console.log(`Checking Symbol: ${symbol}`);

    try {
        // --- BINANCE DATA ---
        console.log("\n1. Fetching Binance Data...");
        // Load markets first to ensure symbols are known
        await binance.loadMarkets();
        
        const binTicker = await binance.fetchTicker(symbol);
        const binFunding = await binance.fetchFundingRate(symbol);
        
        console.log(`   - Price: ${binTicker.last}`);
        console.log(`   - Funding Rate: ${binFunding.fundingRate}`);
        
        // History Check Logic
        console.log("   - Fetching Funding History (Limit 2)...");
        const binHistory = await binance.fetchFundingRateHistory(symbol, undefined, 2);
        
        let calculatedInterval = 0;
        if (binHistory.length >= 2) {
            const latest = binHistory[binHistory.length - 1];
            const prev = binHistory[binHistory.length - 2];
            const diff = latest.timestamp - prev.timestamp;
            calculatedInterval = Math.round(diff / (1000 * 60 * 60)); // Round to nearest integer // Hours
            console.log(`   - History Timestamps: ${prev.datetime} -> ${latest.datetime}`);
        } else {
            console.log("   - History: Not enough data points.");
        }

        console.log(`   - Calculated Interval: ${calculatedInterval} Hours`);

        // --- BYBIT DATA ---
        console.log("\n2. Fetching Bybit Data...");
        const byFunding = await bybit.fetchFundingRate(symbol); 
        const byTicker = await bybit.fetchTicker(symbol);

        console.log(`   - Price: ${byTicker.last}`);
        console.log(`   - Funding Rate: ${byFunding.fundingRate}`);
        
        // Bybit usually gives interval in minutes or hours in 'info'
        let byInterval = 8; // Default
        if (byFunding.info && byFunding.info.fundingInterval) {
            // Bybit v5 returns interval in minutes (e.g., "60" or "480")
            byInterval = parseInt(byFunding.info.fundingInterval) / 60;
        }
        console.log(`   - Bybit Interval: ${byInterval} Hours`);

        // --- THE LOGIC CHECK (Simulation) ---
        console.log("\n3. 🕵️‍♂️ LOGIC VERIFICATION:");
        
        // 1. Interval Check
        if (calculatedInterval === 0) {
             console.error("❌ REJECTION: Binance Interval is 0 (API History Failed).");
        } else if (calculatedInterval !== byInterval) {
             console.error(`❌ REJECTION: Interval Mismatch! Binance=${calculatedInterval}h vs Bybit=${byInterval}h`);
        } else {
            console.log("✅ Interval Match!");
        }

        // 2. Spread Check
        const priceSpread = Math.abs((byTicker.last - binTicker.last) / binTicker.last) * 100;
        console.log(`   - Net Spread: ${priceSpread.toFixed(4)}%`);
        
        if (priceSpread < 0.1) {
             console.log("⚠️ Low Spread (Might be filtered if minProfit is high)");
        } else {
            console.log("✅ Spread looks good.");
        }

    } catch (e) {
        console.error("🔥 ERROR:", e);
    }
}

debugScreener();