// Global Cooldown Memory - shared across screener, candidate-selector, auto-entry
const FAILED_COOLDOWN = new Map<string, number>();
const COOLDOWN_DURATION = 20 * 60 * 1000; // 20 Minutes

function normalize(symbol: string): string {
  if (!symbol) return '';
  if (symbol.includes('/')) return symbol.split('/')[0];
  return symbol.replace(/USDT:?USDT?$/i, '');
}

export const cooldownManager = {
  add(symbol: string) {
    const base = normalize(symbol);
    console.log(`[Cooldown] 🛑 Adding ${base} to blacklist for 20m`);
    FAILED_COOLDOWN.set(symbol, Date.now());
    if (base !== symbol) FAILED_COOLDOWN.set(base, Date.now());
  },

  isReady(symbol: string): boolean {
    const base = normalize(symbol);
    const keys = [symbol, base].filter(Boolean);
    for (const k of keys) {
      if (!FAILED_COOLDOWN.has(k)) continue;
      const failedAt = FAILED_COOLDOWN.get(k) ?? 0;
      const diff = Date.now() - failedAt;
      if (diff > COOLDOWN_DURATION) {
        FAILED_COOLDOWN.delete(k);
        continue;
      }
      return false;
    }
    return true;
  },

  getRemaining(symbol: string): number {
    const base = normalize(symbol);
    let remaining = 0;
    for (const k of [symbol, base]) {
      const failedAt = FAILED_COOLDOWN.get(k) ?? 0;
      remaining = Math.max(remaining, Math.max(0, COOLDOWN_DURATION - (Date.now() - failedAt)));
    }
    return remaining;
  },
};
