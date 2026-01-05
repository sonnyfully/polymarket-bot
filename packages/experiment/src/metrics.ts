import type { Fill } from '@pm-bot/execution';
import type { Signal, OrderIntent } from '@pm-bot/signals';
import type { Position } from '@pm-bot/core';
import Decimal from 'decimal.js';

export interface DailyMetrics {
  date: string; // YYYY-MM-DD
  strategy: string;
  realizedPnl: Decimal;
  unrealizedPnl: Decimal;
  totalPnl: Decimal;
  maxDrawdown: Decimal;
  turnover: Decimal;
  hitRate: number; // 0-1
  avgNetEdgeBps: Decimal;
  avgSpreadBps: Decimal;
  avgSlippageBps: Decimal;
  avgGrossExposure: Decimal;
  maxGrossExposure: Decimal;
  concentration: Record<string, Decimal>; // marketId -> exposure
  pnlDistribution: {
    mean: Decimal;
    std: Decimal;
    skew: Decimal;
  };
  worstDay: Decimal;
  signalCount: number;
  fillCount: number;
}

export interface RelationStats {
  relationId: string;
  relationKind: string;
  count: number;
  pnl: Decimal;
  avgEdgeBps: Decimal;
  disabled: boolean;
}

export interface ExperimentMetrics {
  startDate: Date;
  endDate: Date;
  strategy: string | string[]; // Single strategy or multi-strategy
  initialCapital: Decimal;
  finalCapital: Decimal;
  totalPnl: Decimal;
  totalReturn: Decimal; // Percentage
  maxDrawdown: Decimal;
  sharpeRatio: Decimal | null;
  dailyMetrics: DailyMetrics[];
  relationStats: RelationStats[];
  overallStats: {
    totalSignals: number;
    totalFills: number;
    totalTurnover: Decimal;
    avgHitRate: number;
    avgEdgeBps: Decimal;
    avgSpreadBps: Decimal;
    avgSlippageBps: Decimal;
  };
}

export class MetricsCalculator {
  /**
   * Calculate daily metrics from signals, fills, and positions
   */
  static calculateDailyMetrics(
    date: string,
    strategy: string,
    signals: Signal[],
    fills: Fill[],
    positions: Position[],
    balance: Decimal
  ): DailyMetrics {
    // Realized PnL from fills
    const realizedPnl = fills.reduce(
      (sum, fill) => {
        const cost = fill.price.times(fill.size).plus(fill.fee);
        return fill.side === 'buy'
          ? sum.minus(cost)
          : sum.plus(fill.price.times(fill.size).minus(fill.fee));
      },
      new Decimal(0)
    );

    // Unrealized PnL from positions (simplified - would need current prices)
    const unrealizedPnl = new Decimal(0); // TODO: Calculate from positions and current prices

    const totalPnl = realizedPnl.plus(unrealizedPnl);

    // Turnover
    const turnover = fills.reduce(
      (sum, fill) => sum.plus(fill.price.times(fill.size)),
      new Decimal(0)
    );

    // Hit rate (simplified - would need to track winning vs losing trades)
    const hitRate = 0.5; // TODO: Calculate from actual trade outcomes

    // Average net edge
    const avgNetEdgeBps = signals.length > 0
      ? signals.reduce((sum, s) => sum.plus(s.expectedEdgeBps), new Decimal(0))
          .div(signals.length)
      : new Decimal(0);

    // Average spread and slippage
    const avgSpreadBps = fills.length > 0
      ? fills.reduce((sum, f) => {
          // Simplified - would need to track spread paid
          return sum.plus(new Decimal(100)); // Placeholder
        }, new Decimal(0)).div(fills.length)
      : new Decimal(0);

    const avgSlippageBps = fills.length > 0
      ? fills.reduce((sum, f) => sum.plus(f.slippage.times(10000)), new Decimal(0))
          .div(fills.length)
      : new Decimal(0);

    // Exposure stats
    const grossExposure = positions.reduce(
      (sum, p) => sum.plus(p.size.abs()),
      new Decimal(0)
    );
    const maxGrossExposure = grossExposure; // Simplified - would track max over day

    // Concentration
    const concentration: Record<string, Decimal> = {};
    for (const pos of positions) {
      concentration[pos.marketId] = (concentration[pos.marketId] || new Decimal(0))
        .plus(pos.size.abs());
    }

    // PnL distribution (simplified)
    const pnlDistribution = {
      mean: totalPnl,
      std: new Decimal(0), // TODO: Calculate from daily PnL history
      skew: new Decimal(0), // TODO: Calculate
    };

    return {
      date,
      strategy,
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      maxDrawdown: new Decimal(0), // TODO: Calculate from balance history
      turnover,
      hitRate,
      avgNetEdgeBps,
      avgSpreadBps,
      avgSlippageBps,
      avgGrossExposure: grossExposure,
      maxGrossExposure,
      concentration,
      pnlDistribution,
      worstDay: new Decimal(0), // TODO: Calculate
      signalCount: signals.length,
      fillCount: fills.length,
    };
  }

