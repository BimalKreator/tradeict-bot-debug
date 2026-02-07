import * as ccxt from 'ccxt';

/**
 * Bybit exchange client configured for USDT Perpetual (Futures).
 * Uses testnet/sandbox when process.env.USE_TESTNET is 'true'.
 */
export class BybitExchange {
  private exchange: ccxt.Exchange;

  constructor() {
    const isTestnet = process.env.USE_TESTNET === 'true';
    this.exchange = new ccxt.bybit({
      apiKey: process.env.BYBIT_API_KEY,
      secret: process.env.BYBIT_SECRET,
      enableRateLimit: true,
      options: {
        defaultType: 'linear', // USDT-margined perpetuals
        recvWindow: 10_000, // 10s drift tolerance for server time vs Bybit (fixes InvalidNonce / recv_window param)
      },
    });
    if (isTestnet) {
      this.exchange.setSandboxMode(true);
    }
  }

  /**
   * Fetches funding rates for USDT perpetuals.
   */
  async fetchFundingRates(): Promise<Record<string, ccxt.FundingRate>> {
    const rates = await this.exchange.fetchFundingRates(undefined, {
      type: 'swap',
      subType: 'linear',
    });
    return Object.fromEntries(
      Object.entries(rates).filter(([symbol]) =>
        symbol.includes('/USDT') && symbol.includes(':USDT')
      )
    );
  }

  /**
   * Sets leverage for a symbol.
   * Treats Bybit error 110043 ("leverage not modified") as success when leverage is already set.
   */
  async setLeverage(leverage: number, symbol: string): Promise<void> {
    try {
      await this.exchange.setLeverage(leverage, symbol, {
        type: 'swap',
        subType: 'linear',
      });
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      const message = String((err as { message?: string })?.message ?? err);
      const isNotModified =
        code === 110043 || message.toLowerCase().includes('not modified');
      if (isNotModified) {
        console.warn('[Bybit] Leverage already set');
        return;
      }
      throw err;
    }
  }

