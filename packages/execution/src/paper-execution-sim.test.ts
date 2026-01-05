import { describe, it, expect, beforeEach } from 'vitest';
import { PaperExecutionSim } from './paper-execution-sim.js';
import type { OrderBook } from '@pm-bot/polymarket';
import Decimal from 'decimal.js';

describe('PaperExecutionSim', () => {
  let sim: PaperExecutionSim;
  let book: OrderBook;

  beforeEach(() => {
    sim = new PaperExecutionSim({
      feeRate: new Decimal(0.02), // 2%
      fillProbability: new Decimal(0.5), // 50% fill probability
    });

    book = {
      tokenId: 'token-1',
      bids: [
        { price: new Decimal('0.49'), size: new Decimal('100') },
        { price: new Decimal('0.48'), size: new Decimal('200') },
      ],
      asks: [
        { price: new Decimal('0.51'), size: new Decimal('150') },
        { price: new Decimal('0.52'), size: new Decimal('250') },
      ],
      timestamp: new Date(),
    };
  });

  it('should fill market buy orders immediately at best ask', () => {
    const order = sim.placeOrder({
      id: 'order-1',
      tokenId: 'token-1',
      side: 'buy',
      price: new Decimal('0.5'),
      size: new Decimal('50'),
      type: 'market',
      timestamp: new Date(),
    });

    const fills = sim.processMarketUpdate('token-1', book);

    expect(fills.length).toBe(1);
    expect(fills[0].price.toNumber()).toBe(0.51); // Best ask
    expect(fills[0].size.toNumber()).toBe(50);
    expect(fills[0].side).toBe('buy');
  });

  it('should fill market sell orders immediately at best bid', () => {
    const order = sim.placeOrder({
      id: 'order-1',
      tokenId: 'token-1',
      side: 'sell',
      price: new Decimal('0.5'),
      size: new Decimal('50'),
      type: 'market',
      timestamp: new Date(),
    });

    const fills = sim.processMarketUpdate('token-1', book);

    expect(fills.length).toBe(1);
    expect(fills[0].price.toNumber()).toBe(0.49); // Best bid
    expect(fills[0].side).toBe('sell');
  });

  it('should fill limit orders crossing the spread', () => {
    // Buy order above best ask (crossing)
    const order = sim.placeOrder({
      id: 'order-1',
      tokenId: 'token-1',
      side: 'buy',
      price: new Decimal('0.52'), // Above best ask of 0.51
      size: new Decimal('50'),
      type: 'limit',
      timestamp: new Date(),
    });

    const fills = sim.processMarketUpdate('token-1', book);

    expect(fills.length).toBe(1);
    expect(fills[0].price.toNumber()).toBe(0.51); // Fills at best ask
  });

  it('should calculate slippage correctly', () => {
    const order = sim.placeOrder({
      id: 'order-1',
      tokenId: 'token-1',
      side: 'buy',
      price: new Decimal('0.5'),
      size: new Decimal('50'),
      type: 'market',
      timestamp: new Date(),
    });

    const fills = sim.processMarketUpdate('token-1', book);

    expect(fills.length).toBe(1);
    // Slippage = fill price - mid price = 0.51 - 0.50 = 0.01
    expect(fills[0].slippage.toNumber()).toBeGreaterThan(0);
  });

  it('should calculate fees correctly', () => {
    const order = sim.placeOrder({
      id: 'order-1',
      tokenId: 'token-1',
      side: 'buy',
      price: new Decimal('0.5'),
      size: new Decimal('100'),
      type: 'market',
      timestamp: new Date(),
    });

    const fills = sim.processMarketUpdate('token-1', book);

    expect(fills.length).toBe(1);
    // Fee = price * size * feeRate = 0.51 * 100 * 0.02 = 1.02
    const expectedFee = new Decimal('0.51').times(100).times(0.02);
    expect(fills[0].fee.toNumber()).toBeCloseTo(expectedFee.toNumber(), 2);
  });
});

