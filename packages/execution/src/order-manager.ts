import type { Order, Fill, OrderBook } from '@pm-bot/core';
import { PolymarketRestClient } from '@pm-bot/polymarket';
import { Repository } from '@pm-bot/storage';
import { estimateSlippage } from '@pm-bot/core';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';

export interface OrderRequest {
  tokenId: string;
  marketId: string;
  side: 'buy' | 'sell';
  price: Decimal;
  size: Decimal;
  reason?: string;
  clientOrderId?: string;
}

export interface ExecutionResult {
  order: Order | null;
  error?: string;
}

export class OrderManager {
  private restClient: PolymarketRestClient;
  private repository: Repository;
  private openOrders: Map<string, Order> = new Map();
  private isPaperTrading: boolean;

  constructor(
    restClient: PolymarketRestClient,
    repository: Repository,
    isPaperTrading: boolean
  ) {
    this.restClient = restClient;
    this.repository = repository;
    this.isPaperTrading = isPaperTrading;
  }

  async placeOrder(
    request: OrderRequest,
    book: OrderBook | null
  ): Promise<ExecutionResult> {
    // Check for stale book
    if (book) {
      const bookAge = Date.now() - book.lastUpdate.getTime();
      if (bookAge > 60000) {
        return {
          order: null,
          error: 'Order book is stale',
        };
      }

      // Check for crossing market
      if (request.side === 'buy' && book.asks.length > 0) {
        if (request.price.gte(book.asks[0].price)) {
          return {
            order: null,
            error: 'Order would cross market',
          };
        }
      } else if (request.side === 'sell' && book.bids.length > 0) {
        if (request.price.lte(book.bids[0].price)) {
          return {
            order: null,
            error: 'Order would cross market',
          };
        }
      }

      // Estimate slippage
      const slippageEst = estimateSlippage(book, request.side, request.size);
      if (slippageEst) {
        const config = await import('@pm-bot/config').then((m) => m.getConfig());
        const maxSlippageBps = new Decimal(config.MAX_SLIPPAGE_BPS).div(10000);
        const midPrice = book.bids.length > 0 && book.asks.length > 0
          ? book.bids[0].price.plus(book.asks[0].price).div(2)
          : request.price;

        if (slippageEst.slippage.div(midPrice).gt(maxSlippageBps)) {
          return {
            order: null,
            error: `Estimated slippage ${slippageEst.slippage.toString()} exceeds limit`,
          };
        }
      }
    }

    const clientOrderId = request.clientOrderId || randomUUID();

    if (this.isPaperTrading) {
      // Simulate order placement
      const order: Order = {
        id: `paper-${clientOrderId}`,
        marketId: request.marketId,
        tokenId: request.tokenId,
        side: request.side,
        type: 'limit',
        price: request.price,
        size: request.size,
        filledSize: new Decimal(0),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
        clientOrderId,
        reason: request.reason,
      };

      this.openOrders.set(order.id, order);
      await this.repository.saveOrder(order);

      return { order };
    } else {
      // Real order placement
      try {
        const order = await this.restClient.placeOrder(
          request.tokenId,
          request.side,
          request.price,
          request.size,
          clientOrderId
        );

        order.marketId = request.marketId;
        order.reason = request.reason;

        this.openOrders.set(order.id, order);
        await this.repository.saveOrder(order);

        return { order };
      } catch (error) {
        return {
          order: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = this.openOrders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (this.isPaperTrading) {
      order.status = 'cancelled';
      order.updatedAt = new Date();
      await this.repository.saveOrder(order);
      this.openOrders.delete(orderId);
    } else {
      await this.restClient.cancelOrder(orderId);
      order.status = 'cancelled';
      order.updatedAt = new Date();
      await this.repository.saveOrder(order);
      this.openOrders.delete(orderId);
    }
  }

  async updateOrder(order: Order): Promise<void> {
    this.openOrders.set(order.id, order);
    await this.repository.saveOrder(order);
  }

  async recordFill(fill: Fill): Promise<void> {
    await this.repository.saveFill(fill);

    const order = this.openOrders.get(fill.orderId);
    if (order) {
      order.filledSize = order.filledSize.plus(fill.size);
      if (order.filledSize.gte(order.size)) {
        order.status = 'filled';
      } else {
        order.status = 'partially_filled';
      }
      order.updatedAt = new Date();
      await this.updateOrder(order);
    }
  }

  getOpenOrders(): Order[] {
    return Array.from(this.openOrders.values());
  }

  async syncOpenOrders(): Promise<void> {
    if (this.isPaperTrading) {
      // In paper trading, just load from DB
      const orders = await this.repository.getOpenOrders();
      this.openOrders.clear();
      for (const order of orders) {
        this.openOrders.set(order.id, order);
      }
    } else {
      // Sync from API
      const apiOrders = await this.restClient.getOpenOrders();
      this.openOrders.clear();
      for (const order of apiOrders) {
        this.openOrders.set(order.id, order);
        await this.repository.saveOrder(order);
      }
    }
  }
}

