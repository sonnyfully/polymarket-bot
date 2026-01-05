#!/usr/bin/env node
import { Command } from 'commander';
import { Repository } from '@pm-bot/storage';
import { Backtester } from './backtester.js';
import { MispricingStrategy, ArbitrageStrategy } from '@pm-bot/signals';
import Decimal from 'decimal.js';

const program = new Command();

program
  .name('backtester')
  .description('Backtest trading strategies')
  .version('1.0.0');

program
  .command('run')
  .description('Run backtest')
  .requiredOption('--strategy <name>', 'Strategy name (mispricing, arbitrage)')
  .requiredOption('--from <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--capital <number>', 'Initial capital', '10000')
  .option('--fee-rate <number>', 'Fee rate (e.g., 0.02 for 2%)', '0.02')
  .action(async (options) => {
    const repository = new Repository();
    const backtester = new Backtester(repository);

    let strategy;
    if (options.strategy === 'mispricing') {
      strategy = new MispricingStrategy();
    } else if (options.strategy === 'arbitrage') {
      strategy = new ArbitrageStrategy();
    } else {
      console.error(`Unknown strategy: ${options.strategy}`);
      process.exit(1);
    }

    const config = {
      strategy,
      startDate: new Date(options.from),
      endDate: new Date(options.to),
      initialCapital: new Decimal(options.capital),
      feeRate: new Decimal(options.feeRate),
    };

    console.log('Running backtest...');
    const result = await backtester.run(config);

    console.table([{
      'Initial Capital': result.initialCapital.toString(),
      'Final Capital': result.finalCapital.toString(),
      'Total PnL': result.totalPnl.toString(),
      'Max Drawdown': result.maxDrawdown.toString(),
      'Hit Rate': result.hitRate.times(100).toString() + '%',
      'Avg Edge': result.avgEdge.toString(),
      'Total Fees': result.totalFees.toString(),
      'Total Slippage': result.totalSlippage.toString(),
      'Turnover': result.turnover.toString(),
      'Trades': result.trades,
    }]);

    await repository.disconnect();
  });

program.parse();

