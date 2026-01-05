import { getConfig } from '@pm-bot/config';
import { EndpointRateLimiter } from './rate-limiter.js';
import Decimal from 'decimal.js';

export interface ClobPriceResponse {
  token_id: string;
  price: string;
  timestamp: string;
}

export interface ClobBookLevel {
  price: string;
  size: string;
}

export interface ClobBookResponse {
  token_id: string;
  bids: ClobBookLevel[];
  asks: ClobBookLevel[];
  timestamp: string;
  sequence?: number;
}

export interface PriceLevel {
  price: Decimal;
  size: Decimal;
}

export interface OrderBook {
  tokenId: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
  timestamp: Date;
  sequence?: number;
}

export class ClobPublicClient {
  private baseUrl = 'https://clob.polymarket.com';
  private rateLimiter: EndpointRateLimiter;

  constructor() {
    this.rateLimiter = new EndpointRateLimiter();
    // CLOB API: 9000 requests per 10 seconds = 900 req/sec capacity, 900 refill/sec
    this.rateLimiter.getLimiter('clob', 900, 900);
  }

  private async request<T>(endpoint: string): Promise<T> {
    const limiter = this.rateLimiter.getLimiter('clob', 900, 900);
    await limiter.acquire();

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`CLOB API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async getPrice(tokenId: string): Promise<{ price: Decimal; timestamp: Date }> {
    const response = await this.request<ClobPriceResponse>(`/price?token_id=${tokenId}`);
    return {
      price: new Decimal(response.price),
      timestamp: new Date(response.timestamp),
    };
  }

  async getBook(tokenId: string, depth: number = 20): Promise<OrderBook> {
    const response = await this.request<ClobBookResponse>(
      `/book?token_id=${tokenId}&depth=${depth}`
    );

    return {
      tokenId: response.token_id,
      bids: response.bids.map((level) => ({
        price: new Decimal(level.price),
        size: new Decimal(level.size),
      })),
      asks: response.asks.map((level) => ({
        price: new Decimal(level.price),
        size: new Decimal(level.size),
      })),
      timestamp: new Date(response.timestamp),
      sequence: response.sequence,
    };
  }
}

