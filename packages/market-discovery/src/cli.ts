#!/usr/bin/env node
import { Command } from 'commander';
import { MarketDiscoveryAgent } from './discovery-agent.js';
import { OpenAIEmbeddingService } from './embedding-service.js';
import { getConfig } from '@pm-bot/config';
import pino from 'pino';

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

const program = new Command();

program
  .name('market-discovery')
  .description('AI agent for discovering equivalent markets')
  .version('1.0.0');

program
  .command('discover')
  .description('Run one-time market discovery and update mappings')
  .option('--openai-key <key>', 'OpenAI API key (or set OPENAI_API_KEY env var)')
  .option('--similarity-threshold <number>', 'Similarity threshold (0-1)', '0.82')
  .option('--config-path <path>', 'Path to market-mappings.json', 'config/market-mappings.json')
  .action(async (options) => {
    const apiKey =
      options.openaiKey ||
      process.env.OPENAI_API_KEY ||
      (getConfig() as { OPENAI_API_KEY?: string }).OPENAI_API_KEY;

    if (!apiKey) {
      console.error(
        'OpenAI API key required. Set OPENAI_API_KEY env var or use --openai-key'
      );
      process.exit(1);
    }

    logger.info('Starting market discovery...');

    try {
      const embeddingService = new OpenAIEmbeddingService(apiKey);
      const agent = new MarketDiscoveryAgent(embeddingService, options.configPath);

      if (options.similarityThreshold) {
        agent.setSimilarityThreshold(parseFloat(options.similarityThreshold));
      }

      const result = await agent.discoverAndUpdate();

      logger.info(
        {
          marketsScanned: result.marketsScanned,
          matchesFound: result.matchesFound,
          mappingsAdded: result.mappingsAdded,
          mappingsSkipped: result.mappingsSkipped,
          totalMappings: result.totalMappings,
        },
        'Market discovery completed'
      );

      // Print summary
      console.log('\n=== Market Discovery Results ===');
      console.log(`Markets scanned: ${result.marketsScanned}`);
      console.log(`Matches found: ${result.matchesFound}`);
      console.log(`Mappings added: ${result.mappingsAdded}`);
      console.log(`Mappings skipped (duplicates): ${result.mappingsSkipped}`);
      console.log(`Total mappings: ${result.totalMappings}`);

      if (result.matches.length > 0) {
        console.log('\n=== Top Matches ===');
        const topMatches = result.matches.slice(0, 10);
        for (const match of topMatches) {
          console.log(
            `[${match.type}] ${match.similarity.toFixed(3)}: "${match.market1.question}" (${match.outcome1}) <-> "${match.market2.question}" (${match.outcome2})`
          );
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Market discovery failed');
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();

