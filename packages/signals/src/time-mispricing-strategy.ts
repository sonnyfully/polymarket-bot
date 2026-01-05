import { getConfig } from '@pm-bot/config';
import type { Strategy, Signal, StrategyContext } from './strategy-harness.js';
import type { DerivedFeatures } from '@pm-bot/core';
import type { MappingService } from '@pm-bot/market-discovery';
import type { GammaMarket } from '@pm-bot/polymarket';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';

export interface TimeMispricingStrategyConfig {
  // Early market inefficiency (C1)
  earlyMarketHours: number; // Market is "new" if created within X hours (default 24)
  earlyMarketVolumeThreshold: Decimal; // Minimum volume to consider (default 1000)
  earlyMarketLiquidityThreshold: Decimal; // Minimum liquidity (default 500)
  earlyMarketLongWindow: number; // EMA long window for anchor (default 50)
  earlyMarketThresholdBps: number; // Deviation threshold (default 100 = 1%)
  earlyMarketMaxHoldTimeMs: number; // Max hold time (default 2 hours)

  // Pre-resolution overshoot (C2)
  preResolutionHours: number; // Final window before resolution (default 24)
  preResolutionExtremeMin: Decimal; // Extreme price min (default 0.95)
  preResolutionExtremeMax: Decimal; // Extreme price max (default 0.995)
  preResolutionMaxHoldTimeMs: number; // Max hold time (default 6 hours)

  // Common
  minEdgeBps: number; // Minimum edge (default 50 = 0.5%)
  maxSpreadBps: number; // Maximum spread (default 200 = 2%)
  minBookDepth: Decimal; // Minimum book depth
  maxAdverseMoveBps: number; // Stop loss in bps (default 200 = 2%)
  longOnly: boolean; // If true, only buy, don't sell
  deadMarketMinutes: number; // No trades in last N minutes = dead (default 30)
  deadMarketMinDepth: Decimal; // Minimum depth to avoid dead market (default 100)
}

interface MarketState {
  anchorPrice: Decimal | null;
  anchorSetTime: number;
  entryPrice: Decimal | null;
  entryTime: number | null;
}

export class TimeMispricingStrategy implements Strategy {
  name = 'time';
  private mappingService: MappingService | null;
  private config: TimeMispricingStrategyConfig;
  private marketStates: Map<string, MarketState> = new Map();

  constructor(
    mappingService: MappingService | null = null,
    config: Partial<TimeMispricingStrategyConfig> = {}
  ) {
    this.mappingService = mappingService;
    const envConfig = getConfig();
    this.config = {
      earlyMarketHours: config.earlyMarketHours ?? 24,
      earlyMarketVolumeThreshold: config.earlyMarketVolumeThreshold ?? new Decimal(1000),
      earlyMarketLiquidityThreshold: config.earlyMarketLiquidityThreshold ?? new Decimal(500),
      earlyMarketLongWindow: config.earlyMarketLongWindow ?? 50,
      earlyMarketThresholdBps: config.earlyMarketThresholdBps ?? 100,
      earlyMarketMaxHoldTimeMs: config.earlyMarketMaxHoldTimeMs ?? 2 * 60 * 60 * 1000,
      preResolutionHours: config.preResolutionHours ?? 24,
      preResolutionExtremeMin: config.preResolutionExtremeMin ?? new Decimal(0.95),
      preResolutionExtremeMax: config.preResolutionExtremeMax ?? new Decimal(0.995),
      preResolutionMaxHoldTimeMs: config.preResolutionMaxHoldTimeMs ?? 6 * 60 * 60 * 1000,
      minEdgeBps: config.minEdgeBps ?? 50,
      maxSpreadBps: config.maxSpreadBps ?? 200,
      minBookDepth: config.minBookDepth ?? new Decimal(100),
      maxAdverseMoveBps: config.maxAdverseMoveBps ?? 200,
      longOnly: config.longOnly ?? true,
      deadMarketMinutes: config.deadMarketMinutes ?? 30,
      deadMarketMinDepth: config.deadMarketMinDepth ?? new Decimal(100),
    };
  }

  async onStart(_context: StrategyContext): Promise<void> {
    // Initialize market states
  }

  async onTick(context: StrategyContext): Promise<Signal[]> {
    const signals: Signal[] = [];
    const stateStore = context.stateStore;
    const tokenIds = stateStore.getAllTokenIds();

    for (const tokenId of tokenIds) {
      // Check if market is dead
      if (this.isDeadMarket(tokenId, stateStore)) {
        continue;
      }

      // C1: Early market inefficiency
      const earlySignals = this.checkEarlyMarketInefficiency(tokenId, stateStore);
      signals.push(...earlySignals);

      // C2: Pre-resolution overshoot
      const preResolutionSignals = this.checkPreResolutionOvershoot(tokenId, stateStore);
      signals.push(...preResolutionSignals);
    }

    return signals;
  }

