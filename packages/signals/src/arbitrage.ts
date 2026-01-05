import { getConfig } from '@pm-bot/config';
import type { Strategy, Signal, StrategyContext } from './strategy-harness.js';
import type { DerivedFeatures } from '@pm-bot/core';
import Decimal from 'decimal.js';
import fs from 'fs/promises';
import path from 'path';

export interface MarketMapping {
  markets: Array<{
    marketId: string;
    tokenId: string;
    weight: number; // For weighted averages
  }>;
  type: 'equivalent' | 'complement' | 'parity';
}

export interface ArbitrageConfig {
  mappings: MarketMapping[];
  minEdge: Decimal;
  maxSlippage: Decimal;
  feeRate: Decimal;
}

export class ArbitrageStrategy implements Strategy {
  name = 'arbitrage';
  private config: ArbitrageConfig;
  private mappings: MarketMapping[] = [];

  constructor(configPath?: string) {
    const envConfig = getConfig();
    this.config = {
      mappings: [],
      minEdge: new Decimal(0.01), // 1% minimum edge
      maxSlippage: new Decimal(envConfig.MAX_SLIPPAGE_BPS).div(10000),
      feeRate: new Decimal(0.02), // 2% fee assumption
    };
    this.loadMappings(configPath);
  }

  private async loadMappings(configPath?: string): Promise<void> {
    if (!configPath) {
      configPath = path.join(process.cwd(), 'config', 'market-mappings.json');
    }

    try {
      const data = await fs.readFile(configPath, 'utf-8');
      const parsed = JSON.parse(data) as { mappings: MarketMapping[] };
      this.mappings = parsed.mappings;
    } catch (error) {
      // Config file doesn't exist, use empty mappings
      console.warn(`Arbitrage config not found at ${configPath}, using empty mappings`);
    }
  }

  async onStart(_context: StrategyContext): Promise<void> {
    // Validate mappings against current markets
  }

  async onTick(context: StrategyContext): Promise<Signal[]> {
    const stateStore = context.stateStore;
    const signals: Signal[] = [];

    for (const mapping of this.mappings) {
      if (mapping.type === 'equivalent') {
        const arbSignals = this.checkEquivalentArbitrage(mapping, stateStore);
        signals.push(...arbSignals);
      } else if (mapping.type === 'parity') {
        const paritySignals = this.checkParity(mapping, stateStore);
        signals.push(...paritySignals);
      }
    }

    return signals;
  }

  private checkEquivalentArbitrage(
    mapping: MarketMapping,
    stateStore: StrategyContext['stateStore']
  ): Signal[] {
    const signals: Signal[] = [];
    const prices: Array<{ tokenId: string; price: Decimal; features: DerivedFeatures }> = [];

    // Collect prices for all markets in mapping
    for (const marketRef of mapping.markets) {
      const features = stateStore.getDerivedFeatures(marketRef.tokenId);
      if (!features.midPrice) continue;

      prices.push({
        tokenId: marketRef.tokenId,
        price: features.midPrice,
        features,
      });
    }

    if (prices.length < 2) return signals;

    // Find min and max prices
    let minPrice = prices[0];
    let maxPrice = prices[0];

    for (const p of prices) {
      if (p.price.lt(minPrice.price)) minPrice = p;
      if (p.price.gt(maxPrice.price)) maxPrice = p;
    }

    const spread = maxPrice.price.minus(minPrice.price);
    const edge = spread.minus(this.config.feeRate.times(2)).minus(this.config.maxSlippage.times(2));

    if (edge.gt(this.config.minEdge)) {
      // Buy the cheap side, sell the expensive side
      const buyBook = stateStore.getOrderBook(minPrice.tokenId);
      const sellBook = stateStore.getOrderBook(maxPrice.tokenId);

      if (buyBook && sellBook && buyBook.bids.length > 0 && sellBook.asks.length > 0) {
        const buySize = Decimal.min(buyBook.bids[0].size, sellBook.asks[0].size);

        signals.push({
          tokenId: minPrice.tokenId,
          side: 'buy',
          price: buyBook.bids[0].price,
          size: buySize,
          reason: `Cross-market arb: buy cheap at ${minPrice.price.toString()}`,
          expectedEdge: edge,
          confidence: Decimal.min(1, edge.div(this.config.minEdge.times(2))),
        });

        signals.push({
          tokenId: maxPrice.tokenId,
          side: 'sell',
          price: sellBook.asks[0].price,
          size: buySize,
          reason: `Cross-market arb: sell expensive at ${maxPrice.price.toString()}`,
          expectedEdge: edge,
          confidence: Decimal.min(1, edge.div(this.config.minEdge.times(2))),
        });
      }
    }

    return signals;
  }

  private checkParity(mapping: MarketMapping, stateStore: StrategyContext['stateStore']): Signal[] {
    const signals: Signal[] = [];
    const prices: Decimal[] = [];

    // Collect prices
    for (const marketRef of mapping.markets) {
      const features = stateStore.getDerivedFeatures(marketRef.tokenId);
      if (!features.midPrice) continue;

      prices.push(features.midPrice);
    }

    if (prices.length < 2) return signals;

    // Check if sum equals 1 (for complementary outcomes)
    const sum = prices.reduce((s, p) => s.plus(p), new Decimal(0));
    const deviation = sum.minus(1).abs();

    if (deviation.gt(this.config.minEdge)) {
      // Parity violation detected
      // This is a simplified check; full implementation would need more logic
      // to determine which side to trade
    }

    return signals;
  }

  async onFill(_fill: unknown, _context: StrategyContext): Promise<void> {
    // Track fills for hedge execution
  }

  async onStop(): Promise<void> {
    // Cleanup
  }
}

