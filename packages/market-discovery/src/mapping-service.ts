import { createHash } from 'crypto';
import type { MarketMatch } from './market-matcher.js';
import { MarketDiscoveryAgent } from './discovery-agent.js';
import { MappingUpdater } from './mapping-updater.js';
import type { EmbeddingService } from './embedding-service.js';
import { GammaClient } from '@pm-bot/polymarket';

// Local type to avoid circular dependency with @pm-bot/signals
interface MarketMapping {
  markets: Array<{
    marketId: string;
    tokenId: string;
    weight: number;
  }>;
  type: 'equivalent' | 'complement' | 'parity';
}

export type MappingRelation =
  | { kind: 'equivalent'; aTokenId: string; bTokenId: string; confidence: number }
  | { kind: 'inverse'; aTokenId: string; bTokenId: string; confidence: number } // P(a)=1-P(b)
  | { kind: 'mutuallyExclusiveSet'; tokenIds: string[]; confidence: number } // sum probs ≈ 1
  | { kind: 'complementPair'; yesTokenId: string; noTokenId: string; confidence: number };

export interface MappingResult {
  version: string; // hash of mapping outputs + prompt version + timestamp bucket
  generatedAt: number;
  relations: MappingRelation[];
  universeKey?: string; // optional key to identify market universe
}

export interface MappingServiceConfig {
  minConfidence: number; // default 0.80
  stalenessHours: number; // default 24
  cachePath?: string;
}

export class MappingService {
  private discoveryAgent: MarketDiscoveryAgent;
  private mappingUpdater: MappingUpdater;
  private gammaClient: GammaClient;
  private config: MappingServiceConfig;
  private cache: Map<string, MappingResult> = new Map();
  private lastRefresh: Map<string, number> = new Map();

  constructor(
    embeddingService: EmbeddingService,
    config: Partial<MappingServiceConfig> = {}
  ) {
    this.config = {
      minConfidence: config.minConfidence ?? 0.80,
      stalenessHours: config.stalenessHours ?? 24,
      cachePath: config.cachePath,
    };
    this.gammaClient = new GammaClient();
    this.mappingUpdater = new MappingUpdater(this.config.cachePath);
    this.discoveryAgent = new MarketDiscoveryAgent(embeddingService, this.config.cachePath);
  }

  /**
   * Get the latest mapping for a universe, refreshing if stale
   */
  async getLatestMapping(universeKey: string = 'default'): Promise<MappingResult> {
    const now = Date.now();
    const lastRefreshTime = this.lastRefresh.get(universeKey) || 0;
    const stalenessMs = this.config.stalenessHours * 60 * 60 * 1000;

    // Check cache first
    const cached = this.cache.get(universeKey);
    if (cached && (now - cached.generatedAt) < stalenessMs) {
      return cached;
    }

    // Refresh if stale or missing
    const result = await this.refreshMapping(universeKey);
    return result;
  }

  /**
   * Get a specific mapping version
   */
  getMappingAt(version: string): MappingResult | null {
    for (const result of this.cache.values()) {
      if (result.version === version) {
        return result;
      }
    }
    return null;
  }

  /**
   * List all relations involving a specific token
   */
  listRelationsByToken(
    tokenId: string,
    mapping?: MappingResult
  ): MappingRelation[] {
    const targetMapping = mapping || Array.from(this.cache.values())[0];
    if (!targetMapping) {
      return [];
    }

    return targetMapping.relations.filter((rel) => {
      switch (rel.kind) {
        case 'equivalent':
        case 'inverse':
          return rel.aTokenId === tokenId || rel.bTokenId === tokenId;
        case 'complementPair':
          return rel.yesTokenId === tokenId || rel.noTokenId === tokenId;
        case 'mutuallyExclusiveSet':
          return rel.tokenIds.includes(tokenId);
        default:
          return false;
      }
    });
  }

