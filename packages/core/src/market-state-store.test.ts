import { describe, it, expect, beforeEach } from 'vitest';
import { MarketStateStore, OrderBookStore } from './market-state-store.js';
import type { OrderBook } from '@pm-bot/polymarket';
import Decimal from 'decimal.js';

describe('OrderBookStore', () => {
  let store: OrderBookStore;

  beforeEach(() => {
    store = new OrderBookStore(5); // Top 5 levels
  });

  it('should store and retrieve order books', () => {
    const book: OrderBook = {
      tokenId: 'token-1',
      bids: [
        { price: new Decimal('0.5'), size: new Decimal('100') },
        { price: new Decimal('0.49'), size: new Decimal('200') },
      ],
      asks: [
        { price: new Decimal('0.51'), size: new Decimal('150') },
        { price: new Decimal('0.52'), size: new Decimal('250') },
      ],
      timestamp: new Date(),
    };

    store.update('token-1', book);
    const retrieved = store.get('token-1');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.tokenId).toBe('token-1');
    expect(retrieved?.bids.length).toBe(2);
  });

  it('should trim to top N levels', () => {
    const book: OrderBook = {
      tokenId: 'token-1',
      bids: Array.from({ length: 10 }, (_, i) => ({
        price: new Decimal(0.5 - i * 0.01),
        size: new Decimal(100),
      })),
      asks: [],
      timestamp: new Date(),
    };

    store.update('token-1', book);
    const retrieved = store.get('token-1');

    expect(retrieved?.bids.length).toBe(5); // Top 5 only
  });
});

describe('MarketStateStore', () => {
  let store: MarketStateStore;

  beforeEach(() => {
    store = new MarketStateStore();
  });

  it('should calculate derived features', () => {
    const book: OrderBook = {
      tokenId: 'token-1',
      bids: [{ price: new Decimal('0.49'), size: new Decimal('100') }],
      asks: [{ price: new Decimal('0.51'), size: new Decimal('100') }],
      timestamp: new Date(),
    };

    store.updateOrderBook('token-1', book);

    // Add some trades for EMA calculation
    for (let i = 0; i < 25; i++) {
      store.addTrade({
        tokenId: 'token-1',
        price: new Decimal('0.5'),
        size: new Decimal('10'),
        side: 'buy',
        timestamp: new Date(),
      });
    }

    const features = store.getDerivedFeatures('token-1');

    expect(features.midPrice).not.toBeNull();
    expect(features.spread).not.toBeNull();
    expect(features.bidDepth.toNumber()).toBe(100);
    expect(features.askDepth.toNumber()).toBe(100);
  });
});

