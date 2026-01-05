import type { OrderBook } from '@pm-bot/polymarket';
import type { TradeRecord } from '@pm-bot/core';
import { calculateMidPrice } from '@pm-bot/core';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';

export interface OrderIntent {
  id: string;
  tokenId: string;
  side: 'buy' | 'sell';
  price: Decimal;
  size: Decimal;
  type: 'limit' | 'market';
  timestamp: Date;
  reason?: string;
}

export interface Fill {
  id: string;
  orderId: string;
  tokenId: string;
  side: 'buy' | 'sell';
  price: Decimal;
  size: Decimal;
  slippage: Decimal;
  spreadPaid: Decimal;
  fee: Decimal;
  timestamp: Date;
}

export interface PaperExecutionSimConfig {
  feeRate: Decimal; // e.g., 0.02 for 2%
  fillProbability: Decimal; // Probability of passive limit order filling (0-1)
}

export class PaperExecutionSim {
  private openOrders: Map<string, OrderIntent> = new Map();
  private config: PaperExecutionSimConfig;
  private fills: Fill[] = [];

  constructor(config: PaperExecutionSimConfig) {
    this.config = config;
  }

  placeOrder(intent: OrderIntent): OrderIntent {
    this.openOrders.set(intent.id, intent);
    return intent;
  }

  cancelOrder(orderId: string): boolean {
    return this.openOrders.delete(orderId);
  }

  getOpenOrders(): OrderIntent[] {
    return Array.from(this.openOrders.values());
  }

  processMarketUpdate(
    tokenId: string,
    book: OrderBook,
    trade?: TradeRecord
  ): Fill[] {
    const newFills: Fill[] = [];
    const ordersToRemove: string[] = [];

    for (const [orderId, order] of this.openOrders.entries()) {
      if (order.tokenId !== tokenId) {
        continue;
      }

      const fill = this.attemptFill(order, book, trade);
      if (fill) {
        newFills.push(fill);
        this.fills.push(fill);

        // Update or remove order
        const remainingSize = order.size.minus(fill.size);
        if (remainingSize.lte(0)) {
          ordersToRemove.push(orderId);
        } else {
          order.size = remainingSize;
        }
      }
    }

    // Remove filled orders
    for (const orderId of ordersToRemove) {
      this.openOrders.delete(orderId);
    }

    return newFills;
  }

  private attemptFill(
    order: OrderIntent,
    book: OrderBook,
    trade?: TradeRecord
  ): Fill | null {
    if (order.type === 'market') {
      return this.fillMarketOrder(order, book);
    } else {
      return this.fillLimitOrder(order, book, trade);
    }
  }

  private fillMarketOrder(order: OrderIntent, book: OrderBook): Fill | null {
    // Market orders fill immediately at best bid/ask
    if (order.side === 'buy') {
      if (book.asks.length === 0) {
        return null; // No liquidity
      }
      const bestAsk = book.asks[0];
      const fillPrice = bestAsk.price;
      const fillSize = Decimal.min(order.size, bestAsk.size);
      const midPrice = calculateMidPrice(book);
      const slippage = midPrice ? fillPrice.minus(midPrice) : new Decimal(0);
      const spreadPaid = midPrice ? fillPrice.minus(midPrice) : new Decimal(0);

      return this.createFill(order, fillPrice, fillSize, slippage, spreadPaid);
    } else {
      if (book.bids.length === 0) {
        return null;
      }
      const bestBid = book.bids[0];
      const fillPrice = bestBid.price;
      const fillSize = Decimal.min(order.size, bestBid.size);
      const midPrice = calculateMidPrice(book);
      const slippage = midPrice ? midPrice.minus(fillPrice) : new Decimal(0);
      const spreadPaid = midPrice ? midPrice.minus(fillPrice) : new Decimal(0);

      return this.createFill(order, fillPrice, fillSize, slippage, spreadPaid);
    }
  }

  private fillLimitOrder(
    order: OrderIntent,
    book: OrderBook,
    trade?: TradeRecord
  ): Fill | null {
    // Limit orders fill if:
    // 1. Crossing the spread (immediate fill)
    // 2. Price moved through limit (subsequent trade/price path)
    
    const midPrice = calculateMidPrice(book);
    if (!midPrice) {
      return null;
    }

    // Check if crossing spread
    if (order.side === 'buy' && book.asks.length > 0) {
      const bestAsk = book.asks[0];
      if (order.price.gte(bestAsk.price)) {
        // Crossing - fill immediately
        const fillPrice = bestAsk.price;
        const fillSize = Decimal.min(order.size, bestAsk.size);
        const slippage = fillPrice.minus(midPrice);
        const spreadPaid = fillPrice.minus(midPrice);
        return this.createFill(order, fillPrice, fillSize, slippage, spreadPaid);
      }
    } else if (order.side === 'sell' && book.bids.length > 0) {
      const bestBid = book.bids[0];
      if (order.price.lte(bestBid.price)) {
        // Crossing - fill immediately
        const fillPrice = bestBid.price;
        const fillSize = Decimal.min(order.size, bestBid.size);
        const slippage = midPrice.minus(fillPrice);
        const spreadPaid = midPrice.minus(fillPrice);
        return this.createFill(order, fillPrice, fillSize, slippage, spreadPaid);
      }
    }

    // Check if price moved through limit (passive fill)
    if (trade) {
      const wouldFill = order.side === 'buy'
        ? trade.price.lte(order.price)
        : trade.price.gte(order.price);

      if (wouldFill && Math.random() < this.config.fillProbability.toNumber()) {
        // Simple model: fill at limit price with some probability
        const fillPrice = order.price;
        const fillSize = order.size; // Full fill for simplicity
        const slippage = order.side === 'buy'
          ? fillPrice.minus(midPrice)
          : midPrice.minus(fillPrice);
        const spreadPaid = new Decimal(0); // Passive order, no spread paid
        return this.createFill(order, fillPrice, fillSize, slippage, spreadPaid);
      }
    }

    return null;
  }

  private createFill(
    order: OrderIntent,
    price: Decimal,
    size: Decimal,
    slippage: Decimal,
    spreadPaid: Decimal
  ): Fill {
    const fee = price.times(size).times(this.config.feeRate);
    
    return {
      id: randomUUID(),
      orderId: order.id,
      tokenId: order.tokenId,
      side: order.side,
      price,
      size,
      slippage: slippage.abs(),
      spreadPaid: spreadPaid.abs(),
      fee,
      timestamp: new Date(),
    };
  }

  markToMarket(tokenId: string, book: OrderBook): Map<string, Decimal> {
    const mtm: Map<string, Decimal> = new Map();
    const midPrice = calculateMidPrice(book);
    
    if (!midPrice) {
      return mtm;
    }

    for (const order of this.openOrders.values()) {
      if (order.tokenId !== tokenId) {
        continue;
      }

      // Unrealized PnL for open limit orders
      // Simplified: assume we'd fill at mid price
      const unrealizedPnl = order.side === 'buy'
        ? midPrice.minus(order.price).times(order.size)
        : order.price.minus(midPrice).times(order.size);

      mtm.set(order.id, unrealizedPnl);
    }

    return mtm;
  }

  getFills(): Fill[] {
    return [...this.fills];
  }

  getFillsForOrder(orderId: string): Fill[] {
    return this.fills.filter((f) => f.orderId === orderId);
  }

  clear(): void {
    this.openOrders.clear();
    this.fills = [];
  }
}

