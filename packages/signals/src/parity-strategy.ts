import { getConfig } from '@pm-bot/config';
import type { Strategy, Signal, StrategyContext } from './strategy-harness.js';
import type { DerivedFeatures } from '@pm-bot/core';
import type { MappingService, MappingRelation } from '@pm-bot/market-discovery';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';

export interface ParityStrategyConfig {
  minEdgeBps: number; // Minimum edge in basis points (default 50 = 0.5%)
  maxSpreadBps: number; // Maximum spread to trade (default 200 = 2%)
  maxSlippageBps: number; // Maximum acceptable slippage (default 50 = 0.5%)
  minBookDepth: Decimal; // Minimum book depth
  eps: Decimal; // Threshold for violation detection (default 0.01 = 1%)
  longOnly: boolean; // If true, only buy underpriced, don't sell overpriced
}

export class ParityStrategy implements Strategy {
  name = 'parity';
  private mappingService: MappingService;
  private config: ParityStrategyConfig;
  private currentMapping: { version: string; relations: MappingRelation[] } | null = null;

  constructor(mappingService: MappingService, config: Partial<ParityStrategyConfig> = {}) {
    this.mappingService = mappingService;
    const envConfig = getConfig();
    this.config = {
      minEdgeBps: config.minEdgeBps ?? 50,
      maxSpreadBps: config.maxSpreadBps ?? 200,
      maxSlippageBps: config.maxSlippageBps ?? 50,
      minBookDepth: config.minBookDepth ?? new Decimal(100),
      eps: config.eps ?? new Decimal(0.01),
      longOnly: config.longOnly ?? true,
    };
  }

  async onStart(context: StrategyContext): Promise<void> {
    // Load latest mapping
    const mapping = await this.mappingService.getLatestMapping();
    this.currentMapping = {
      version: mapping.version,
      relations: this.mappingService.getFilteredRelations(mapping),
    };
  }

  async onTick(context: StrategyContext): Promise<Signal[]> {
    const signals: Signal[] = [];
    const stateStore = context.stateStore;

    if (!this.currentMapping) {
      return signals;
    }

    // Process complement pairs
    const complementPairs = this.currentMapping.relations.filter(
      (r) => r.kind === 'complementPair'
    ) as Array<Extract<MappingRelation, { kind: 'complementPair' }>>;

    for (const rel of complementPairs) {
      const signalsForPair = this.checkComplementPair(rel, stateStore);
      signals.push(...signalsForPair);
    }

    // Process mutually exclusive sets
    const exclusiveSets = this.currentMapping.relations.filter(
      (r) => r.kind === 'mutuallyExclusiveSet'
    ) as Array<Extract<MappingRelation, { kind: 'mutuallyExclusiveSet' }>>;

    for (const rel of exclusiveSets) {
      const signalsForSet = this.checkMutuallyExclusiveSet(rel, stateStore);
      signals.push(...signalsForSet);
    }

    // Fallback: check intra-market structure if no mappings available
    if (complementPairs.length === 0 && exclusiveSets.length === 0) {
      const fallbackSignals = this.checkIntraMarketStructure(stateStore);
      signals.push(...fallbackSignals);
    }

    return signals;
  }

