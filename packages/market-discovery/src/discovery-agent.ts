import { GammaClient } from '@pm-bot/polymarket';
import { MarketMatcher } from './market-matcher.js';
import { MappingUpdater } from './mapping-updater.js';
import type { EmbeddingService } from './embedding-service.js';
import type { MarketMatch } from './market-matcher.js';

export interface DiscoveryResult {
  marketsScanned: number;
  matchesFound: number;
  mappingsAdded: number;
  mappingsSkipped: number;
  totalMappings: number;
  matches: MarketMatch[];
}

export class MarketDiscoveryAgent {
  private gammaClient: GammaClient;
  private matcher: MarketMatcher;
  private updater: MappingUpdater;

  constructor(embeddingService: EmbeddingService, configPath?: string) {
    this.gammaClient = new GammaClient();
    this.matcher = new MarketMatcher(embeddingService);
    this.updater = new MappingUpdater(configPath);
  }

  async discoverAndUpdate(): Promise<DiscoveryResult> {
    // Get all active markets
    const universe = await this.gammaClient.buildMarketUniverse(true);
    const markets = Array.from(universe.markets.values());

    if (markets.length === 0) {
      return {
        marketsScanned: 0,
        matchesFound: 0,
        mappingsAdded: 0,
        mappingsSkipped: 0,
        totalMappings: 0,
        matches: [],
      };
    }

    // Find equivalent markets
    const matches = await this.matcher.findEquivalentMarkets(markets);

    // Update mappings file
    const { added, skipped, total } = await this.updater.updateMappings(matches);

    return {
      marketsScanned: markets.length,
      matchesFound: matches.length,
      mappingsAdded: added,
      mappingsSkipped: skipped,
      totalMappings: total,
      matches,
    };
  }

  setSimilarityThreshold(threshold: number): void {
    this.matcher.setSimilarityThreshold(threshold);
  }

  setComplementThreshold(threshold: number): void {
    this.matcher.setComplementThreshold(threshold);
  }
}