  /**
   * Creates a market order. Returns order with id, average price, filled amount.
   */
  async createMarketOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number
  ): Promise<{ orderId: string; price: number; quantity: number }> {
    const order = await this.exchange.createOrder(symbol, 'market', side, amount, undefined, {
      type: 'swap',
      subType: 'linear',
    });
    return {
      orderId: order.id ?? '',
      price: order.average ?? order.price ?? 0,
      quantity: order.filled ?? order.amount ?? amount,
    };
  }

  /**
   * Returns lot size step (precision.amount) for a symbol. Used for common lot size rounding.
   */
  async getLotSizeStep(symbol: string): Promise<number> {
    try {
      const markets = await this.exchange.loadMarkets();
      const m = markets[symbol] ?? Object.values(markets).find((x: any) => x.id === symbol?.split('/')[0] + 'USDT');
      const step = (m as any)?.precision?.amount;
      if (typeof step === 'number' && step > 0) return step;
      const info = (m as any)?.info;
      if (info?.lotSizeFilter?.baseStep != null) return parseFloat(String(info.lotSizeFilter.baseStep));
      if (info?.lotSizeFilter?.qtyStep != null) return parseFloat(String(info.lotSizeFilter.qtyStep));
      return 0.001;
    } catch {
      return 0.001;
    }
  }

  /**
   * Fetches mark price for a symbol (for margin calculations).
   */
  async getMarkPrice(symbol: string): Promise<number> {
    const ticker = await this.exchange.fetchTicker(symbol, {
      type: 'swap',
      subType: 'linear',
    });
    return ticker.last ?? (ticker as any).mark ?? 0;
  }

  /** Position size from contracts or positionAmt. */
  private static positionSize(pos: ccxt.Position): number {
    const c = pos.contracts ?? 0;
    const amt = (pos as unknown as { positionAmt?: number }).positionAmt;
    const p = typeof amt === 'number' ? amt : 0;
    return Math.abs(c || p);
  }

  /**
   * Closes a position completely with a market order.
   * Returns the average fill price, or 0 if no position.
   */
  async closePosition(symbol: string): Promise<{ price: number }> {
    const positions = await this.exchange.fetchPositions(undefined, {
      type: 'swap',
      subType: 'linear',
    });
    const pos = positions.find((p) => {
      const norm = (s: string) => (s.includes('/') ? s : `${s.replace(/USDT$/i, '')}/USDT:USDT`);
      const match = p.symbol === symbol || norm(p.symbol) === norm(symbol);
      return match && BybitExchange.positionSize(p) > 0;
    });
    if (!pos || BybitExchange.positionSize(pos) === 0) return { price: 0 };

    const amount = BybitExchange.positionSize(pos);
    const sideRaw = pos.side?.toString().toLowerCase();
    const amt = (pos as unknown as { positionAmt?: number }).positionAmt;
    const isShort = sideRaw === 'short' || (typeof amt === 'number' && amt < 0);
    const side = (isShort ? 'buy' : 'sell') as 'buy' | 'sell';
    const order = await this.exchange.createOrder(symbol, 'market', side, amount, undefined, {
      type: 'swap',
      subType: 'linear',
    });
    const price = order.average ?? order.price ?? 0;
    return { price: typeof price === 'number' ? price : 0 };
  }

  /**
   * Fetches deposit history (may require wallet API permissions).
   */
  async fetchDeposits(code?: string, since?: number): Promise<any[]> {
    try {
      return await this.exchange.fetchDeposits(code ?? 'USDT', since);
    } catch {
      return [];
    }
  }

  /**
   * Fetches withdrawal history (may require wallet API permissions).
   */
  async fetchWithdrawals(code?: string, since?: number): Promise<any[]> {
    try {
      return await this.exchange.fetchWithdrawals(code ?? 'USDT', since);
    } catch {
      return [];
    }
  }

  /**
   * Fetches open positions from the Futures/contract account.
   */
  async fetchPositions(): Promise<ccxt.Position[]> {
    return this.exchange.fetchPositions(undefined, {
      type: 'swap',
      subType: 'linear',
    });
  }

  /**
   * Fetches total USDT balance for the Futures/contract account.
   */
  async getBalance(): Promise<number> {
    const balance = await this.exchange.fetchBalance();
    const usdt = (balance.total as any)?.['USDT'] ?? 0;
    return typeof usdt === 'number' ? usdt : 0;
  }

  /**
   * Fetches balance and used margin (totalInitialMargin) from the account.
   * Source of truth: Bybit API totalInitialMargin. Tries UNIFIED then CONTRACT.
   */
  async getBalanceWithMargin(): Promise<{ balance: number; usedMargin: number }> {
    const balance = await this.exchange.fetchBalance();
    const usdt = (balance.total as any)?.['USDT'] ?? 0;
    const bal = typeof usdt === 'number' ? usdt : 0;

    let usedMargin = 0;
    const info = (balance as any).info;
    if (info?.totalInitialMargin != null) {
      usedMargin = parseFloat(String(info.totalInitialMargin)) || 0;
    }
    if (usedMargin === 0 && Array.isArray(info?.list) && info.list.length > 0) {
      const first = info.list[0];
      if (first?.totalInitialMargin != null) {
        usedMargin = parseFloat(String(first.totalInitialMargin)) || 0;
      }
    }
    if (usedMargin === 0) {
      try {
        for (const accountType of ['UNIFIED', 'CONTRACT']) {
          const res = await (this.exchange as any).privateGetV5AccountWalletBalance?.({
            accountType,
          });
          const list = res?.result?.list;
          if (Array.isArray(list) && list.length > 0) {
            const margin = list[0]?.totalInitialMargin;
            if (margin != null) {
              usedMargin = parseFloat(String(margin)) || 0;
              break;
            }
          }
        }
      } catch {
        // continue to fallback
      }
    }
    if (usedMargin === 0 && typeof (balance as any).used === 'object') {
      const used = (balance as any).used?.['USDT'];
      usedMargin = typeof used === 'number' ? used : parseFloat(String(used || 0)) || 0;
    }

    return { balance: bal, usedMargin };
  }
}
