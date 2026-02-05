const MM_RATE = 0.004; // 0.4%

/**
 * Calculates liquidation price for Binance-style perpetual (same formula often used for Bybit linear).
 * Long: price drops to liq; Short: price rises to liq.
 */
export function calculateBinanceLiq(
  entryPrice: number,
  leverage: number,
  side: 'LONG' | 'SHORT'
): number {
  if (leverage <= 0) return entryPrice;
  const invLeverage = 1 / leverage;
  if (side === 'LONG') {
    return entryPrice * (1 - invLeverage + MM_RATE);
  }
  return entryPrice * (1 + invLeverage - MM_RATE);
}
