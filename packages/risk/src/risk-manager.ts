import { getConfig } from '@pm-bot/config';
import type { Position, Order, OrderBook } from '@pm-bot/core';
import { fixedFractionalSize, kellyFraction } from '@pm-bot/core';
import Decimal from 'decimal.js';
import { existsSync } from 'fs';

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  adjustedSize?: Decimal;
}

export class RiskManager {
  private config: ReturnType<typeof getConfig>;
  private dailyPnl: Decimal = new Decimal(0);
  private dailyStartTime: Date = new Date();
  private orderCount: number = 0;
  private orderWindowStart: Date = new Date();
  private errorCount: number = 0;
  private errorWindowStart: Date = new Date();
  private maxDrawdown: Decimal = new Decimal(0);
  private peakBalance: Decimal = new Decimal(0);

  constructor() {
    this.config = getConfig();
    this.resetDailyMetrics();
  }

  checkKillSwitch(): boolean {
    return existsSync('kill-switch.flag');
  }

  checkDailyLoss(balance: Decimal): RiskCheckResult {
    if (this.dailyPnl.lt(0) && this.dailyPnl.abs().gte(this.config.MAX_DAILY_LOSS)) {
      return {
        allowed: false,
        reason: `Daily loss limit reached: ${this.dailyPnl.toString()}`,
      };
    }
    return { allowed: true };
  }

  checkPositionLimit(
    marketId: string,
    tokenId: string,
    currentPosition: Position | null,
    newSize: Decimal
  ): RiskCheckResult {
    const totalSize = (currentPosition?.size || new Decimal(0)).plus(newSize).abs();
    if (totalSize.gt(this.config.MAX_POSITION_PER_MARKET)) {
      return {
        allowed: false,
        reason: `Position limit exceeded for ${marketId}:${tokenId}`,
      };
    }
    return { allowed: true };
  }

  checkGrossExposure(positions: Position[]): RiskCheckResult {
    const grossExposure = positions.reduce(
      (sum, p) => sum.plus(p.size.abs()),
      new Decimal(0)
    );

    if (grossExposure.gt(this.config.MAX_GROSS_EXPOSURE)) {
      return {
        allowed: false,
        reason: `Gross exposure limit exceeded: ${grossExposure.toString()}`,
      };
    }
    return { allowed: true };
  }

  checkOrderRate(): RiskCheckResult {
    const now = new Date();
    const windowMs = 1000; // 1 second window
    const elapsed = now.getTime() - this.orderWindowStart.getTime();

    if (elapsed > windowMs) {
      this.orderCount = 0;
      this.orderWindowStart = now;
    }

    if (this.orderCount >= this.config.MAX_ORDER_RATE_PER_SECOND) {
      return {
        allowed: false,
        reason: `Order rate limit exceeded: ${this.orderCount} orders/sec`,
      };
    }

    this.orderCount++;
    return { allowed: true };
  }

  checkCircuitBreakers(
    wsConnected: boolean,
    wsDisconnectTime: Date | null,
    lastPriceUpdate: Date | null
  ): RiskCheckResult {
    // WebSocket disconnect check
    if (!wsConnected && wsDisconnectTime) {
      const disconnectDuration = Date.now() - wsDisconnectTime.getTime();
      if (disconnectDuration > this.config.WEBSOCKET_DISCONNECT_TIMEOUT_MS) {
        return {
          allowed: false,
          reason: `WebSocket disconnected for ${disconnectDuration}ms`,
        };
      }
    }

    // Stale price feed check
    if (lastPriceUpdate) {
      const priceAge = Date.now() - lastPriceUpdate.getTime();
      if (priceAge > this.config.PRICE_FEED_STALE_MS) {
        return {
          allowed: false,
          reason: `Price feed stale: ${priceAge}ms old`,
        };
      }
    }

    // Error rate check
    const now = new Date();
    const errorWindowMs = 60000; // 1 minute
    const elapsed = now.getTime() - this.errorWindowStart.getTime();

    if (elapsed > errorWindowMs) {
      this.errorCount = 0;
      this.errorWindowStart = now;
    }

    if (this.errorCount >= this.config.MAX_ERROR_RATE_PER_MINUTE) {
      return {
        allowed: false,
        reason: `Error rate too high: ${this.errorCount} errors/min`,
      };
    }

    return { allowed: true };
  }

  calculatePositionSize(
    signalSize: Decimal,
    balance: Decimal,
    riskPerTrade: Decimal = new Decimal(0.02), // 2% default
    stopLoss?: Decimal,
    winProb?: Decimal,
    winAmount?: Decimal,
    lossAmount?: Decimal
  ): Decimal {
    // Use Kelly criterion if provided, otherwise fixed fractional
    if (winProb && winAmount && lossAmount) {
      const kelly = kellyFraction(winProb, winAmount, lossAmount);
      const kellySize = balance.times(kelly).times(0.25); // Conservative: 25% of Kelly
      return Decimal.min(signalSize, kellySize);
    }

    if (stopLoss) {
      const fixedSize = fixedFractionalSize(balance, riskPerTrade, stopLoss);
      return Decimal.min(signalSize, fixedSize);
    }

    // Default: use signal size but cap at 5% of balance
    return Decimal.min(signalSize, balance.times(0.05));
  }

  updateDailyPnl(pnl: Decimal): void {
    this.dailyPnl = this.dailyPnl.plus(pnl);
  }

  updateDrawdown(balance: Decimal): void {
    if (balance.gt(this.peakBalance)) {
      this.peakBalance = balance;
      this.maxDrawdown = new Decimal(0);
    } else {
      const drawdown = this.peakBalance.minus(balance);
      if (drawdown.gt(this.maxDrawdown)) {
        this.maxDrawdown = drawdown;
      }
    }
  }

  recordError(): void {
    this.errorCount++;
  }

  resetDailyMetrics(): void {
    this.dailyPnl = new Decimal(0);
    this.dailyStartTime = new Date();
  }

  getDailyPnl(): Decimal {
    return this.dailyPnl;
  }

  getMaxDrawdown(): Decimal {
    return this.maxDrawdown;
  }
}

