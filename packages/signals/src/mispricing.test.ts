import { describe, it, expect, beforeEach } from 'vitest';
import { MispricingStrategy } from './mispricing.js';
import { MarketStateStore } from '@pm-bot/core';
import type { MarketUniverse } from '@pm-bot/polymarket';
import Decimal from 'decimal.js';

describe('MispricingStrategy', () => {
  let strategy: MispricingStrategy;
  let stateStore: MarketStateStore;
  let universe: MarketUniverse;

  beforeEach(() => {
    strategy = new MispricingStrategy();
    stateStore = new MarketStateStore();

    // Create mock universe
    universe = {
      events: new Map(),
      markets: new Map(),
      tokenIdToMarket: new Map(),
    };

    // Add a market
    universe.markets.set('market-1', {
      id: 'market-1',
      question: 'Test Market',
      conditionId: 'condition-1',
      slug: 'test-market',
      active: true,
      outcomes: [
        {
          id: 'outcome-1',
          outcome: 'Yes',
          price: '0.5',
          clobTokenId: 'token-1',
        },
      ],
    });

    universe.tokenIdToMarket.set('token-1', 'market-1');
    stateStore.setUniverse(universe);
  });

  it('should generate buy signal when underpriced', async () => {
    // Set up order book with low price
    stateStore.updateOrderBook('token-1', {
      tokenId: 'token-1',
      bids: [{ price: new Decimal('0.40'), size: new Decimal('100') }],
      asks: [{ price: new Decimal('0.42'), size: new Decimal('100') }],
      timestamp: new Date(),
    });

    // Add trades to build EMA
    for (let i = 0; i < 25; i++) {
      stateStore.addTrade({
        tokenId: 'token-1',
        price: new Decimal('0.50'), // Fair value
        size: new Decimal('10'),
        side: 'buy',
        timestamp: new Date(),
      });
    }

    const context = {
      stateStore,
      timestamp: new Date(),
    };

    const signals = await strategy.onTick(context);

    // Should generate buy signal (market is underpriced at 0.41 vs fair 0.50)
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].side).toBe('buy');
  });

  it('should not generate signal when price is fair', async () => {
    // Set up order book with fair price
    stateStore.updateOrderBook('token-1', {
      tokenId: 'token-1',
      bids: [{ price: new Decimal('0.49'), size: new Decimal('100') }],
      asks: [{ price: new Decimal('0.51'), size: new Decimal('100') }],
      timestamp: new Date(),
    });

    // Add trades to build EMA at 0.50
    for (let i = 0; i < 25; i++) {
      stateStore.addTrade({
        tokenId: 'token-1',
        price: new Decimal('0.50'),
        size: new Decimal('10'),
        side: 'buy',
        timestamp: new Date(),
      });
    }

    const context = {
      stateStore,
      timestamp: new Date(),
    };

    const signals = await strategy.onTick(context);

    // Should not generate signal (price is fair)
    expect(signals.length).toBe(0);
  });
});

