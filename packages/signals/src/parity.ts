import { getConfig } from '@pm-bot/config';
import type { Strategy, Signal, StrategyContext } from './strategy-harness.js';
import type { MarketMapping } from './arbitrage.js';
import Decimal from 'decimal.js';

export class ParityStrategy implements Strategy {
  name = 'parity';
  private mappings: MarketMapping[] = [];
  private minEdge: Decimal;

  constructor(mappings: MarketMapping[]) {
    const config = getConfig();
    this.mappings = mappings;
    this.minEdge = new Decimal(0.01); // 1% minimum edge
  }

  async onStart(_context: StrategyContext): Promise<void> {
    // Validate mappings
  }

  async onTick(context: StrategyContext): Promise<Signal[]> {
    const signals: Signal[] = [];
    const stateStore = context.stateStore;

    for (const mapping of this.mappings) {
      if (mapping.type !== 'parity') {
        continue;
      }

      const prices: Decimal[] = [];
      const tokenIds: string[] = [];

      // Collect prices for all outcomes
      for (const marketRef of mapping.markets) {
        const features = stateStore.getDerivedFeatures(marketRef.tokenId);
        if (!features.midPrice) continue;

        prices.push(features.midPrice);
        tokenIds.push(marketRef.tokenId);
      }

      if (prices.length < 2) continue;

      // Check if sum equals 1 (for complementary outcomes)
      const sum = prices.reduce((s, p) => s.plus(p), new Decimal(0));
      const deviation = sum.minus(1).abs();

      if (deviation.gt(this.minEdge)) {
        // Parity violation detected
        // Find the outcome that's most overpriced/underpriced
        const avgPrice = sum.div(prices.length);
        
        for (let i = 0; i < prices.length; i++) {
          const price = prices[i];
          const tokenId = tokenIds[i];
          const diff = price.minus(avgPrice);
          const book = stateStore.getOrderBook(tokenId);
          
          if (!book) continue;

          // If price is above average, sell; if below, buy
          if (diff.gt(this.minEdge) && book.asks.length > 0) {
            signals.push({
              tokenId,
              side: 'sell',
              price: book.asks[0].price,
              size: book.asks[0].size,
              reason: `Parity violation: overpriced by ${diff.toString()}`,
              expectedEdge: diff,
              confidence: Decimal.min(1, diff.div(this.minEdge.times(2))),
            });
          } else if (diff.lt(this.minEdge.neg()) && book.bids.length > 0) {
            signals.push({
              tokenId,
              side: 'buy',
              price: book.bids[0].price,
              size: book.bids[0].size,
              reason: `Parity violation: underpriced by ${diff.abs().toString()}`,
              expectedEdge: diff.abs(),
              confidence: Decimal.min(1, diff.abs().div(this.minEdge.times(2))),
            });
          }
        }
      }
    }

    return signals;
  }

  async onFill(_fill: unknown, _context: StrategyContext): Promise<void> {
    // No special handling
  }

  async onStop(): Promise<void> {
    // Cleanup
  }
}

