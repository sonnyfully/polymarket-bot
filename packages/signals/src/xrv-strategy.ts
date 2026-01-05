import { getConfig } from '@pm-bot/config';
import type { Strategy, Signal, StrategyContext } from './strategy-harness.js';
import type { DerivedFeatures } from '@pm-bot/core';
import type { MappingService, MappingRelation } from '@pm-bot/market-discovery';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';

export interface XRVStrategyConfig {
  minEdgeBps: number; // Minimum edge in basis points (default 100 = 1%)
  maxSpreadBps: number; // Maximum spread to trade (default 200 = 2%)
  maxSlippageBps: number; // Maximum acceptable slippage (default 50 = 0.5%)
  minBookDepth: Decimal; // Minimum book depth
  thresholdBps: number; // Price divergence threshold (default 50 = 0.5%)
  relationCooldownMs: number; // Cooldown between trades on same relation (default 5 minutes)
  longOnly: boolean; // If true, only buy underpriced, don't sell overpriced
  relationErrorThreshold: number; // Disable relation after N negative trades (default 5)
}

interface RelationTradeRecord {
  lastTradeTime: number;
  tradeCount: number;
  pnlSum: Decimal;
  disabled: boolean;
}

export class XRVStrategy implements Strategy {
  name = 'xrv';
  private mappingService: MappingService;
  private config: XRVStrategyConfig;
  private currentMapping: { version: string; relations: MappingRelation[] } | null = null;
  private relationRecords: Map<string, RelationTradeRecord> = new Map();

