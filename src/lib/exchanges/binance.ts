import * as ccxt from 'ccxt';

/**
 * Binance exchange client configured for USDT-M Futures.
 * Uses testnet/sandbox when process.env.USE_TESTNET is 'true'.
 */
export class BinanceExchange {
  private exchange: ccxt.Exchange;

  constructor() {
    const isTestnet = process.env.USE_TESTNET === 'true';
    this.exchange = new ccxt.binanceusdm({
      apiKey: process.env.BINANCE_API_KEY,
      secret: process.env.BINANCE_SECRET,
      enableRateLimit: true,
      ...(isTestnet && {
        urls: {
          api: {
            public: 'https://testnet.binancefuture.com/fapi/v1',
            private: 'https://testnet.binancefuture.com/fapi/v1',
          },
        },
      }),
      options: {
        defaultType: 'future',
      },
    });
  }

  /**
   * Loads markets and returns them for symbol mapping (e.g. WS id -> unified symbol).
   */
  async loadMarketsAndGet(): Promise<{ id?: string; symbol?: string }[]> {
    await this.exchange.loadMarkets();
    return Object.values(this.exchange.markets) as { id?: string; symbol?: string }[];
  }

  /**
   * Returns CCXT market for symbol (must have called loadMarketsAndGet first).
   * Used for metadata-first interval resolution (no API call).
   */
  getMarket(symbol: string): { info?: Record<string, unknown> } | undefined {
    try {
      return this.exchange.market(symbol) as { info?: Record<string, unknown> } | undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Fetches funding rates for USDT perpetuals.
   */
  async fetchFundingRates(): Promise<Record<string, ccxt.FundingRate>> {
    const rates = await this.exchange.fetchFundingRates();
    return Object.fromEntries(
      Object.entries(rates).filter(([symbol]) =>
        symbol.includes('/USDT') && symbol.includes(':USDT')
      )
    );
  }

  /**
   * Fetches funding rate history for a symbol (for strict interval calculation).
   * Returns array of { fundingTime: number } in ascending order (oldest first).
   * Used to compute interval = (history[1].fundingTime - history[0].fundingTime) / 3600000.
   */
  async fetchFundingRateHistory(symbol: string, limit: number = 2): Promise<{ fundingTime: number }[]> {
    const binanceSymbol = symbol.includes('/')
      ? symbol.split('/')[0] + 'USDT'
      : symbol.replace(/USDT:?USDT?/i, '') + 'USDT';
    try {
      const res = await (this.exchange as any).fapiPublicGetFundingRate?.({
        symbol: binanceSymbol,
        limit: Math.min(limit, 10),
      });
      if (!Array.isArray(res)) return [];
      return res
        .map((r: { fundingTime?: number }) => ({
          fundingTime: r?.fundingTime ?? 0,
        }))
        .filter((r: { fundingTime: number }) => r.fundingTime > 0)
        .sort((a: { fundingTime: number }, b: { fundingTime: number }) => a.fundingTime - b.fundingTime);
    } catch {
      return [];
    }
  }

  /**
   * Sets leverage for a symbol.
   */
  async setLeverage(leverage: number, symbol: string): Promise<void> {
    await this.exchange.setLeverage(leverage, symbol);
  }

  /**
   * Creates a market order. Returns order with id, average price, filled amount.
   */
  async createMarketOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number
  ): Promise<{ orderId: string; price: number; quantity: number }> {
    const order = await this.exchange.createOrder(symbol, 'market', side, amount);
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
      if (info?.quantityPrecision != null) return Math.pow(10, -Number(info.quantityPrecision));
      if (info?.lotSizeFilter?.stepSize != null) return parseFloat(String(info.lotSizeFilter.stepSize));
      return 0.001;
    } catch {
      return 0.001;
    }
  }

  /**
   * Fetches mark price for a symbol (for margin calculations).
   */
  async getMarkPrice(symbol: string): Promise<number> {
    const ticker = await this.exchange.fetchTicker(symbol);
    return ticker.last ?? (ticker as any).mark ?? 0;
  }

  /** Position size from contracts or positionAmt (Binance raw). */
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
    const positions = await this.exchange.fetchPositions();
    const pos = positions.find((p) => {
      const norm = (s: string) => (s.includes('/') ? s : `${s.replace(/USDT$/i, '')}/USDT:USDT`);
      const match = p.symbol === symbol || norm(p.symbol) === norm(symbol);
      return match && BinanceExchange.positionSize(p) > 0;
    });
    if (!pos || BinanceExchange.positionSize(pos) === 0) return { price: 0 };

    const amount = BinanceExchange.positionSize(pos);
    const sideRaw = pos.side?.toString().toLowerCase();
    const amt = (pos as unknown as { positionAmt?: number }).positionAmt;
    const isShort = sideRaw === 'short' || (typeof amt === 'number' && amt < 0);
    const side = (isShort ? 'buy' : 'sell') as 'buy' | 'sell';
    const order = await this.exchange.createOrder(symbol, 'market', side, amount);
    const price = order.average ?? order.price ?? 0;
    return { price: typeof price === 'number' ? price : 0 };
  }

  /**
   * Fetches deposit history (may require wallet/spot API permissions).
   */
  async fetchDeposits(code?: string, since?: number): Promise<any[]> {
    try {
      return await this.exchange.fetchDeposits(code ?? 'USDT', since);
    } catch {
      return [];
    }
  }

  /**
   * Fetches withdrawal history (may require wallet/spot API permissions).
   */
  async fetchWithdrawals(code?: string, since?: number): Promise<any[]> {
    try {
      return await this.exchange.fetchWithdrawals(code ?? 'USDT', since);
    } catch {
      return [];
    }
  }

  /**
   * Fetches open positions from the Futures account.
   */
  async fetchPositions(): Promise<ccxt.Position[]> {
    return this.exchange.fetchPositions();
  }

  /**
   * Fetches total USDT balance for the Futures account.
   */
  async getBalance(): Promise<number> {
    const balance = await this.exchange.fetchBalance();
    const usdt = (balance.total as any)?.['USDT'] ?? 0;
    return typeof usdt === 'number' ? usdt : 0;
  }

  /**
   * Fetches balance and used margin (totalInitialMargin) from the Futures account.
   * Source of truth: Binance API totalInitialMargin from fapi/v2/account or balance.info.
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
    if (usedMargin === 0) {
      try {
        const account = await (this.exchange as any).fapiPrivateV2GetAccount?.();
        if (account?.totalInitialMargin != null) {
          usedMargin = parseFloat(String(account.totalInitialMargin)) || 0;
        }
      } catch {
        // fallback to balance.used
      }
    }
    if (usedMargin === 0 && typeof (balance as any).used === 'object') {
      const used = (balance as any).used?.['USDT'];
      usedMargin = typeof used === 'number' ? used : parseFloat(String(used || 0)) || 0;
    }

    return { balance: bal, usedMargin };
  }
}
