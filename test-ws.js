const WebSocket = require('ws');

// --- BINANCE TEST ---
console.log("--- Testing Binance WebSocket ---");
const binanceWs = new WebSocket('wss://fstream.binance.com/ws/!markPrice@arr@1s');

binanceWs.on('open', () => {
    console.log("✅ Binance Connected!");
});

binanceWs.on('message', (data) => {
    const parsed = JSON.parse(data);
    // सिर्फ पहले वाले का डेटा दिखाओ ताकि स्क्रीन भर न जाए
    const firstToken = parsed[0];
    const now = Date.now();
    
    // Check Latency
    // Binance event time (E) vs Local Time
    const delay = now - firstToken.E; 

    console.log(`[Binance] Data Received for ${firstToken.s}`);
    console.log(`   Price: ${firstToken.p}`);
    console.log(`   Funding Rate: ${firstToken.r}`);
    console.log(`   Next Funding: ${new Date(firstToken.T).toLocaleTimeString()}`);
    console.log(`   Latency (Delay): ${delay}ms`);
    
    // 5 सेकंड बाद बंद कर दो
    setTimeout(() => { binanceWs.close(); startBybitTest(); }, 5000);
});

binanceWs.on('error', (err) => {
    console.error("❌ Binance Error:", err.message);
});

// --- BYBIT TEST ---
function startBybitTest() {
    console.log("\n--- Testing Bybit WebSocket ---");
    const bybitWs = new WebSocket('wss://stream.bybit.com/v5/public/linear');

    bybitWs.on('open', () => {
        console.log("✅ Bybit Connected! Sending Subscription...");
        bybitWs.send(JSON.stringify({
            "op": "subscribe",
            "args": ["tickers.BTCUSDT"]
        }));
    });

    bybitWs.on('message', (data) => {
        const parsed = JSON.parse(data);
        if (parsed.topic === "tickers.BTCUSDT") {
            const ticker = parsed.data;
            console.log(`[Bybit] Data Received for ${parsed.topic}`);
            console.log(`   Price: ${ticker.lastPrice}`);
            console.log(`   Funding Rate: ${ticker.fundingRate}`);
            console.log(`   Timestamp: ${new Date(parseInt(parsed.ts)).toLocaleTimeString()}`);
            
            bybitWs.close();
            console.log("\n✅ Test Complete. WebSockets are working fine.");
            process.exit(0);
        }
    });

    bybitWs.on('error', (err) => {
        console.error("❌ Bybit Error:", err.message);
    });
}
