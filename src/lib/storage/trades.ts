import fs from 'fs';
import path from 'path';

export interface TradeLeg {
  exchange: string;
  orderId: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
}

export interface Trade {
  id: string;
  symbol: string;
  status: 'OPEN' | 'CLOSED';
  legs: TradeLeg[];
  timestamp: number;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const TRADES_FILE = path.join(DATA_DIR, 'trades.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readTrades(): Trade[] {
  ensureDataDir();
  if (!fs.existsSync(TRADES_FILE)) {
    return [];
  }
  const data = fs.readFileSync(TRADES_FILE, 'utf-8');
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeTrades(trades: Trade[]) {
  ensureDataDir();
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2), 'utf-8');
}

function generateId(): string {
  return `trade_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function saveTrade(trade: Omit<Trade, 'id' | 'timestamp'>): Trade {
  const fullTrade: Trade = {
    ...trade,
    id: generateId(),
    timestamp: Date.now(),
  };
  const trades = readTrades();
  trades.push(fullTrade);
  writeTrades(trades);
  return fullTrade;
}

export function getTrades(): Trade[] {
  return readTrades();
}
