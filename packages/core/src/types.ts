import Decimal from 'decimal.js';

export type MarketId = string;
export type TokenId = string;
export type OrderId = string;
export type UserId = string;

export interface Market {
  id: MarketId;
  question: string;
  description?: string;
  conditionId: string;
  outcomes: OutcomeToken[];
  endDate?: Date;
  imageUrl?: string;
  active: boolean;
}

export interface OutcomeToken {
  tokenId: TokenId;
  outcome: string;
  marketId: MarketId;
  decimals: number;
}

export interface PriceLevel {
  price: Decimal;
  size: Decimal;
}

export interface OrderBook {
  marketId: MarketId;
  tokenId: TokenId;
  bids: PriceLevel[];
  asks: PriceLevel[];
  lastUpdate: Date;
  sequence?: number;
}

export interface Trade {
  id: string;
  marketId: MarketId;
  tokenId: TokenId;
  price: Decimal;
  size: Decimal;
  side: 'buy' | 'sell';
  timestamp: Date;
  taker?: UserId;
  maker?: UserId;
}

export interface Position {
  marketId: MarketId;
  tokenId: TokenId;
  size: Decimal; // positive = long, negative = short
  avgPrice: Decimal;
  realizedPnl: Decimal;
  unrealizedPnl: Decimal;
  lastUpdate: Date;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';
export type OrderStatus = 'pending' | 'open' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected';

export interface Order {
  id: OrderId;
  marketId: MarketId;
  tokenId: TokenId;
  side: OrderSide;
  type: OrderType;
  price: Decimal;
  size: Decimal;
  filledSize: Decimal;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  clientOrderId?: string;
  reason?: string;
}

export interface Fill {
  id: string;
  orderId: OrderId;
  marketId: MarketId;
  tokenId: TokenId;
  side: OrderSide;
  price: Decimal;
  size: Decimal;
  fee: Decimal;
  timestamp: Date;
}

// Utility functions
export function priceToProbability(price: Decimal): Decimal {
  return price;
}

export function probabilityToPrice(prob: Decimal): Decimal {
  return prob;
}

export function calculateSpread(book: OrderBook): Decimal | null {
  if (book.bids.length === 0 || book.asks.length === 0) {
    return null;
  }
  const bestBid = book.bids[0].price;
  const bestAsk = book.asks[0].price;
  return bestAsk.minus(bestBid);
}

export function calculateMidPrice(book: OrderBook): Decimal | null {
  if (book.bids.length === 0 || book.asks.length === 0) {
    return null;
  }
  const bestBid = book.bids[0].price;
  const bestAsk = book.asks[0].price;
  return bestBid.plus(bestAsk).div(2);
}

export function calculateDepthAtPrice(
  book: OrderBook,
  price: Decimal,
  side: OrderSide
): Decimal {
  const levels = side === 'buy' ? book.asks : book.bids;
  let depth = new Decimal(0);
  for (const level of levels) {
    if (side === 'buy' && level.price.gte(price)) {
      depth = depth.plus(level.size);
    } else if (side === 'sell' && level.price.lte(price)) {
      depth = depth.plus(level.size);
    }
  }
  return depth;
}

export function estimateSlippage(
  book: OrderBook,
  side: OrderSide,
  size: Decimal
): { avgPrice: Decimal; slippage: Decimal } | null {
  const levels = side === 'buy' ? book.asks : book.bids;
  if (levels.length === 0) {
    return null;
  }

  let remaining = size;
  let totalCost = new Decimal(0);
  let totalSize = new Decimal(0);

  for (const level of levels) {
    if (remaining.lte(0)) break;
    const fillSize = Decimal.min(remaining, level.size);
    totalCost = totalCost.plus(level.price.times(fillSize));
    totalSize = totalSize.plus(fillSize);
    remaining = remaining.minus(fillSize);
  }

  if (totalSize.eq(0)) {
    return null;
  }

  const avgPrice = totalCost.div(totalSize);
  const midPrice = calculateMidPrice(book);
  const slippage = midPrice ? avgPrice.minus(midPrice).abs() : new Decimal(0);

  return { avgPrice, slippage };
}

