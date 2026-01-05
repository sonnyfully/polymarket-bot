#!/usr/bin/env node
import { Command } from 'commander';
import { getConfig, validateLiveTrading } from '@pm-bot/config';
import { PolymarketRestClient } from '@pm-bot/polymarket';
import { Repository } from '@pm-bot/storage';
import { TradingBot } from './trading-bot.js';
import { MispricingStrategy, ArbitrageStrategy } from '@pm-bot/signals';
import { MarketDiscoveryAgent } from '@pm-bot/market-discovery';
import { OpenAIEmbeddingService } from '@pm-bot/market-discovery';
import { logger } from './logger.js';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import Decimal from 'decimal.js';

const program = new Command();

program
  .name('pm-bot')
  .description('Polymarket trading bot')
  .version('1.0.0');

program
  .command('run')
  .description('Run bot in paper trading mode (default)')
  .action(async () => {
    const config = getConfig();
    if (!config.SIMULATION_ONLY) {
      logger.warn('SIMULATION_ONLY is false, but running in paper mode. Use "live" command for live trading.');
    }

    const strategies = [
      new MispricingStrategy(),
      new ArbitrageStrategy(),
    ];

    const bot = new TradingBot(strategies);
    
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down...');
      await bot.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down...');
      await bot.stop();
      process.exit(0);
    });

    await bot.start();
  });

program
  .command('paper')
  .description('Run bot in paper trading mode (explicit)')
  .action(async () => {
    const strategies = [
      new MispricingStrategy(),
      new ArbitrageStrategy(),
    ];

    const bot = new TradingBot(strategies);
    
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down...');
      await bot.stop();
      process.exit(0);
    });

    await bot.start();
  });

program
  .command('live')
  .description('Run bot in live trading mode (requires LIVE_TRADING=true)')
  .action(async () => {
    try {
      validateLiveTrading();
    } catch (error) {
      logger.error({ err: error }, 'Live trading validation failed');
      process.exit(1);
    }

    // Confirmation prompt
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('Are you sure you want to enable LIVE TRADING? (yes/no): ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'yes') {
      logger.info('Live trading cancelled');
      process.exit(0);
    }

    logger.warn('LIVE TRADING ENABLED - Real money at risk!');

    const strategies = [
      new MispricingStrategy(),
      new ArbitrageStrategy(),
    ];

    const bot = new TradingBot(strategies);
    
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down...');
      await bot.stop();
      process.exit(0);
    });

    await bot.start();
  });

program
  .command('data:sync')
  .description('Sync markets, order books, and trades from API')
  .option('--markets', 'Sync markets')
  .option('--books', 'Sync order books')
  .option('--trades', 'Sync recent trades')
  .action(async (options: { markets?: boolean; books?: boolean; trades?: boolean }) => {
    const restClient = new PolymarketRestClient();
    const repository = new Repository();

    if (options.markets || (!options.markets && !options.books && !options.trades)) {
      logger.info('Syncing markets...');
      const markets = await restClient.getMarkets(true);
      for (const market of markets) {
        await repository.upsertMarket(market);
      }
      logger.info({ count: markets.length }, 'Markets synced');
    }

    if (options.books) {
      logger.info('Syncing order books...');
      const markets = await repository.getMarkets(true);
      for (const market of markets) {
        for (const outcome of market.outcomes) {
          try {
            const book = await restClient.getOrderBook(outcome.tokenId);
            book.marketId = market.id;
            await repository.saveOrderBookSnapshot(book);
          } catch (err) {
            logger.error({ err, tokenId: outcome.tokenId }, 'Failed to sync order book');
          }
        }
      }
      logger.info('Order books synced');
    }

    if (options.trades) {
      logger.info('Syncing trades...');
      const markets = await repository.getMarkets(true);
      for (const market of markets) {
        for (const outcome of market.outcomes) {
          try {
            const trades = await restClient.getRecentTrades(outcome.tokenId, 100);
            for (const trade of trades) {
              trade.marketId = market.id;
              await repository.saveTrade(trade);
            }
          } catch (err) {
            logger.error({ err, tokenId: outcome.tokenId }, 'Failed to sync trades');
          }
        }
      }
      logger.info('Trades synced');
    }

    await repository.disconnect();
  });