  private checkComplementPair(
    rel: Extract<MappingRelation, { kind: 'complementPair' }>,
    stateStore: StrategyContext['stateStore']
  ): Signal[] {
    const signals: Signal[] = [];
    const { yesTokenId, noTokenId, confidence } = rel;

    const yesFeatures = stateStore.getDerivedFeatures(yesTokenId);
    const noFeatures = stateStore.getDerivedFeatures(noTokenId);
    const yesBook = stateStore.getOrderBook(yesTokenId);
    const noBook = stateStore.getOrderBook(noTokenId);

    if (!yesFeatures.midPrice || !noFeatures.midPrice || !yesBook || !noBook) {
      return signals;
    }

    // Check spread constraints
    if (
      yesFeatures.spreadBps &&
      noFeatures.spreadBps &&
      (yesFeatures.spreadBps.gt(this.config.maxSpreadBps) ||
        noFeatures.spreadBps.gt(this.config.maxSpreadBps))
    ) {
      return signals;
    }

    // Check book depth
    if (
      yesFeatures.bidDepth.lt(this.config.minBookDepth) ||
      yesFeatures.askDepth.lt(this.config.minBookDepth) ||
      noFeatures.bidDepth.lt(this.config.minBookDepth) ||
      noFeatures.askDepth.lt(this.config.minBookDepth)
    ) {
      return signals;
    }

    // Compute violation: p_yes + p_no should ≈ 1
    const sum = yesFeatures.midPrice.plus(noFeatures.midPrice);
    const violation = sum.minus(1);

    // Convert to basis points
    const violationBps = violation.times(10000);

    if (violation.abs().lt(this.config.eps)) {
      return signals; // No significant violation
    }

    // Calculate costs
    const feeBps = 200; // 2% fee = 200 bps
    const spreadImpactBps = yesFeatures.spreadBps
      ? yesFeatures.spreadBps.plus(noFeatures.spreadBps || 0).div(2).toNumber()
      : 100;
    const slippageImpactBps = this.config.maxSlippageBps;

    const netEdgeBps = violationBps.abs().minus(feeBps).minus(spreadImpactBps).minus(slippageImpactBps);

    if (netEdgeBps.lt(this.config.minEdgeBps)) {
      return signals; // Insufficient edge
    }

    // Determine trade direction
    if (violation.gt(0)) {
      // Overpriced: sum > 1
      // Identify overpriced side
      const yesOverpriced = yesFeatures.midPrice.gt(noFeatures.midPrice);
      const overpricedToken = yesOverpriced ? yesTokenId : noTokenId;
      const underpricedToken = yesOverpriced ? noTokenId : yesTokenId;
      const overpricedBook = yesOverpriced ? yesBook : noBook;
      const underpricedBook = yesOverpriced ? noBook : yesBook;

      if (!this.config.longOnly && overpricedBook.asks.length > 0) {
        // SELL overpriced (if shorting allowed)
        signals.push(this.createSignal({
          tokenId: overpricedToken,
          side: 'sell',
          book: overpricedBook,
          features: yesOverpriced ? yesFeatures : noFeatures,
          edgeBps: netEdgeBps,
          rationale: {
            mappingVersion: this.currentMapping!.version,
            relationKind: 'complementPair',
            confidence,
            violation: violation.toString(),
            pairedTokenId: underpricedToken,
            type: 'overpriced',
          },
        }));
      }

      // BUY underpriced (always allowed in long-only)
      if (underpricedBook.bids.length > 0) {
        signals.push(this.createSignal({
          tokenId: underpricedToken,
          side: 'buy',
          book: underpricedBook,
          features: yesOverpriced ? noFeatures : yesFeatures,
          edgeBps: netEdgeBps,
          rationale: {
            mappingVersion: this.currentMapping!.version,
            relationKind: 'complementPair',
            confidence,
            violation: violation.toString(),
            pairedTokenId: overpricedToken,
            type: 'underpriced',
          },
        }));
      }
    } else {
      // Underpriced: sum < 1
      // Both are underpriced, buy the more underpriced one
      const yesUnderpriced = yesFeatures.midPrice.lt(noFeatures.midPrice);
      const moreUnderpricedToken = yesUnderpriced ? yesTokenId : noTokenId;
      const moreUnderpricedBook = yesUnderpriced ? yesBook : noBook;
      const moreUnderpricedFeatures = yesUnderpriced ? yesFeatures : noFeatures;

      if (moreUnderpricedBook.bids.length > 0) {
        signals.push(this.createSignal({
          tokenId: moreUnderpricedToken,
          side: 'buy',
          book: moreUnderpricedBook,
          features: moreUnderpricedFeatures,
          edgeBps: netEdgeBps,
          rationale: {
            mappingVersion: this.currentMapping!.version,
            relationKind: 'complementPair',
            confidence,
            violation: violation.toString(),
            pairedTokenId: yesUnderpriced ? noTokenId : yesTokenId,
            type: 'underpriced',
          },
        }));
      }
    }

    return signals;
  }

