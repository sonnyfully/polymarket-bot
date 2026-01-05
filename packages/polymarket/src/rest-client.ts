import { getConfig } from '@pm-bot/config';
import type { Market, OrderBook, Trade, Order, Fill } from '@pm-bot/core';
import Decimal from 'decimal.js';
import { EndpointRateLimiter } from './rate-limiter.js';

export interface PolymarketMarketResponse {
  id: string;
  question: string;
  description?: string;
  conditionId: string;
  outcomes: Array<{
    token_id: string;
    outcome: string;
  }>;
  end_date_iso?: string;
  image?: string;
  active: boolean;
}

export interface PolymarketOrderBookResponse {
  bids: Array<[string, string]>; // [price, size]
  asks: Array<[string, string]>;
  sequence?: number;
}

export interface PolymarketTradeResponse {
  id: string;
  token_id: string;
  price: string;
  size: string;
  side: 'buy' | 'sell';
  timestamp: string;
  taker?: string;
  maker?: string;
}

export interface PolymarketOrderResponse {
  order_id: string;
  token_id: string;
  side: 'buy' | 'sell';
  price: string;
  size: string;
  filled: string;
  status: string;
  created_at: string;
  updated_at: string;
  client_order_id?: string;
}

export class PolymarketRestClient {
  private baseUrl: string;
  private apiKey?: string;
  private rateLimiter: EndpointRateLimiter;

  constructor() {
    const config = getConfig();
    this.baseUrl = config.POLYMARKET_API_URL;
    this.apiKey = config.POLYMARKET_API_KEY;
    this.rateLimiter = new EndpointRateLimiter();

    // Configure rate limits per endpoint class
    // Market data: 100 req/min
    this.rateLimiter.getLimiter('markets', 100, 100 / 60);
    // Order book: 60 req/min
    this.rateLimiter.getLimiter('orderbook', 60, 60 / 60);
    // Trades: 60 req/min
    this.rateLimiter.getLimiter('trades', 60, 60 / 60);
    // Orders: 30 req/min
    this.rateLimiter.getLimiter('orders', 30, 30 / 60);
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const limiter = this.rateLimiter.getLimiter(endpoint.split('/')[1] || 'default', 10, 10 / 60);
    await limiter.acquire();

    const url = `${this.baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async getMarkets(active?: boolean): Promise<Market[]> {
    const params = active !== undefined ? `?active=${active}` : '';
    const response = await this.request<PolymarketMarketResponse[]>(
      `/markets${params}`
    );

    return response.map((m) => ({
      id: m.id,
      question: m.question,
      description: m.description,
      conditionId: m.conditionId,
      outcomes: m.outcomes.map((o) => ({
        tokenId: o.token_id,
        outcome: o.outcome,
        marketId: m.id,
        decimals: 18, // Default, should be fetched from token contract
      })),
      endDate: m.end_date_iso ? new Date(m.end_date_iso) : undefined,
      imageUrl: m.image,
      active: m.active,
    }));
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    const response = await this.request<PolymarketOrderBookResponse>(
      `/book?token_id=${tokenId}`
    );

    return {
      marketId: '', // Will be filled by caller
      tokenId,
      bids: response.bids.map(([price, size]) => ({
        price: new Decimal(price),
        size: new Decimal(size),
      })),
      asks: response.asks.map(([price, size]) => ({
        price: new Decimal(price),
        size: new Decimal(size),
      })),
      lastUpdate: new Date(),
      sequence: response.sequence,
    };
  }

  async getRecentTrades(tokenId: string, limit: number = 100): Promise<Trade[]> {
    const response = await this.request<PolymarketTradeResponse[]>(
      `/trades?token_id=${tokenId}&limit=${limit}`
    );

    return response.map((t) => ({
      id: t.id,
      marketId: '', // Will be filled by caller
      tokenId: t.token_id,
      price: new Decimal(t.price),
      size: new Decimal(t.size),
      side: t.side,
      timestamp: new Date(t.timestamp),
      taker: t.taker,
      maker: t.maker,
    }));
  }

  async placeOrder(
    tokenId: string,
    side: 'buy' | 'sell',
    price: Decimal,
    size: Decimal,
    clientOrderId?: string
  ): Promise<Order> {
    // In production, this would use @polymarket/clob-client for signing
    // For now, we'll structure the request
    const body = {
      token_id: tokenId,
      side,
      price: price.toString(),
      size: size.toString(),
      client_order_id: clientOrderId,
    };

    const response = await this.request<PolymarketOrderResponse>(
      '/orders',
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );

    return {
      id: response.order_id,
      marketId: '', // Will be filled by caller
      tokenId: response.token_id,
      side: response.side,
      type: 'limit',
      price: new Decimal(response.price),
      size: new Decimal(response.size),
      filledSize: new Decimal(response.filled),
      status: this.mapOrderStatus(response.status),
      createdAt: new Date(response.created_at),
      updatedAt: new Date(response.updated_at),
      clientOrderId: response.client_order_id,
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request(`/orders/${orderId}`, {
      method: 'DELETE',
    });
  }

  async getOpenOrders(): Promise<Order[]> {
    const response = await this.request<PolymarketOrderResponse[]>('/orders');
    return response.map((o) => this.mapOrderResponse(o));
  }

  async getFills(limit: number = 100): Promise<Fill[]> {
    const response = await this.request<Array<{
      id: string;
      order_id: string;
      token_id: string;
      side: 'buy' | 'sell';
      price: string;
      size: string;
      fee: string;
      timestamp: string;
    }>>(`/fills?limit=${limit}`);

    return response.map((f) => ({
      id: f.id,
      orderId: f.order_id,
      marketId: '', // Will be filled by caller
      tokenId: f.token_id,
      side: f.side,
      price: new Decimal(f.price),
      size: new Decimal(f.size),
      fee: new Decimal(f.fee),
      timestamp: new Date(f.timestamp),
    }));
  }

  private mapOrderStatus(status: string): Order['status'] {
    const statusMap: Record<string, Order['status']> = {
      pending: 'pending',
      open: 'open',
      filled: 'filled',
      partially_filled: 'partially_filled',
      cancelled: 'cancelled',
      rejected: 'rejected',
    };
    return statusMap[status] || 'pending';
  }

  private mapOrderResponse(o: PolymarketOrderResponse): Order {
    return {
      id: o.order_id,
      marketId: '',
      tokenId: o.token_id,
      side: o.side,
      type: 'limit',
      price: new Decimal(o.price),
      size: new Decimal(o.size),
      filledSize: new Decimal(o.filled),
      status: this.mapOrderStatus(o.status),
      createdAt: new Date(o.created_at),
      updatedAt: new Date(o.updated_at),
      clientOrderId: o.client_order_id,
    };
  }
}