program
  .command('research:mispricing')
  .description('Scan for mispricing opportunities')
  .option('--threshold <number>', 'Mispricing threshold', '0.02')
  .action(async (options) => {
    const restClient = new PolymarketRestClient();
    const repository = new Repository();

    logger.info('Scanning for mispricing opportunities...');
    const markets = await repository.getMarkets(true);
    const opportunities: Array<{
      market: string;
      tokenId: string;
      currentPrice: string;
      fairValue: string;
      mispricing: string;
      edge: string;
    }> = [];

    for (const market of markets) {
      for (const outcome of market.outcomes) {
        try {
          const book = await restClient.getOrderBook(outcome.tokenId);
          const midPrice = book.bids.length > 0 && book.asks.length > 0
            ? book.bids[0].price.plus(book.asks[0].price).div(2)
            : null;

          if (!midPrice) continue;

          // Simple fair value: use mid price as placeholder
          // In production, this would use the strategy's fair value calculation
          const fairValue = midPrice; // Simplified
          const mispricing = midPrice.minus(fairValue).abs();
          const threshold = new Decimal(options.threshold);

          if (mispricing.gte(threshold)) {
            opportunities.push({
              market: market.question,
              tokenId: outcome.tokenId,
              currentPrice: midPrice.toString(),
              fairValue: fairValue.toString(),
              mispricing: mispricing.toString(),
              edge: mispricing.div(midPrice).times(100).toString() + '%',
            });
          }
        } catch (err) {
          // Skip errors
        }
      }
    }

    // Sort by edge
    opportunities.sort((a, b) => {
      return new Decimal(b.mispricing).comparedTo(new Decimal(a.mispricing));
    });

    console.table(opportunities.slice(0, 20));
    logger.info({ count: opportunities.length }, 'Mispricing opportunities found');

    await repository.disconnect();
  });

program
  .command('research:arb')
  .description('Check for arbitrage opportunities')
  .action(async (_options: Record<string, unknown>) => {
    logger.info('Checking for arbitrage opportunities...');
    // This would load market mappings and check for arbitrage
    logger.info('Arbitrage check not fully implemented - requires market mappings config');
  });

program
  .command('report:daily')
  .description('Generate daily PnL report')
  .action(async () => {
    const repository = new Repository();
    const fills = await repository.getFills(undefined, 1000);
    const positions = await repository.getPositions();

    let totalPnl = new Decimal(0);
    let totalFees = new Decimal(0);
    let totalVolume = new Decimal(0);

    for (const fill of fills) {
      totalPnl = totalPnl.plus(fill.price.times(fill.size).times(fill.side === 'buy' ? -1 : 1));
      totalFees = totalFees.plus(fill.fee);
      totalVolume = totalVolume.plus(fill.size);
    }

    for (const position of positions) {
      totalPnl = totalPnl.plus(position.realizedPnl);
    }

    const report = {
      date: new Date().toISOString().split('T')[0],
      totalPnl: totalPnl.toString(),
      totalFees: totalFees.toString(),
      totalVolume: totalVolume.toString(),
      openPositions: positions.length,
      fills: fills.length,
    };

    console.table([report]);
    logger.info(report, 'Daily report generated');

    await repository.disconnect();
  });

program
  .command('kill-switch')
  .description('Activate kill switch (stops all trading)')
  .action(() => {
    writeFileSync('kill-switch.flag', '');
    logger.warn('Kill switch activated');
  });

program
  .command('kill-switch:clear')
  .description('Clear kill switch')
  .action(() => {
    if (existsSync('kill-switch.flag')) {
      unlinkSync('kill-switch.flag');
      logger.info('Kill switch cleared');
    }
  });

program
  .command('discover:markets')
  .description('Discover equivalent markets using AI and update mappings (run daily)')
  .option('--openai-key <key>', 'OpenAI API key (or set OPENAI_API_KEY env var)')
  .option('--similarity-threshold <number>', 'Similarity threshold (0-1)', '0.82')
  .action(async (options: { openaiKey?: string; similarityThreshold?: string }) => {
    const config = getConfig();
    const apiKey =
      options.openaiKey ||
      process.env.OPENAI_API_KEY ||
      (config as { OPENAI_API_KEY?: string }).OPENAI_API_KEY;

    if (!apiKey) {
      logger.error('OpenAI API key required. Set OPENAI_API_KEY env var or use --openai-key');
      process.exit(1);
    }

    logger.info('Starting market discovery...');

    try {
      const embeddingService = new OpenAIEmbeddingService(apiKey);
      const agent = new MarketDiscoveryAgent(embeddingService);

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
            `[${match.type}] ${match.similarity.toFixed(3)}: "${match.market1.question.substring(0, 50)}..." (${match.outcome1}) <-> "${match.market2.question.substring(0, 50)}..." (${match.outcome2})`
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