  private checkMutuallyExclusiveSet(
    rel: Extract<MappingRelation, { kind: 'mutuallyExclusiveSet' }>,
    stateStore: StrategyContext['stateStore']
  ): Signal[] {
    const signals: Signal[] = [];
    const { tokenIds, confidence } = rel;

    // Collect prices and features
    const prices: Array<{
      tokenId: string;
      price: Decimal;
      features: DerivedFeatures;
      book: ReturnType<typeof stateStore.getOrderBook>;
    }> = [];

    for (const tokenId of tokenIds) {
      const features = stateStore.getDerivedFeatures(tokenId);
      const book = stateStore.getOrderBook(tokenId);

      if (!features.midPrice || !book) {
        continue;
      }

      // Check spread and depth constraints
      if (
        features.spreadBps &&
        features.spreadBps.gt(this.config.maxSpreadBps)
      ) {
        continue;
      }

      if (
        features.bidDepth.lt(this.config.minBookDepth) ||
        features.askDepth.lt(this.config.minBookDepth)
      ) {
        continue;
      }

      prices.push({ tokenId, price: features.midPrice, features, book });
    }

    if (prices.length < 2) {
      return signals;
    }

    // Compute sum and normalized probabilities
    const sum = prices.reduce((s, p) => s.plus(p.price), new Decimal(0));
    const violation = sum.minus(1);

    if (violation.abs().lt(this.config.eps)) {
      return signals; // No violation
    }

    // Normalize to get fair probabilities
    const normalizedPrices = prices.map((p) => ({
      ...p,
      normalizedPrice: p.price.div(sum),
    }));

    // Find mispriced outcomes
    for (const item of normalizedPrices) {
      const mispricing = item.price.minus(item.normalizedPrice);
      const misBps = mispricing.times(10000);

      // Calculate net edge
      const feeBps = 200;
      const spreadBps = item.features.spreadBps
        ? item.features.spreadBps.toNumber()
        : 100;
      const slippageBps = this.config.maxSlippageBps;
      const netEdgeBps = misBps.abs().minus(feeBps).minus(spreadBps).minus(slippageBps);

      if (netEdgeBps.lt(this.config.minEdgeBps)) {
        continue;
      }

      // Generate signal
      if (mispricing.gt(0) && !this.config.longOnly && item.book.asks.length > 0) {
        // Overpriced: SELL (if shorting allowed)
        signals.push(this.createSignal({
          tokenId: item.tokenId,
          side: 'sell',
          book: item.book,
          features: item.features,
          edgeBps: netEdgeBps,
          rationale: {
            mappingVersion: this.currentMapping!.version,
            relationKind: 'mutuallyExclusiveSet',
            confidence,
            mispricing: mispricing.toString(),
            normalizedPrice: item.normalizedPrice.toString(),
            setSize: tokenIds.length,
            type: 'overpriced',
          },
        }));
      } else if (mispricing.lt(0) && item.book.bids.length > 0) {
        // Underpriced: BUY
        signals.push(this.createSignal({
          tokenId: item.tokenId,
          side: 'buy',
          book: item.book,
          features: item.features,
          edgeBps: netEdgeBps,
          rationale: {
            mappingVersion: this.currentMapping!.version,
            relationKind: 'mutuallyExclusiveSet',
            confidence,
            mispricing: mispricing.toString(),
            normalizedPrice: item.normalizedPrice.toString(),
            setSize: tokenIds.length,
            type: 'underpriced',
          },
        }));
      }
    }

    return signals;
  }

  private checkIntraMarketStructure(
    stateStore: StrategyContext['stateStore']
  ): Signal[] {
    // Fallback: check markets with exactly 2 outcomes (likely complement)
    const signals: Signal[] = [];
    const universe = stateStore.getUniverse();

    if (!universe) {
      return signals;
    }

    // This is a simplified fallback - in practice, you'd want more sophisticated detection
    // For now, return empty - rely on mapping service
    return signals;
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
      strategy: 'parity',
      tokenId,
      side,
      limitPrice: executablePrice,
      size,
      expectedEdgeBps: edgeBps,
      confidence: new Decimal(rationale.confidence || 0.8),
      ttlMs: 60000, // 1 minute TTL
      createdAt: Date.now(),
      rationale,
    };
  }

  async onFill(_fill: unknown, _context: StrategyContext): Promise<void> {
    // No special handling needed
  }

  async onStop(): Promise<void> {
    // Cleanup
  }
}

