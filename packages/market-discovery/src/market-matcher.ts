import type { GammaMarket } from '@pm-bot/polymarket';
import type { EmbeddingService } from './embedding-service.js';

export interface MarketMatch {
  market1: GammaMarket;
  market2: GammaMarket;
  outcome1: string;
  outcome2: string;
  tokenId1: string;
  tokenId2: string;
  similarity: number; // 0-1
  type: 'equivalent' | 'complement' | 'parity';
}

export interface MarketText {
  market: GammaMarket;
  outcome: string;
  tokenId: string;
  text: string;
  index: number;
}

export class MarketMatcher {
  private embeddingService: EmbeddingService;
  private similarityThreshold: number = 0.82; // Tuned for market matching
  private complementThreshold: number = 0.75; // Lower threshold for complementary markets

  constructor(embeddingService: EmbeddingService) {
    this.embeddingService = embeddingService;
  }

  async findEquivalentMarkets(
    markets: GammaMarket[]
  ): Promise<MarketMatch[]> {
    const matches: MarketMatch[] = [];

    // Prepare market texts with context
    const marketTexts: MarketText[] = [];

    for (const market of markets) {
      // Include market question and description for better context
      const marketContext = [
        market.question,
        market.description || '',
      ]
        .filter(Boolean)
        .join(' ');

      for (const outcome of market.outcomes) {
        // Combine market context with outcome for better matching
        const text = `${marketContext} ${outcome.outcome}`.trim();
        
        marketTexts.push({
          market,
          outcome: outcome.outcome,
          tokenId: outcome.clobTokenId,
          text,
          index: marketTexts.length,
        });
      }
    }

    if (marketTexts.length === 0) {
      return [];
    }

    // Compute embeddings for all market+outcome pairs
    const texts = marketTexts.map((m) => m.text);
    const embeddings = await this.embeddingService.embedBatch(texts);

    // Find similar pairs
    for (let i = 0; i < marketTexts.length; i++) {
      for (let j = i + 1; j < marketTexts.length; j++) {
        const similarity = this.cosineSimilarity(embeddings[i], embeddings[j]);

        if (similarity >= this.complementThreshold) {
          const m1 = marketTexts[i];
          const m2 = marketTexts[j];

          // Determine match type
          let type: MarketMatch['type'];
          if (m1.market.id === m2.market.id) {
            // Same market, different outcomes = parity
            type = 'parity';
          } else if (similarity >= this.similarityThreshold) {
            // High similarity, different markets = equivalent
            type = 'equivalent';
          } else {
            // Lower similarity but related = complement
            type = 'complement';
          }

          // Only include equivalent and parity matches (complement is less reliable)
          if (type === 'equivalent' || type === 'parity') {
            matches.push({
              market1: m1.market,
              market2: m2.market,
              outcome1: m1.outcome,
              outcome2: m2.outcome,
              tokenId1: m1.tokenId,
              tokenId2: m2.tokenId,
              similarity,
              type,
            });
          }
        }
      }
    }

    // Sort by similarity (highest first)
    matches.sort((a, b) => b.similarity - a.similarity);

    return matches;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  setSimilarityThreshold(threshold: number): void {
    this.similarityThreshold = threshold;
  }

  setComplementThreshold(threshold: number): void {
    this.complementThreshold = threshold;
  }
}

