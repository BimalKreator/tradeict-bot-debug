export interface FundingRate {
    symbol: string;
    rate: number;
    interval: string;
    exchange: string;
  }
  
  export interface Position {
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    entryPrice: number;
    leverage: number;
    exchange: string;
  }
  
  export interface TradeParams {
    symbol: string;
    quantity: number;
    leverage: number;
    orderType: 'MARKET' | 'LIMIT';
  }