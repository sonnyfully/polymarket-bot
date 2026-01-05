import { PolymarketRestClient, PolymarketWebSocketClient } from '@pm-bot/polymarket';
import { Repository, InMemoryOrderBook } from '@pm-bot/storage';
import type { Market, OrderBook } from '@pm-bot/core';
import { logger } from './logger.js';

export class MarketIngestion {
  private restClient: PolymarketRestClient;
  private wsClient: PolymarketWebSocketClient;
  private repository: Repository;
  private orderBooks: Map<string, InMemoryOrderBook> = new Map();
  private markets: Map<string, Market> = new Map();
  private lastPriceUpdate: Map<string, Date> = new Map();
  private wsDisconnectTime: Date | null = null;

  constructor(
    restClient: PolymarketRestClient,
    wsClient: PolymarketWebSocketClient,
    repository: Repository
  ) {
    this.restClient = restClient;
    this.wsClient = wsClient;
    this.repository = repository;

    this.setupWebSocketHandlers();
  }

  private setupWebSocketHandlers(): void {
    this.wsClient.onBookUpdate((tokenId: string, book: OrderBook) => {
      const inMemoryBook = this.orderBooks.get(tokenId);
      if (inMemoryBook) {
        inMemoryBook.applyDelta(book.bids, book.asks, book.sequence);
      } else {
        // New book, create in-memory version
        const newBook = new InMemoryOrderBook(book);
        this.orderBooks.set(tokenId, newBook);
      }
      this.lastPriceUpdate.set(tokenId, new Date());
    });

    this.wsClient.onTrade((trade) => {
      this.repository.saveTrade(trade).catch((err: unknown) => {
        logger.error({ err, trade }, 'Failed to save trade');
      });
    });

    this.wsClient.onError((error: Error) => {
      logger.error({ err: error }, 'WebSocket error');
    });
  }

  async syncMarkets(active?: boolean): Promise<void> {
    logger.info('Syncing markets from API');
    const markets = await this.restClient.getMarkets(active);
    
    for (const market of markets) {
      this.markets.set(market.id, market);
      await this.repository.upsertMarket(market);

      // Subscribe to websocket for each outcome
      for (const outcome of market.outcomes) {
        this.wsClient.subscribeMarket(outcome.tokenId);
      }
    }

    logger.info({ count: markets.length }, 'Markets synced');
  }

  async syncOrderBooks(tokenIds: string[]): Promise<void> {
    logger.info({ count: tokenIds.length }, 'Syncing order books');
    
    for (const tokenId of tokenIds) {
      try {
        const book = await this.restClient.getOrderBook(tokenId);
        const market = Array.from(this.markets.values()).find(
          (m) => m.outcomes.some((o) => o.tokenId === tokenId)
        );
        if (market) {
          book.marketId = market.id;
        }

        const inMemoryBook = new InMemoryOrderBook(book);
        this.orderBooks.set(tokenId, inMemoryBook);
        this.lastPriceUpdate.set(tokenId, new Date());

        await this.repository.saveOrderBookSnapshot(book);
      } catch (error) {
        logger.error({ err: error, tokenId }, 'Failed to sync order book');
      }
    }
  }

  async connectWebSocket(): Promise<void> {
    await this.wsClient.connect();
    this.wsDisconnectTime = null;
    logger.info('WebSocket connected');
  }

  getOrderBook(tokenId: string): OrderBook | null {
    const book = this.orderBooks.get(tokenId);
    return book ? book.getBook() : null;
  }

  getAllOrderBooks(): Map<string, OrderBook> {
    const result = new Map<string, OrderBook>();
    for (const [tokenId, book] of this.orderBooks.entries()) {
      result.set(tokenId, book.getBook());
    }
    return result;
  }

  getMarkets(): Map<string, Market> {
    return this.markets;
  }

  getLastPriceUpdate(tokenId: string): Date | null {
    return this.lastPriceUpdate.get(tokenId) || null;
  }

  isWebSocketConnected(): boolean {
    return this.wsClient.isConnected();
  }

  getWsDisconnectTime(): Date | null {
    return this.wsDisconnectTime;
  }
}

