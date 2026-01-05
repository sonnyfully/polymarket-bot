// Local type to avoid circular dependency
interface MarketMapping {
  markets: Array<{
    marketId: string;
    tokenId: string;
    weight: number;
  }>;
  type: 'equivalent' | 'complement' | 'parity';
}
import type { MarketMatch } from './market-matcher.js';
import fs from 'fs/promises';
import path from 'path';

export class MappingUpdater {
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath =
      configPath || path.join(process.cwd(), 'config', 'market-mappings.json');
  }

  async updateMappings(matches: MarketMatch[]): Promise<{
    added: number;
    skipped: number;
    total: number;
  }> {
    // Load existing mappings
    let existing: { mappings: MarketMapping[] } = { mappings: [] };
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      existing = JSON.parse(data);
    } catch {
      // File doesn't exist, start fresh
    }

    // Convert matches to mappings
    const newMappings: MarketMapping[] = matches.map((match) => ({
      type: match.type,
      markets: [
        {
          marketId: match.market1.id,
          tokenId: match.tokenId1,
          weight: 1.0,
        },
        {
          marketId: match.market2.id,
          tokenId: match.tokenId2,
          weight: 1.0,
        },
      ],
    }));

    // Merge with existing (avoid duplicates)
    const { merged, added, skipped } = this.mergeMappings(
      existing.mappings,
      newMappings
    );

    // Write back
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(
      this.configPath,
      JSON.stringify({ mappings: merged }, null, 2),
      'utf-8'
    );

    return {
      added,
      skipped,
      total: merged.length,
    };
  }

  private mergeMappings(
    existing: MarketMapping[],
    newMappings: MarketMapping[]
  ): {
    merged: MarketMapping[];
    added: number;
    skipped: number;
  } {
    const merged = [...existing];
    const existingKeys = new Set(
      existing.map((m) => this.getMappingKey(m))
    );

    let added = 0;
    let skipped = 0;

    for (const mapping of newMappings) {
      const key = this.getMappingKey(mapping);

      if (!existingKeys.has(key)) {
        merged.push(mapping);
        existingKeys.add(key);
        added++;
      } else {
        skipped++;
      }
    }

    return { merged, added, skipped };
  }

  private getMappingKey(mapping: MarketMapping): string {
    // Create a unique key for a mapping based on market+token pairs
    const pairs = mapping.markets
      .map((m) => `${m.marketId}:${m.tokenId}`)
      .sort()
      .join('|');
    return `${mapping.type}:${pairs}`;
  }

  async getExistingMappings(): Promise<MarketMapping[]> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(data) as { mappings: MarketMapping[] };
      return parsed.mappings || [];
    } catch {
      return [];
    }
  }
}

