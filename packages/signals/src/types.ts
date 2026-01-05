import type { Market, OrderBook, Position, Order, Fill } from '@pm-bot/core';
import Decimal from 'decimal.js';

export interface TradingState {
  markets: Map<string, Market>;
  orderBooks: Map<string, OrderBook>;
  positions: Map<string, Position>;
  openOrders: Map<string, Order>;
  timestamp: Date;
}

export interface Signal {
  id: string;
  strategy: 'parity' | 'xrv' | 'time';
  tokenId: string;
  marketId?: string; // Optional, can be derived from tokenId
  side: 'buy' | 'sell';
  limitPrice: Decimal;
  size: Decimal;
  expectedEdgeBps: Decimal; // Expected edge in basis points
  confidence: Decimal; // 0-1
  ttlMs: number; // Time to live in milliseconds
  createdAt: number; // Timestamp
  rationale: Record<string, any>; // Include mapping version when relevant
  expiry?: Date; // Optional expiry time (deprecated, use ttlMs)
}

export interface OrderIntent {
  signal: Signal;
  gated: boolean;
  gateReasons?: string[];
}

export interface Strategy {
  name: string;
  onStart(state: TradingState): Promise<void>;
  onTick(state: TradingState): Promise<Signal[]>;
  onFill(fill: Fill, state: TradingState): Promise<void>;
  onStop(): Promise<void>;
}