  /**
   * Calculate relation-level statistics
   */
  static calculateRelationStats(
    signals: Signal[],
    fills: Fill[]
  ): RelationStats[] {
    const relationMap = new Map<string, RelationStats>();

    for (const signal of signals) {
      const relationId = signal.rationale.relationId || signal.rationale.pairedTokenId || 'unknown';
      const relationKind = signal.rationale.relationKind || 'unknown';

      const key = `${relationKind}:${relationId}`;
      const existing = relationMap.get(key) || {
        relationId: key,
        relationKind,
        count: 0,
        pnl: new Decimal(0),
        avgEdgeBps: new Decimal(0),
        disabled: false,
      };

      existing.count++;
      existing.avgEdgeBps = existing.avgEdgeBps
        .times(existing.count - 1)
        .plus(signal.expectedEdgeBps)
        .div(existing.count);

      relationMap.set(key, existing);
    }

    // TODO: Calculate actual PnL per relation from fills
    return Array.from(relationMap.values());
  }

  /**
   * Calculate overall experiment metrics
   */
  static calculateExperimentMetrics(
    startDate: Date,
    endDate: Date,
    strategy: string | string[],
    initialCapital: Decimal,
    finalCapital: Decimal,
    dailyMetrics: DailyMetrics[],
    relationStats: RelationStats[]
  ): ExperimentMetrics {
    const totalPnl = finalCapital.minus(initialCapital);
    const totalReturn = totalPnl.div(initialCapital).times(100);

    // Max drawdown from daily metrics
    const maxDrawdown = dailyMetrics.reduce(
      (max, d) => Decimal.max(max, d.maxDrawdown),
      new Decimal(0)
    );

    // Sharpe ratio (simplified - would need risk-free rate)
    const sharpeRatio = null; // TODO: Calculate from daily returns

    // Overall stats
    const totalSignals = dailyMetrics.reduce((sum, d) => sum + d.signalCount, 0);
    const totalFills = dailyMetrics.reduce((sum, d) => sum + d.fillCount, 0);
    const totalTurnover = dailyMetrics.reduce(
      (sum, d) => sum.plus(d.turnover),
      new Decimal(0)
    );
    const avgHitRate = dailyMetrics.length > 0
      ? dailyMetrics.reduce((sum, d) => sum + d.hitRate, 0) / dailyMetrics.length
      : 0;
    const avgEdgeBps = dailyMetrics.length > 0
      ? dailyMetrics.reduce((sum, d) => sum.plus(d.avgNetEdgeBps), new Decimal(0))
          .div(dailyMetrics.length)
      : new Decimal(0);
    const avgSpreadBps = dailyMetrics.length > 0
      ? dailyMetrics.reduce((sum, d) => sum.plus(d.avgSpreadBps), new Decimal(0))
          .div(dailyMetrics.length)
      : new Decimal(0);
    const avgSlippageBps = dailyMetrics.length > 0
      ? dailyMetrics.reduce((sum, d) => sum.plus(d.avgSlippageBps), new Decimal(0))
          .div(dailyMetrics.length)
      : new Decimal(0);

    return {
      startDate,
      endDate,
      strategy,
      initialCapital,
      finalCapital,
      totalPnl,
      totalReturn,
      maxDrawdown,
      sharpeRatio,
      dailyMetrics,
      relationStats,
      overallStats: {
        totalSignals,
        totalFills,
        totalTurnover,
        avgHitRate,
        avgEdgeBps,
        avgSpreadBps,
        avgSlippageBps,
      },
    };
  }
}

