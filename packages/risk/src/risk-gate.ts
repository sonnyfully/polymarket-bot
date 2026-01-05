import type { RiskManager, RiskCheckResult } from './risk-manager.js';
import type { Signal, OrderIntent } from '@pm-bot/signals';
import type { Position } from '@pm-bot/core';
import Decimal from 'decimal.js';

export interface RiskGateConfig {
  maxPositionPerToken: Decimal;
  maxGrossExposure: Decimal;
  maxNetExposure: Decimal;
  maxDailyLoss: Decimal;
  maxDrawdown: Decimal;
  staleFeedMs: number; // Pause if market data stale
}

export class RiskGate {
  private riskManager: RiskManager;
  private config: RiskGateConfig;
  private lastPriceUpdate: Map<string, number> = new Map();

  constructor(riskManager: RiskManager, config: Partial<RiskGateConfig> = {}) {
    this.riskManager = riskManager;
    this.config = {
      maxPositionPerToken: config.maxPositionPerToken ?? new Decimal(1000),
      maxGrossExposure: config.maxGrossExposure ?? new Decimal(10000),
      maxNetExposure: config.maxNetExposure ?? new Decimal(5000),
      maxDailyLoss: config.maxDailyLoss ?? new Decimal(500),
      maxDrawdown: config.maxDrawdown ?? new Decimal(1000),
      staleFeedMs: config.staleFeedMs ?? 60000,
    };
  }

  /**
   * Gate a signal, returning an OrderIntent with gated flag
   */
  gateSignal(
    signal: Signal,
    currentPositions: Map<string, Position>,
    balance: Decimal
  ): OrderIntent {
    const gateReasons: string[] = [];

    // Check kill switch
    if (this.riskManager.checkKillSwitch()) {
      gateReasons.push('Kill switch active');
      return { signal, gated: true, gateReasons };
    }

    // Check daily loss
    const dailyLossCheck = this.riskManager.checkDailyLoss(balance);
    if (!dailyLossCheck.allowed) {
      gateReasons.push(dailyLossCheck.reason || 'Daily loss limit');
      return { signal, gated: true, gateReasons };
    }

    // Check position limit
    const positionKey = `${signal.marketId || 'unknown'}-${signal.tokenId}`;
    const currentPosition = currentPositions.get(positionKey);
    const positionCheck = this.riskManager.checkPositionLimit(
      signal.marketId || 'unknown',
      signal.tokenId,
      currentPosition || null,
      signal.size
    );
    if (!positionCheck.allowed) {
      gateReasons.push(positionCheck.reason || 'Position limit');
      return { signal, gated: true, gateReasons };
    }

    // Check gross exposure
    const positions = Array.from(currentPositions.values());
    const grossExposureCheck = this.riskManager.checkGrossExposure(positions);
    if (!grossExposureCheck.allowed) {
      gateReasons.push(grossExposureCheck.reason || 'Gross exposure limit');
      return { signal, gated: true, gateReasons };
    }

    // Check net exposure
    const netExposure = positions.reduce(
      (sum, p) => sum.plus(p.size),
      new Decimal(0)
    );
    if (netExposure.abs().gt(this.config.maxNetExposure)) {
      gateReasons.push(`Net exposure limit: ${netExposure.toString()}`);
      return { signal, gated: true, gateReasons };
    }

    // Check order rate
    const rateCheck = this.riskManager.checkOrderRate();
    if (!rateCheck.allowed) {
      gateReasons.push(rateCheck.reason || 'Order rate limit');
      return { signal, gated: true, gateReasons };
    }

    // Check stale feed
    const lastUpdate = this.lastPriceUpdate.get(signal.tokenId);
    if (lastUpdate && Date.now() - lastUpdate > this.config.staleFeedMs) {
      gateReasons.push('Stale price feed');
      return { signal, gated: true, gateReasons };
    }

    // All checks passed
    return { signal, gated: false };
  }

  /**
   * Update last price update time for a token
   */
  updatePriceFeed(tokenId: string): void {
    this.lastPriceUpdate.set(tokenId, Date.now());
  }

  /**
   * Check circuit breakers
   */
  checkCircuitBreakers(
    wsConnected: boolean,
    wsDisconnectTime: Date | null,
    lastPriceUpdate: Date | null
  ): RiskCheckResult {
    return this.riskManager.checkCircuitBreakers(
      wsConnected,
      wsDisconnectTime,
      lastPriceUpdate
    );
  }

  /**
   * Calculate position size with risk limits
   */
  calculatePositionSize(
    signalSize: Decimal,
    balance: Decimal,
    riskPerTrade?: Decimal,
    stopLoss?: Decimal,
    winProb?: Decimal,
    winAmount?: Decimal,
    lossAmount?: Decimal
  ): Decimal {
    return this.riskManager.calculatePositionSize(
      signalSize,
      balance,
      riskPerTrade,
      stopLoss,
      winProb,
      winAmount,
      lossAmount
    );
  }
}