  private checkEarlyMarketInefficiency(
    tokenId: string,
    stateStore: StrategyContext['stateStore']
  ): Signal[] {
    const signals: Signal[] = [];
    const market = stateStore.getMarketForToken(tokenId);
    const features = stateStore.getDerivedFeatures(tokenId);
    const book = stateStore.getOrderBook(tokenId);

    if (!market || !features.midPrice || !book) {
      return signals;
    }

    // Check if market is "new"
    const marketAge = this.getMarketAge(market);
    if (marketAge > this.config.earlyMarketHours * 60 * 60 * 1000) {
      return signals; // Not a new market
    }

    // Check volume/liquidity thresholds
    const totalDepth = features.bidDepth.plus(features.askDepth);
    if (totalDepth.lt(this.config.earlyMarketLiquidityThreshold)) {
      return signals;
    }

    // Check spread
    if (features.spreadBps && features.spreadBps.gt(this.config.maxSpreadBps)) {
      return signals;
    }

    // Check book depth
    if (
      features.bidDepth.lt(this.config.minBookDepth) ||
      features.askDepth.lt(this.config.minBookDepth)
    ) {
      return signals;
    }

    // Get or set anchor price (EMA or initial smoothed)
    const state = this.getMarketState(tokenId);
    if (!state.anchorPrice) {
      // Use EMA if available, otherwise use current mid
      state.anchorPrice = features.ema || features.midPrice;
      state.anchorSetTime = Date.now();
      this.marketStates.set(tokenId, state);
    }

    const anchorPrice = state.anchorPrice;
    const currentPrice = features.midPrice;

    // Check deviation from anchor
    const deviation = currentPrice.minus(anchorPrice);
    const deviationBps = deviation.abs().times(10000);

    if (deviationBps.lt(this.config.earlyMarketThresholdBps)) {
      return signals; // Not enough deviation
    }

    // Check volatility (high volatility = more opportunity but more risk)
    const volatility = features.ewmaVol || new Decimal(0);
    const volatilityBps = volatility.times(10000);

    // Calculate net edge
    const feeBps = 200; // 2% fee
    const spreadBps = features.spreadBps ? features.spreadBps.toNumber() : 100;
    const netEdgeBps = deviationBps.minus(feeBps).minus(spreadBps);

    if (netEdgeBps.lt(this.config.minEdgeBps)) {
      return signals; // Insufficient edge
    }

    // Generate signal: mean reversion
    if (deviation.lt(0) && book.bids.length > 0) {
      // Underpriced: BUY
      signals.push(this.createSignal({
        tokenId,
        side: 'buy',
        book,
        features,
        edgeBps: netEdgeBps,
        rationale: {
          mode: 'early_market',
          anchorPrice: anchorPrice.toString(),
          currentPrice: currentPrice.toString(),
          deviationBps: deviationBps.toString(),
          volatilityBps: volatilityBps.toString(),
          marketAgeHours: (marketAge / (60 * 60 * 1000)).toFixed(2),
          type: 'mean_reversion_buy',
        },
      }));
    } else if (!this.config.longOnly && deviation.gt(0) && book.asks.length > 0) {
      // Overpriced: SELL (if shorting allowed)
      signals.push(this.createSignal({
        tokenId,
        side: 'sell',
        book,
        features,
        edgeBps: netEdgeBps,
        rationale: {
          mode: 'early_market',
          anchorPrice: anchorPrice.toString(),
          currentPrice: currentPrice.toString(),
          deviationBps: deviationBps.toString(),
          volatilityBps: volatilityBps.toString(),
          marketAgeHours: (marketAge / (60 * 60 * 1000)).toFixed(2),
          type: 'mean_reversion_sell',
        },
      }));
    }

    return signals;
  }

