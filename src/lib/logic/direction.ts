type DirectionResult = {
  long: 'binance' | 'bybit';
  short: 'binance' | 'bybit';
};

export function getTradeDirection(
  binanceRate: number,
  bybitRate: number
): DirectionResult {
  const bothNegative = binanceRate < 0 && bybitRate < 0;
  const bothPositive = binanceRate > 0 && bybitRate > 0;

  if (bothNegative) {
    const long = binanceRate < bybitRate ? 'binance' : 'bybit';
    const short = long === 'binance' ? 'bybit' : 'binance';
    return { long, short };
  }

  if (bothPositive) {
    const short = binanceRate > bybitRate ? 'binance' : 'bybit';
    const long = short === 'binance' ? 'bybit' : 'binance';
    return { long, short };
  }

  const binanceAbs = Math.abs(binanceRate);
  const bybitAbs = Math.abs(bybitRate);
  const dominant = binanceAbs >= bybitAbs ? 'binance' : 'bybit';
  const dominantRate = dominant === 'binance' ? binanceRate : bybitRate;

  if (dominantRate < 0) {
    return {
      long: dominant,
      short: dominant === 'binance' ? 'bybit' : 'binance',
    };
  }

  return {
    long: dominant === 'binance' ? 'bybit' : 'binance',
    short: dominant,
  };
}
