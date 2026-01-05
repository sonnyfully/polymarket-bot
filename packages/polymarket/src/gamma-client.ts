import { getConfig } from '@pm-bot/config';
import { EndpointRateLimiter } from './rate-limiter.js';
import Decimal from 'decimal.js';

export interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  description?: string;
  image?: string;
  startDate?: string;
  endDate?: string;
  active: boolean;
}

export interface GammaMarket {
  id: string;
  question: string;
  description?: string;
  conditionId: string;
  slug: string;
  image?: string;
  endDate?: string;
  active: boolean;
  outcomes: Array<{
    id: string;
    outcome: string;
    price: string;
    clobTokenId: string; // This is the key field for CLOB API
  }>;
}

export interface MarketUniverse {
  events: Map<string, GammaEvent>;
  markets: Map<string, GammaMarket>;
  tokenIdToMarket: Map<string, string>; // clobTokenId -> marketId
}

export class GammaClient {
  private baseUrl = 'https://gamma-api.polymarket.com';
  private rateLimiter: EndpointRateLimiter;

  constructor() {
    this.rateLimiter = new EndpointRateLimiter();
    // Gamma API: 4000 requests per 10 seconds = 400 req/sec capacity, 400 refill/sec
    this.rateLimiter.getLimiter('gamma', 400, 400);
  }

  private async request<T>(endpoint: string): Promise<T> {
    const limiter = this.rateLimiter.getLimiter('gamma', 400, 400);
    await limiter.acquire();

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gamma API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async getEvents(active?: boolean): Promise<GammaEvent[]> {
    const params = active !== undefined ? `?active=${active}` : '';
    return this.request<GammaEvent[]>(`/events${params}`);
  }

  async getMarkets(eventId?: string, active?: boolean): Promise<GammaMarket[]> {
    let params = '';
    if (eventId) params += `?event=${eventId}`;
    if (active !== undefined) {
      params += params ? `&active=${active}` : `?active=${active}`;
    }
    return this.request<GammaMarket[]>(`/markets${params}`);
  }

  async buildMarketUniverse(activeOnly: boolean = true): Promise<MarketUniverse> {
    const events = await this.getEvents(activeOnly);
    const allMarkets: GammaMarket[] = [];

    // Fetch markets for each event
    for (const event of events) {
      const markets = await this.getMarkets(event.id, activeOnly);
      allMarkets.push(...markets);
    }

    // Also fetch markets without event filter
    const standaloneMarkets = await this.getMarkets(undefined, activeOnly);
    allMarkets.push(...standaloneMarkets);

    // Build maps
    const eventMap = new Map<string, GammaEvent>();
    for (const event of events) {
      eventMap.set(event.id, event);
    }

    const marketMap = new Map<string, GammaMarket>();
    const tokenIdToMarket = new Map<string, string>();

    for (const market of allMarkets) {
      marketMap.set(market.id, market);
      
      // Map each outcome's clobTokenId to the market
      for (const outcome of market.outcomes) {
        tokenIdToMarket.set(outcome.clobTokenId, market.id);
      }
    }

    return {
      events: eventMap,
      markets: marketMap,
      tokenIdToMarket,
    };
  }
}

