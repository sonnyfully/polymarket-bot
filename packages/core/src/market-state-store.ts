import type { GammaMarket, MarketUniverse } from '@pm-bot/polymarket';
import type { OrderBook, PriceLevel } from '@pm-bot/polymarket';
import { EMA, calculateVolatility } from './math.js';
import { calculateMidPrice, calculateSpread, calculateDepthAtPrice } from './types.js';
import Decimal from 'decimal.js';

export interface TradeRecord {
  tokenId: string;
  price: Decimal;
  size: Decimal;
  side: 'buy' | 'sell';
  timestamp: Date;
}

export interface DerivedFeatures {
  midPrice: Decimal | null;
  spread: Decimal | null;
  spreadBps: Decimal | null;
  bidDepth: Decimal;
  askDepth: Decimal;
  ema: Decimal | null;
  ewmaVol: Decimal | null;
  lastUpdate: Date;
}

export class OrderBookStore {
  private books: Map<string, OrderBook> = new Map();
  private topN: number;

  constructor(topN: number = 20) {
    this.topN = topN;
  }

  update(tokenId: string, book: OrderBook): void {
    // Keep only top N levels
    const trimmedBook: OrderBook = {
      ...book,
      bids: book.bids.slice(0, this.topN),
      asks: book.asks.slice(0, this.topN),
    };
    this.books.set(tokenId, trimmedBook);
  }

  get(tokenId: string): OrderBook | null {
    return this.books.get(tokenId) || null;
  }

  getAll(): Map<string, OrderBook> {
    return new Map(this.books);
  }

  clear(): void {
    this.books.clear();
  }
}

export class TradeTapeStore {
  private trades: Map<string, TradeRecord[]> = new Map();
  private maxTradesPerToken: number;

  constructor(maxTradesPerToken: number = 1000) {
    this.maxTradesPerToken = maxTradesPerToken;
  }

  add(trade: TradeRecord): void {
    const tokenTrades = this.trades.get(trade.tokenId) || [];
    tokenTrades.push(trade);
    
    // Keep only recent trades
    if (tokenTrades.length > this.maxTradesPerToken) {
      tokenTrades.shift();
    }
    
    this.trades.set(trade.tokenId, tokenTrades);
  }

  get(tokenId: string, limit: number = 100): TradeRecord[] {
    const tokenTrades = this.trades.get(tokenId) || [];
    return tokenTrades.slice(-limit);
  }

  getAll(): Map<string, TradeRecord[]> {
    return new Map(this.trades);
  }

  clear(): void {
    this.trades.clear();
  }
}

export class MarketStateStore {
  private universe: MarketUniverse | null = null;
  private orderBookStore: OrderBookStore;
  private tradeTapeStore: TradeTapeStore;
  private emas: Map<string, EMA> = new Map();
  private priceHistory: Map<string, Decimal[]> = new Map();
  private emaPeriod: number = 20;
  private volWindow: number = 20;

  constructor() {
    this.orderBookStore = new OrderBookStore(20);
    this.tradeTapeStore = new TradeTapeStore(1000);
  }

  setUniverse(universe: MarketUniverse): void {
    this.universe = universe;
  }

  getUniverse(): MarketUniverse | null {
    return this.universe;
  }

  updateOrderBook(tokenId: string, book: OrderBook): void {
    this.orderBookStore.update(tokenId, book);
  }

  getOrderBook(tokenId: string): OrderBook | null {
    return this.orderBookStore.get(tokenId);
  }

  addTrade(trade: TradeRecord): void {
    this.tradeTapeStore.add(trade);
    
    // Update price history for EMA/volatility
    if (!this.priceHistory.has(trade.tokenId)) {
      this.priceHistory.set(trade.tokenId, []);
    }
    const history = this.priceHistory.get(trade.tokenId)!;
    history.push(trade.price);
    if (history.length > this.volWindow * 2) {
      history.shift();
    }
  }

  getTrades(tokenId: string, limit: number = 100): TradeRecord[] {
    return this.tradeTapeStore.get(tokenId, limit);
  }

  getDerivedFeatures(tokenId: string): DerivedFeatures {
    const book = this.getOrderBook(tokenId);
    const trades = this.getTrades(tokenId, this.volWindow);

    if (!book) {
      return {
        midPrice: null,
        spread: null,
        spreadBps: null,
        bidDepth: new Decimal(0),
        askDepth: new Decimal(0),
        ema: null,
        ewmaVol: null,
        lastUpdate: new Date(),
      };
    }

    const midPrice = calculateMidPrice(book);
    const spread = calculateSpread(book);
    const spreadBps = midPrice && spread ? spread.div(midPrice).times(10000) : null;

    // Calculate depth
    const bidDepth = book.bids.reduce((sum, level) => sum.plus(level.size), new Decimal(0));
    const askDepth = book.asks.reduce((sum, level) => sum.plus(level.size), new Decimal(0));

    // Calculate EMA
    let ema: Decimal | null = null;
    if (trades.length > 0) {
      const latestPrice = trades[trades.length - 1].price;
      if (!this.emas.has(tokenId)) {
        this.emas.set(tokenId, new EMA(this.emaPeriod));
      }
      const emaInstance = this.emas.get(tokenId)!;
      ema = emaInstance.update(latestPrice);
    }

    // Calculate EWMA volatility
    let ewmaVol: Decimal | null = null;
    const history = this.priceHistory.get(tokenId);
    if (history && history.length >= 2) {
      ewmaVol = calculateVolatility(history, this.volWindow);
    }

    return {
      midPrice,
      spread,
      spreadBps,
      bidDepth,
      askDepth,
      ema,
      ewmaVol,
      lastUpdate: book.timestamp,
    };
  }

  getMarketForToken(tokenId: string): GammaMarket | null {
    if (!this.universe) {
      return null;
    }
    const marketId = this.universe.tokenIdToMarket.get(tokenId);
    if (!marketId) {
      return null;
    }
    return this.universe.markets.get(marketId) || null;
  }

  getAllTokenIds(): string[] {
    if (!this.universe) {
      return [];
    }
    return Array.from(this.universe.tokenIdToMarket.keys());
  }
}