  private checkPreResolutionOvershoot(
    tokenId: string,
    stateStore: StrategyContext['stateStore']
  ): Signal[] {
    const signals: Signal[] = [];
    const market = stateStore.getMarketForToken(tokenId);
    const features = stateStore.getDerivedFeatures(tokenId);
    const book = stateStore.getOrderBook(tokenId);

    if (!market || !features.midPrice || !book) {
      return signals;
    }

    // Check if market is in final window
    const timeToEnd = this.getTimeToEnd(market);
    if (!timeToEnd || timeToEnd > this.config.preResolutionHours * 60 * 60 * 1000) {
      return signals; // Not in final window
    }

    const currentPrice = features.midPrice;

    // Check if price is in extreme range
    if (
      currentPrice.lt(this.config.preResolutionExtremeMin) ||
      currentPrice.gt(this.config.preResolutionExtremeMax)
    ) {
      return signals; // Not extreme enough
    }

    // Check for microstructure stress: widening spread, thin depth, high volatility
    const spreadBps = features.spreadBps ? features.spreadBps.toNumber() : 0;
    const totalDepth = features.bidDepth.plus(features.askDepth);
    const volatility = features.ewmaVol || new Decimal(0);
    const volatilityBps = volatility.times(10000);

    // Require evidence of stress
    const hasStress =
      spreadBps > this.config.maxSpreadBps * 0.5 || // Spread widening
      totalDepth.lt(this.config.minBookDepth.times(2)) || // Thin depth
      volatilityBps.gt(500); // High volatility

    if (!hasStress) {
      return signals; // No stress, skip
    }

    // Contrarian signal: fade extremes
    // LONG-ONLY: focus on buying underpriced "NO-like" outcomes
    if (currentPrice.lt(0.5) && book.bids.length > 0) {
      // Underpriced NO outcome
      const edgeBps = new Decimal(0.5).minus(currentPrice).times(10000).minus(200); // Conservative edge estimate

      if (edgeBps.gt(this.config.minEdgeBps)) {
        signals.push(this.createSignal({
          tokenId,
          side: 'buy',
          book,
          features,
          edgeBps,
          rationale: {
            mode: 'pre_resolution',
            currentPrice: currentPrice.toString(),
            timeToEndHours: (timeToEnd / (60 * 60 * 1000)).toFixed(2),
            spreadBps: spreadBps.toString(),
            depth: totalDepth.toString(),
            volatilityBps: volatilityBps.toString(),
            type: 'contrarian_buy',
          },
        }));
      }
    } else if (!this.config.longOnly && currentPrice.gt(0.95) && book.asks.length > 0) {
      // Overpriced YES outcome (if shorting allowed)
      const edgeBps = currentPrice.minus(new Decimal(0.95)).times(10000).minus(200);

      if (edgeBps.gt(this.config.minEdgeBps)) {
        signals.push(this.createSignal({
          tokenId,
          side: 'sell',
          book,
          features,
          edgeBps,
          rationale: {
            mode: 'pre_resolution',
            currentPrice: currentPrice.toString(),
            timeToEndHours: (timeToEnd / (60 * 60 * 1000)).toFixed(2),
            spreadBps: spreadBps.toString(),
            depth: totalDepth.toString(),
            volatilityBps: volatilityBps.toString(),
            type: 'contrarian_sell',
          },
        }));
      }
    }

    return signals;
  }

  private isDeadMarket(
    tokenId: string,
    stateStore: StrategyContext['stateStore']
  ): boolean {
    const features = stateStore.getDerivedFeatures(tokenId);
    const trades = stateStore.getTrades(tokenId, 100);

    // Check if no recent trades
    if (trades.length === 0) {
      return true;
    }

    const lastTrade = trades[trades.length - 1];
    const timeSinceLastTrade = Date.now() - lastTrade.timestamp.getTime();
    if (timeSinceLastTrade > this.config.deadMarketMinutes * 60 * 1000) {
      // Check depth
      const totalDepth = features.bidDepth.plus(features.askDepth);
      if (totalDepth.lt(this.config.deadMarketMinDepth)) {
        return true; // Dead market
      }
    }

    return false;
  }

  private getMarketAge(market: GammaMarket): number {
    // Use endDate or createdAt if available
    // For now, assume market is new if we don't have creation date
    // In production, you'd get this from market metadata
    return 0; // Simplified - assume all markets are "new" if we can't determine age
  }

  private getTimeToEnd(market: GammaMarket): number | null {
    if (!market.endDate) {
      return null;
    }

    const now = Date.now();
    const endTime = market.endDate.getTime();
    return Math.max(0, endTime - now);
  }

  private getMarketState(tokenId: string): MarketState {
    if (!this.marketStates.has(tokenId)) {
      this.marketStates.set(tokenId, {
        anchorPrice: null,
        anchorSetTime: 0,
        entryPrice: null,
        entryTime: null,
      });
    }
    return this.marketStates.get(tokenId)!;
  }

  private createSignal(params: {
    tokenId: string;
    side: 'buy' | 'sell';
    book: NonNullable<ReturnType<typeof stateStore.getOrderBook>>;
    features: DerivedFeatures;
    edgeBps: Decimal;
    rationale: Record<string, any>;
  }): Signal {
    const { tokenId, side, book, features, edgeBps, rationale } = params;

    const executablePrice =
      side === 'buy'
        ? book.bids[0]?.price || features.midPrice || new Decimal(0.5)
        : book.asks[0]?.price || features.midPrice || new Decimal(0.5);

    const executableSize =
      side === 'buy'
        ? book.bids[0]?.size || this.config.minBookDepth
        : book.asks[0]?.size || this.config.minBookDepth;

    const size = Decimal.min(executableSize, this.config.minBookDepth);

    return {
      id: randomUUID(),
      strategy: 'time',
      tokenId,
      side,
      limitPrice: executablePrice,
      size,
      expectedEdgeBps: edgeBps,
      confidence: new Decimal(0.7), // Lower confidence for time-based signals
      ttlMs: rationale.mode === 'early_market'
        ? this.config.earlyMarketMaxHoldTimeMs
        : this.config.preResolutionMaxHoldTimeMs,
      createdAt: Date.now(),
      rationale,
    };
  }

  async onFill(fill: unknown, _context: StrategyContext): Promise<void> {
    // Track entry prices for stop loss
    const fillObj = fill as { tokenId: string; price: Decimal; side: 'buy' | 'sell' };
    const state = this.getMarketState(fillObj.tokenId);
    state.entryPrice = fillObj.price;
    state.entryTime = Date.now();
    this.marketStates.set(fillObj.tokenId, state);
  }

  async onStop(): Promise<void> {
    // Cleanup
  }
}