  /**
   * Refresh mapping by running discovery
   */
  private async refreshMapping(universeKey: string): Promise<MappingResult> {
    const discoveryResult = await this.discoveryAgent.discoverAndUpdate();
    const existingMappings = await this.mappingUpdater.getExistingMappings();

    // Convert MarketMatch[] and MarketMapping[] to MappingRelation[]
    const relations: MappingRelation[] = [];

    // Process discovery matches (from MarketMatcher)
    for (const match of discoveryResult.matches) {
      const confidence = match.similarity;

      if (confidence < this.config.minConfidence) {
        continue;
      }

      if (match.type === 'equivalent') {
        relations.push({
          kind: 'equivalent',
          aTokenId: match.tokenId1,
          bTokenId: match.tokenId2,
          confidence,
        });
      } else if (match.type === 'parity') {
        // Parity within same market = complement pair
        if (match.market1.id === match.market2.id) {
          relations.push({
            kind: 'complementPair',
            yesTokenId: match.tokenId1,
            noTokenId: match.tokenId2,
            confidence,
          });
        }
      }
    }

    // Process existing mappings (from config file)
    for (const mapping of existingMappings) {
      if (mapping.type === 'equivalent' && mapping.markets.length === 2) {
        relations.push({
          kind: 'equivalent',
          aTokenId: mapping.markets[0].tokenId,
          bTokenId: mapping.markets[1].tokenId,
          confidence: 1.0, // Config file mappings are trusted
        });
      } else if (mapping.type === 'parity' && mapping.markets.length === 2) {
        relations.push({
          kind: 'complementPair',
          yesTokenId: mapping.markets[0].tokenId,
          noTokenId: mapping.markets[1].tokenId,
          confidence: 1.0,
        });
      } else if (mapping.type === 'parity' && mapping.markets.length > 2) {
        relations.push({
          kind: 'mutuallyExclusiveSet',
          tokenIds: mapping.markets.map((m) => m.tokenId),
          confidence: 1.0,
        });
      }
    }

    // Deduplicate relations
    const uniqueRelations = this.deduplicateRelations(relations);

    // Generate version hash
    const version = this.generateVersion(uniqueRelations, discoveryResult.matches.length);

    const result: MappingResult = {
      version,
      generatedAt: Date.now(),
      relations: uniqueRelations,
      universeKey,
    };

    this.cache.set(universeKey, result);
    this.lastRefresh.set(universeKey, Date.now());

    return result;
  }

  /**
   * Deduplicate relations (keep highest confidence)
   */
  private deduplicateRelations(relations: MappingRelation[]): MappingRelation[] {
    const seen = new Map<string, MappingRelation>();

    for (const rel of relations) {
      const key = this.getRelationKey(rel);
      const existing = seen.get(key);

      if (!existing || rel.confidence > existing.confidence) {
        seen.set(key, rel);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Generate a unique key for a relation
   */
  private getRelationKey(rel: MappingRelation): string {
    switch (rel.kind) {
      case 'equivalent':
      case 'inverse':
        const tokens = [rel.aTokenId, rel.bTokenId].sort().join(':');
        return `${rel.kind}:${tokens}`;
      case 'complementPair':
        const pair = [rel.yesTokenId, rel.noTokenId].sort().join(':');
        return `${rel.kind}:${pair}`;
      case 'mutuallyExclusiveSet':
        const sorted = [...rel.tokenIds].sort().join(':');
        return `${rel.kind}:${sorted}`;
    }
  }

  /**
   * Generate version hash from relations and metadata
   */
  private generateVersion(relations: MappingRelation[], marketCount: number): string {
    const promptVersion = 'v1.0'; // Increment when prompt changes
    const timestampBucket = Math.floor(Date.now() / (60 * 60 * 1000)); // Hour bucket

    const data = {
      relations: relations.map((r) => this.getRelationKey(r)),
      marketCount,
      promptVersion,
      timestampBucket,
    };

    const hash = createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex').substring(0, 16);
  }

  /**
   * Check if mapping is stale
   */
  isStale(universeKey: string = 'default'): boolean {
    const lastRefreshTime = this.lastRefresh.get(universeKey) || 0;
    const stalenessMs = this.config.stalenessHours * 60 * 60 * 1000;
    return Date.now() - lastRefreshTime > stalenessMs;
  }

  /**
   * Get filtered relations (confidence >= minConfidence)
   */
  getFilteredRelations(mapping?: MappingResult): MappingRelation[] {
    const targetMapping = mapping || Array.from(this.cache.values())[0];
    if (!targetMapping) {
      return [];
    }

    return targetMapping.relations.filter(
      (r) => r.confidence >= this.config.minConfidence
    );
  }
}

