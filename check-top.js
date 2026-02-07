const http = require('http');

// बॉट की लोकल API को कॉल करें
const url = 'http://localhost:3000/api/screener';

console.log("📡 Fetching Top Opportunities from Bot...");

http.get(url, (res) => {
    let data = '';

    // डेटा के टुकड़े (Chunks) जोड़ें
    res.on('data', (chunk) => {
        data += chunk;
    });

    // जब पूरा डेटा आ जाए
    res.on('end', () => {
        try {
            const response = JSON.parse(data);
            const tokens = response.data || [];

            if (tokens.length === 0) {
                console.log("\n❌ No opportunities found (Screener is empty).");
                return;
            }

            console.log(`\n🏆 FOUND ${tokens.length} TOKENS. HERE ARE THE TOP 10:\n`);
            
            // टेबल का हैडर
            console.log(
                "RANK".padEnd(6) + 
                "SYMBOL".padEnd(16) + 
                "INTERVAL".padEnd(12) + 
                "NET SPREAD".padEnd(12) +
                "TIER"
            );
            console.log("-".repeat(60));

            // टॉप 10 को प्रिंट करें
            tokens.slice(0, 10).forEach((t, index) => {
                const interval = t.binanceInterval || t.binInterval || '?';
                const spread = parseFloat(t.netSpread).toFixed(4) + '%';
                
                // Tier Check Logic (Visual only)
                let tier = "Tier 2 (Slow)";
                if (interval == 1 || interval == 2) tier = "✅ Tier 1 (Fast)";

                console.log(
                    String(`#${index + 1}`).padEnd(6) + 
                    t.symbol.split(':')[0].padEnd(16) + 
                    String(interval + 'h').padEnd(12) + 
                    spread.padEnd(12) +
                    tier
                );
            });
            console.log("\n✅ Check: Are 1h/2h tokens at the top?");

        } catch (error) {
            console.error("❌ Error parsing JSON:", error.message);
            console.log("Raw Data:", data.substring(0, 200) + "...");
        }
    });

}).on('error', (err) => {
    console.error("❌ Connection Failed. Is the bot running?");
    console.error("Error:", err.message);
});