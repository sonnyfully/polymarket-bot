import type { MarketStateStore } from '@pm-bot/core';
import type { PaperExecutionSim, Fill } from '@pm-bot/execution';
import type { RiskGate } from '@pm-bot/risk';
import type { Strategy, Signal, OrderIntent } from '@pm-bot/signals';
import type { MappingService } from '@pm-bot/market-discovery';
import type { Repository } from '@pm-bot/storage';
import { MetricsCalculator, type ExperimentMetrics, type DailyMetrics } from './metrics.js';
import { Reporter } from './reporter.js';
import Decimal from 'decimal.js';

export interface ExperimentConfig {
  strategy: string | string[]; // 'parity' | 'xrv' | 'time' or array for multi-strategy
  universeKey?: string;
  hours?: number; // Run for N hours
  startDate?: Date;
  endDate?: Date;
  seed?: number; // RNG seed for deterministic execution
  initialCapital: Decimal;
  weights?: number[]; // Strategy weights for multi-strategy (default: equal)
}

export interface ExperimentResult {
  metrics: ExperimentMetrics;
  cliSummary: string;
  jsonOutput: string;
}

export class ExperimentRunner {
  private stateStore: MarketStateStore;
  private executionSim: PaperExecutionSim;
  private riskGate: RiskGate;
  private mappingService: MappingService;
  private repository: Repository;
  private strategies: Map<string, Strategy> = new Map();
  private positions: Map<string, { marketId: string; tokenId: string; size: Decimal; avgPrice: Decimal }> = new Map();
  private balance: Decimal;
  private signals: Signal[] = [];
  private fills: Fill[] = [];
  private dailyMetrics: Map<string, DailyMetrics> = new Map();

  constructor(
    stateStore: MarketStateStore,
    executionSim: PaperExecutionSim,
    riskGate: RiskGate,
    mappingService: MappingService,
    repository: Repository
  ) {
    this.stateStore = stateStore;
    this.executionSim = executionSim;
    this.riskGate = riskGate;
    this.mappingService = mappingService;
    this.repository = repository;
  }

