import type { MarketStateStore, DerivedFeatures } from '@pm-bot/core';
import type { OrderIntent } from '@pm-bot/execution';
import Decimal from 'decimal.js';

import type { Signal } from './types.js';

// Re-export Signal from types
export type { Signal };

export interface StrategyContext {
  stateStore: MarketStateStore;
  timestamp: Date;
}

export interface Strategy {
  name: string;
  onStart(context: StrategyContext): Promise<void>;
  onTick(context: StrategyContext): Promise<Signal[]>;
  onFill(fill: unknown, context: StrategyContext): Promise<void>;
  onStop(): Promise<void>;
}

export class StrategyHarness {
  private strategies: Strategy[] = [];
  private stateStore: MarketStateStore;

  constructor(stateStore: MarketStateStore) {
    this.stateStore = stateStore;
  }

  addStrategy(strategy: Strategy): void {
    this.strategies.push(strategy);
  }

  async start(): Promise<void> {
    const context: StrategyContext = {
      stateStore: this.stateStore,
      timestamp: new Date(),
    };

    for (const strategy of this.strategies) {
      await strategy.onStart(context);
    }
  }

  async tick(): Promise<Signal[]> {
    const context: StrategyContext = {
      stateStore: this.stateStore,
      timestamp: new Date(),
    };

    const allSignals: Signal[] = [];

    for (const strategy of this.strategies) {
      try {
        const signals = await strategy.onTick(context);
        allSignals.push(...signals);
      } catch (error) {
        console.error(`Strategy ${strategy.name} error:`, error);
      }
    }

    return allSignals;
  }

  async handleFill(fill: unknown): Promise<void> {
    const context: StrategyContext = {
      stateStore: this.stateStore,
      timestamp: new Date(),
    };

    for (const strategy of this.strategies) {
      try {
        await strategy.onFill(fill, context);
      } catch (error) {
        console.error(`Strategy ${strategy.name} fill error:`, error);
      }
    }
  }

  async stop(): Promise<void> {
    for (const strategy of this.strategies) {
      await strategy.onStop();
    }
  }

  signalToOrderIntent(signal: Signal): import('@pm-bot/execution').OrderIntent {
    return {
      id: `order-${Date.now()}-${Math.random()}`,
      tokenId: signal.tokenId,
      side: signal.side,
      price: signal.limitPrice,
      size: signal.size,
      type: 'limit',
      timestamp: new Date(signal.createdAt),
      reason: JSON.stringify(signal.rationale),
    };
  }
}