  constructor(mappingService: MappingService, config: Partial<XRVStrategyConfig> = {}) {
    this.mappingService = mappingService;
    const envConfig = getConfig();
    this.config = {
      minEdgeBps: config.minEdgeBps ?? 100,
      maxSpreadBps: config.maxSpreadBps ?? 200,
      maxSlippageBps: config.maxSlippageBps ?? 50,
      minBookDepth: config.minBookDepth ?? new Decimal(100),
      thresholdBps: config.thresholdBps ?? 50,
      relationCooldownMs: config.relationCooldownMs ?? 5 * 60 * 1000,
      longOnly: config.longOnly ?? true,
      relationErrorThreshold: config.relationErrorThreshold ?? 5,
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

    // Process equivalent relations
    const equivalentRels = this.currentMapping.relations.filter(
      (r) => r.kind === 'equivalent'
    ) as Array<Extract<MappingRelation, { kind: 'equivalent' }>>;

    for (const rel of equivalentRels) {
      if (this.isRelationDisabled(rel)) {
        continue;
      }

      if (this.isRelationOnCooldown(rel)) {
        continue;
      }

      const signalsForRel = this.checkEquivalentRelation(rel, stateStore);
      signals.push(...signalsForRel);
    }

    // Process inverse relations
    const inverseRels = this.currentMapping.relations.filter(
      (r) => r.kind === 'inverse'
    ) as Array<Extract<MappingRelation, { kind: 'inverse' }>>;

    for (const rel of inverseRels) {
      if (this.isRelationDisabled(rel)) {
        continue;
      }

      if (this.isRelationOnCooldown(rel)) {
        continue;
      }

      const signalsForRel = this.checkInverseRelation(rel, stateStore);
      signals.push(...signalsForRel);
    }

    return signals;
  }

  private checkEquivalentRelation(
    rel: Extract<MappingRelation, { kind: 'equivalent' }>,
    stateStore: StrategyContext['stateStore']
  ): Signal[] {
    const signals: Signal[] = [];
    const { aTokenId, bTokenId, confidence } = rel;

    const aFeatures = stateStore.getDerivedFeatures(aTokenId);
    const bFeatures = stateStore.getDerivedFeatures(bTokenId);
    const aBook = stateStore.getOrderBook(aTokenId);
    const bBook = stateStore.getOrderBook(bTokenId);

    if (!aFeatures.midPrice || !bFeatures.midPrice || !aBook || !bBook) {
      return signals;
    }

    // Check spread constraints
    if (
      aFeatures.spreadBps &&
      bFeatures.spreadBps &&
      (aFeatures.spreadBps.gt(this.config.maxSpreadBps) ||
        bFeatures.spreadBps.gt(this.config.maxSpreadBps))
    ) {
      return signals;
    }

    // Check book depth
    if (
      aFeatures.bidDepth.lt(this.config.minBookDepth) ||
      aFeatures.askDepth.lt(this.config.minBookDepth) ||
      bFeatures.bidDepth.lt(this.config.minBookDepth) ||
      bFeatures.askDepth.lt(this.config.minBookDepth)
    ) {
      return signals;
    }

    // Get executable prices
    const aBuyPx = aBook.asks[0]?.price || aFeatures.midPrice;
    const aSellPx = aBook.bids[0]?.price || aFeatures.midPrice;
    const bBuyPx = bBook.asks[0]?.price || bFeatures.midPrice;
    const bSellPx = bBook.bids[0]?.price || bFeatures.midPrice;

    // Compute price divergence
    const pA = aFeatures.midPrice;
    const pB = bFeatures.midPrice;
    const divergence = pA.minus(pB).abs();
    const divergenceBps = divergence.times(10000);

    if (divergenceBps.lt(this.config.thresholdBps)) {
      return signals; // Not enough divergence
    }

    // Determine trade direction
    const aOverpriced = pA.gt(pB);
    const cheaperToken = aOverpriced ? bTokenId : aTokenId;
    const expensiveToken = aOverpriced ? aTokenId : bTokenId;
    const cheaperBook = aOverpriced ? bBook : aBook;
    const expensiveBook = aOverpriced ? aBook : bBook;
    const cheaperFeatures = aOverpriced ? bFeatures : aFeatures;
    const expensiveFeatures = aOverpriced ? aFeatures : bFeatures;

    // Calculate convergence target (conservative: average)
    const convergenceTarget = pA.plus(pB).div(2);

    // Calculate net edge
    const entryPrice = aOverpriced ? bBuyPx : aBuyPx;
    const exitPrice = convergenceTarget; // Assume convergence at average
    const grossEdge = exitPrice.minus(entryPrice).abs();
    const grossEdgeBps = grossEdge.times(10000);

    const feeBps = 200; // 2% fee (entry + exit)
    const spreadBps = cheaperFeatures.spreadBps
      ? cheaperFeatures.spreadBps.toNumber()
      : 100;
    const slippageBps = this.config.maxSlippageBps;
    const netEdgeBps = grossEdgeBps.minus(feeBps).minus(spreadBps).minus(slippageBps);

    if (netEdgeBps.lt(this.config.minEdgeBps)) {
      return signals; // Insufficient edge
    }

    // Generate signal: BUY cheaper token
    if (cheaperBook.bids.length > 0) {
      signals.push(this.createSignal({
        tokenId: cheaperToken,
        side: 'buy',
        book: cheaperBook,
        features: cheaperFeatures,
        edgeBps: netEdgeBps,
        rationale: {
          mappingVersion: this.currentMapping!.version,
          relationKind: 'equivalent',
          confidence,
          aTokenId,
          bTokenId,
          pA: pA.toString(),
          pB: pB.toString(),
          divergenceBps: divergenceBps.toString(),
          convergenceTarget: convergenceTarget.toString(),
          pairedTokenId: expensiveToken,
          type: 'equivalent_underpriced',
        },
      }));
    }

    // If shorting allowed, also SELL expensive token
    if (!this.config.longOnly && expensiveBook.asks.length > 0) {
      signals.push(this.createSignal({
        tokenId: expensiveToken,
        side: 'sell',
        book: expensiveBook,
        features: expensiveFeatures,
        edgeBps: netEdgeBps,
        rationale: {
          mappingVersion: this.currentMapping!.version,
          relationKind: 'equivalent',
          confidence,
          aTokenId,
          bTokenId,
          pA: pA.toString(),
          pB: pB.toString(),
          divergenceBps: divergenceBps.toString(),
          convergenceTarget: convergenceTarget.toString(),
          pairedTokenId: cheaperToken,
          type: 'equivalent_overpriced',
        },
      }));
    }

    return signals;
  }

  private checkInverseRelation(
    rel: Extract<MappingRelation, { kind: 'inverse' }>,
    stateStore: StrategyContext['stateStore']
  ): Signal[] {
    const signals: Signal[] = [];
    const { aTokenId, bTokenId, confidence } = rel;

    const aFeatures = stateStore.getDerivedFeatures(aTokenId);
    const bFeatures = stateStore.getDerivedFeatures(bTokenId);
    const aBook = stateStore.getOrderBook(aTokenId);
    const bBook = stateStore.getOrderBook(bTokenId);

    if (!aFeatures.midPrice || !bFeatures.midPrice || !aBook || !bBook) {
      return signals;
    }

    // Check spread and depth constraints
    if (
      aFeatures.spreadBps &&
      bFeatures.spreadBps &&
      (aFeatures.spreadBps.gt(this.config.maxSpreadBps) ||
        bFeatures.spreadBps.gt(this.config.maxSpreadBps))
    ) {
      return signals;
    }

    if (
      aFeatures.bidDepth.lt(this.config.minBookDepth) ||
      aFeatures.askDepth.lt(this.config.minBookDepth) ||
      bFeatures.bidDepth.lt(this.config.minBookDepth) ||
      bFeatures.askDepth.lt(this.config.minBookDepth)
    ) {
      return signals;
    }

    // Fair relationship: pA ≈ 1 - pB, so pA + pB ≈ 1
    const pA = aFeatures.midPrice;
    const pB = bFeatures.midPrice;
    const delta = pA.plus(pB).minus(1);
    const deltaBps = delta.times(10000);

    if (delta.abs().times(10000).lt(this.config.thresholdBps)) {
      return signals; // No significant violation
    }

    // Calculate net edge
    const feeBps = 200;
    const spreadBps = aFeatures.spreadBps
      ? aFeatures.spreadBps.plus(bFeatures.spreadBps || 0).div(2).toNumber()
      : 100;
    const slippageBps = this.config.maxSlippageBps;
    const netEdgeBps = deltaBps.abs().minus(feeBps).minus(spreadBps).minus(slippageBps);

    if (netEdgeBps.lt(this.config.minEdgeBps)) {
      return signals;
    }

    // Determine trade direction
    if (delta.gt(0)) {
      // Both collectively overpriced (pA + pB > 1)
      // Buy the cheaper implied leg
      const aImplied = pA;
      const bImplied = new Decimal(1).minus(pB);
      const cheaperToken = aImplied.lt(bImplied) ? aTokenId : bTokenId;
      const cheaperBook = aImplied.lt(bImplied) ? aBook : bBook;
      const cheaperFeatures = aImplied.lt(bImplied) ? aFeatures : bFeatures;

      if (cheaperBook.bids.length > 0) {
        signals.push(this.createSignal({
          tokenId: cheaperToken,
          side: 'buy',
          book: cheaperBook,
          features: cheaperFeatures,
          edgeBps: netEdgeBps,
          rationale: {
            mappingVersion: this.currentMapping!.version,
            relationKind: 'inverse',
            confidence,
            aTokenId,
            bTokenId,
            pA: pA.toString(),
            pB: pB.toString(),
            delta: delta.toString(),
            pairedTokenId: aImplied.lt(bImplied) ? bTokenId : aTokenId,
            type: 'inverse_underpriced',
          },
        }));
      }
    } else {
      // Both collectively underpriced (pA + pB < 1)
      // Buy the cheaper implied leg
      const aImplied = pA;
      const bImplied = new Decimal(1).minus(pB);
      const cheaperToken = aImplied.lt(bImplied) ? aTokenId : bTokenId;
      const cheaperBook = aImplied.lt(bImplied) ? aBook : bBook;
      const cheaperFeatures = aImplied.lt(bImplied) ? aFeatures : bFeatures;

      if (cheaperBook.bids.length > 0) {
        signals.push(this.createSignal({
          tokenId: cheaperToken,
          side: 'buy',
          book: cheaperBook,
          features: cheaperFeatures,
          edgeBps: netEdgeBps,
          rationale: {
            mappingVersion: this.currentMapping!.version,
            relationKind: 'inverse',
            confidence,
            aTokenId,
            bTokenId,
            pA: pA.toString(),
            pB: pB.toString(),
            delta: delta.toString(),
            pairedTokenId: aImplied.lt(bImplied) ? bTokenId : aTokenId,
            type: 'inverse_underpriced',
          },
        }));
      }
    }

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
      strategy: 'xrv',
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

  private isRelationDisabled(rel: MappingRelation): boolean {
    const key = this.getRelationKey(rel);
    const record = this.relationRecords.get(key);
    return record?.disabled || false;
  }

  private isRelationOnCooldown(rel: MappingRelation): boolean {
    const key = this.getRelationKey(rel);
    const record = this.relationRecords.get(key);
    if (!record) {
      return false;
    }

    const now = Date.now();
    return now - record.lastTradeTime < this.config.relationCooldownMs;
  }

  private getRelationKey(rel: MappingRelation): string {
    if (rel.kind === 'equivalent' || rel.kind === 'inverse') {
      return `${rel.kind}:${rel.aTokenId}:${rel.bTokenId}`;
    }
    return `${rel.kind}:${JSON.stringify(rel)}`;
  }

  async onFill(fill: unknown, _context: StrategyContext): Promise<void> {
    // Track relation performance
    // This is a simplified version - in a full implementation, you'd track PnL per relation
    // and disable relations that consistently lose money
    const fillObj = fill as { tokenId: string; price: Decimal; side: 'buy' | 'sell' };
    
    // Find relation for this token
    if (!this.currentMapping) {
      return;
    }

    const relations = this.mappingService.listRelationsByToken(fillObj.tokenId, this.currentMapping);
    for (const rel of relations) {
      const key = this.getRelationKey(rel);
      const record = this.relationRecords.get(key) || {
        lastTradeTime: 0,
        tradeCount: 0,
        pnlSum: new Decimal(0),
        disabled: false,
      };

      record.lastTradeTime = Date.now();
      record.tradeCount++;

      // Simplified: assume negative if we can't compute PnL yet
      // In production, you'd compute actual PnL from position tracking
      if (record.tradeCount >= this.config.relationErrorThreshold && record.pnlSum.lt(0)) {
        record.disabled = true;
      }

      this.relationRecords.set(key, record);
    }
  }

  async onStop(): Promise<void> {
    // Cleanup
  }
}