  /**
   * Register a strategy
   */
  registerStrategy(strategy: Strategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  /**
   * Run a paper trading experiment
   */
  async run(config: ExperimentConfig): Promise<ExperimentResult> {
    // Initialize
    this.balance = config.initialCapital;
    const startDate = config.startDate || new Date();
    const endDate = config.endDate || (config.hours
      ? new Date(startDate.getTime() + config.hours * 60 * 60 * 1000)
      : new Date());

    // Select strategies
    const strategyNames = Array.isArray(config.strategy) ? config.strategy : [config.strategy];
    const activeStrategies = strategyNames
      .map((name) => this.strategies.get(name))
      .filter((s): s is Strategy => s !== undefined);

    if (activeStrategies.length === 0) {
      throw new Error(`No strategies found: ${strategyNames.join(', ')}`);
    }

    // Initialize strategies
    const context = {
      stateStore: this.stateStore,
      timestamp: new Date(),
    };

    for (const strategy of activeStrategies) {
      await strategy.onStart(context);
    }

    // Main loop
    const tickInterval = 5000; // 5 seconds per tick
    let currentDate = new Date(startDate);
    const endTime = endDate.getTime();

    while (currentDate.getTime() < endTime) {
      // Update context
      context.timestamp = currentDate;

      // Generate signals from all strategies
      const allSignals: Signal[] = [];
      for (const strategy of activeStrategies) {
        try {
          const strategySignals = await strategy.onTick(context);
          allSignals.push(...strategySignals);
        } catch (error) {
          console.error(`Strategy ${strategy.name} error:`, error);
        }
      }

      // Gate signals
      const gatedSignals: OrderIntent[] = [];
      for (const signal of allSignals) {
        const positionsMap = new Map(
          Array.from(this.positions.entries()).map(([k, v]) => [k, v])
        );
        const intent = this.riskGate.gateSignal(signal, positionsMap, this.balance);

        if (!intent.gated) {
          gatedSignals.push(intent);
        }
      }

      // Execute signals
      for (const intent of gatedSignals) {
        const orderIntent = this.signalToOrderIntent(intent.signal);
        this.executionSim.placeOrder(orderIntent);

        // Process fills
        const tokenId = intent.signal.tokenId;
        const book = this.stateStore.getOrderBook(tokenId);
        if (book) {
          const newFills = this.executionSim.processMarketUpdate(tokenId, book);
          this.fills.push(...newFills);

          // Update balance and positions
          for (const fill of newFills) {
            this.processFill(fill);

            // Notify strategies
            for (const strategy of activeStrategies) {
              try {
                await strategy.onFill(fill, context);
              } catch (error) {
                console.error(`Strategy ${strategy.name} fill error:`, error);
              }
            }
          }
        }
      }

      // Calculate daily metrics
      const dateKey = currentDate.toISOString().split('T')[0];
      if (!this.dailyMetrics.has(dateKey)) {
        const daily = MetricsCalculator.calculateDailyMetrics(
          dateKey,
          strategyNames.join(','),
          allSignals,
          this.fills.filter((f) => {
            const fillDate = new Date(f.timestamp);
            return fillDate.toISOString().split('T')[0] === dateKey;
          }),
          Array.from(this.positions.values()).map((p) => ({
            marketId: p.marketId,
            tokenId: p.tokenId,
            size: p.size,
            avgPrice: p.avgPrice,
            realizedPnl: new Decimal(0),
            unrealizedPnl: new Decimal(0),
            lastUpdate: currentDate,
          })),
          this.balance
        );
        this.dailyMetrics.set(dateKey, daily);
      }

      // Advance time
      currentDate = new Date(currentDate.getTime() + tickInterval);
    }

    // Stop strategies
    for (const strategy of activeStrategies) {
      await strategy.onStop();
    }

    // Calculate final metrics
    const relationStats = MetricsCalculator.calculateRelationStats(this.signals, this.fills);
    const experimentMetrics = MetricsCalculator.calculateExperimentMetrics(
      startDate,
      endDate,
      config.strategy,
      config.initialCapital,
      this.balance,
      Array.from(this.dailyMetrics.values()),
      relationStats
    );

    // Generate reports
    const cliSummary = Reporter.generateCLISummary(experimentMetrics);
    const jsonOutput = Reporter.generateJSON(experimentMetrics);

    return {
      metrics: experimentMetrics,
      cliSummary,
      jsonOutput,
    };
  }

  private signalToOrderIntent(signal: Signal): import('@pm-bot/execution').OrderIntent {
    return {
      id: signal.id,
      tokenId: signal.tokenId,
      side: signal.side,
      price: signal.limitPrice,
      size: signal.size,
      type: 'limit',
      timestamp: new Date(signal.createdAt),
      reason: JSON.stringify(signal.rationale),
    };
  }

  private processFill(fill: Fill): void {
    const cost = fill.price.times(fill.size).plus(fill.fee);
    const positionKey = `${fill.tokenId}`;

    if (fill.side === 'buy') {
      this.balance = this.balance.minus(cost);

      const existing = this.positions.get(positionKey);
      if (existing) {
        const totalSize = existing.size.plus(fill.size);
        const totalCost = existing.avgPrice.times(existing.size).plus(fill.price.times(fill.size));
        existing.size = totalSize;
        existing.avgPrice = totalCost.div(totalSize);
      } else {
        this.positions.set(positionKey, {
          marketId: fill.tokenId, // Simplified - would need marketId from signal
          tokenId: fill.tokenId,
          size: fill.size,
          avgPrice: fill.price,
        });
      }
    } else {
      // Sell
      this.balance = this.balance.plus(fill.price.times(fill.size).minus(fill.fee));

      const existing = this.positions.get(positionKey);
      if (existing) {
        existing.size = existing.size.minus(fill.size);
        if (existing.size.lte(0)) {
          this.positions.delete(positionKey);
        }
      }
    }
  }
}

