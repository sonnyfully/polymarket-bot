import { getConfig } from '@pm-bot/config';
import type { Strategy, Signal, StrategyContext } from './strategy-harness.js';
import type { DerivedFeatures } from '@pm-bot/core';
import type { GammaMarket } from '@pm-bot/polymarket';
import Decimal from 'decimal.js';

export interface FairValueSource {
  getFairValue(tokenId: string, market: GammaMarket): Promise<Decimal | null>;
}

export interface FairValueSource {
  getFairValue(tokenId: string, market: Market): Promise<Decimal | null>;
}

export class MispricingStrategy implements Strategy {
  name = 'mispricing';
  private fairValueSource: FairValueSource | null = null;
  private threshold: Decimal;
  private minBookDepth: Decimal;

  constructor(fairValueSource?: FairValueSource) {
    const config = getConfig();
    this.threshold = new Decimal(config.MISPRICING_THRESHOLD);
    this.minBookDepth = new Decimal(config.MIN_BOOK_DEPTH);
    this.fairValueSource = fairValueSource || null;
  }

  async onStart(_context: StrategyContext): Promise<void> {
    // Initialize if needed
  }

  async onTick(context: StrategyContext): Promise<Signal[]> {
    const signals: Signal[] = [];
    const stateStore = context.stateStore;
    const tokenIds = stateStore.getAllTokenIds();

    for (const tokenId of tokenIds) {
      const features = stateStore.getDerivedFeatures(tokenId);
      if (!features.midPrice || !features.ema) {
        continue;
      }

      // Calculate fair value
      let fairValue: Decimal | null = features.ema;

      const market = stateStore.getMarketForToken(tokenId);
      if (market && this.fairValueSource) {
        const externalFairValue = await this.fairValueSource.getFairValue(tokenId, market);
        if (externalFairValue) {
          fairValue = externalFairValue;
        }
      }

      if (!fairValue) {
        continue;
      }

      // Check mispricing
      const mispricing = features.midPrice.minus(fairValue).abs();
      const isOverpriced = features.midPrice.gt(fairValue);
      const isUnderpriced = features.midPrice.lt(fairValue);

      // Check book depth
      if (features.bidDepth.lt(this.minBookDepth) && features.askDepth.lt(this.minBookDepth)) {
        continue;
      }

      if (mispricing.gte(this.threshold)) {
        const book = stateStore.getOrderBook(tokenId);
        if (!book) continue;

        let signal: Signal | null = null;

        if (isOverpriced && features.askDepth.gte(this.minBookDepth) && book.asks.length > 0) {
          signal = {
            tokenId,
            side: 'sell',
            price: book.asks[0].price,
            size: Decimal.min(book.asks[0].size, this.minBookDepth),
            reason: `Mispricing: overpriced by ${mispricing.toString()}`,
            expectedEdge: mispricing,
            confidence: Decimal.min(1, mispricing.div(this.threshold.times(2))),
          };
        } else if (isUnderpriced && features.bidDepth.gte(this.minBookDepth) && book.bids.length > 0) {
          signal = {
            tokenId,
            side: 'buy',
            price: book.bids[0].price,
            size: Decimal.min(book.bids[0].size, this.minBookDepth),
            reason: `Mispricing: underpriced by ${mispricing.toString()}`,
            expectedEdge: mispricing,
            confidence: Decimal.min(1, mispricing.div(this.threshold.times(2))),
          };
        }

        if (signal) {
          signals.push(signal);
        }
      }
    }

    return signals;
  }

  async onFill(_fill: unknown, _context: StrategyContext): Promise<void> {
    // No special handling needed
  }

  async onStop(): Promise<void> {
    // Cleanup
  }
}

