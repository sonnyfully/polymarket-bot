# Quick Start Guide

## Where to Input API Keys

API keys are **optional** for paper trading (market data is public). They're only needed for:
- Live order placement
- User data access
- Authenticated endpoints

### Setup API Keys

1. Get keys from Polymarket (see their documentation)
2. Edit `.env` file:
   ```bash
   # Optional: Only needed for live trading
   POLYMARKET_API_KEY=your_api_key_here
   POLYMARKET_PRIVATE_KEY=your_private_key_here
   ```

**Note**: Leave these empty for paper trading - the bot will work with public market data only.

## Complete Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Generate Prisma client
pnpm --filter @pm-bot/storage db:generate

# 3. Run migrations
pnpm --filter @pm-bot/storage db:migrate

# 4. Copy and edit environment file
cp .env.example .env
# Edit .env if you want to customize settings

# 5. Run paper trading bot (no API keys needed!)
pnpm --filter bot dev run
```

## What Happens When You Run

1. **Market Discovery**: Bot discovers active markets via Gamma API
2. **Real-time Updates**: Subscribes to WebSocket for live book/trade updates
3. **State Management**: MarketStateStore maintains orderbooks, trades, derived features
4. **Strategy Execution**: Runs mispricing, arbitrage, and parity strategies
5. **Paper Execution**: Simulates order fills with realistic slippage/fees
6. **Daily Reports**: Generates PnL, drawdown, and performance metrics

## Key Components

### MarketStateStore
- Centralized market data
- Order books (top N levels)
- Trade tape (recent trades)
- Derived features (mid, spread, EMA, volatility)

### PaperExecutionSim
- Market orders: Fill at best bid/ask
- Limit orders crossing spread: Fill immediately
- Passive limit orders: Probabilistic fill when price moves through limit

### Strategy Harness
- Standardized interface for all strategies
- Same ingestion, execution, and risk gate for all strategies
- Easy to add new strategies

## Running Tests

```bash
# Run all tests
pnpm test

# Run specific package
pnpm --filter @pm-bot/polymarket test
pnpm --filter @pm-bot/core test
pnpm --filter @pm-bot/execution test
pnpm --filter @pm-bot/signals test
```

## Next Steps

1. **Configure Market Mappings**: Edit `config/market-mappings.json` for arbitrage
2. **Calibrate Strategies**: Adjust thresholds in `.env`
3. **Review Daily Reports**: Check `pnpm --filter bot dev report:daily`
4. **Backtest**: Run `pnpm --filter backtester dev run --strategy mispricing --from 2024-01-01 --to 2024-01-31`

## Documentation

- [Architecture](./ARCHITECTURE.md) - System design
- [API Integration](./API_INTEGRATION.md) - Polymarket API usage
- [Experiment Framework](./EXPERIMENT_FRAMEWORK.md) - Paper trading details
- [Usage Guide](../USAGE.md) - All commands and options

