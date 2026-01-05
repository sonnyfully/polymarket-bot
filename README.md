# Polymarket Trading Bot

Production-grade trading and research bot for Polymarket focused on lawful alpha: mispricing detection, cross-market arbitrage, and risk-managed execution.

## Features

- **Market Ingestion**: REST + WebSocket real-time data feeds
- **Mispricing Detection**: EMA-based fair value with volatility bands
- **Cross-Market Arbitrage**: Equivalent outcome detection
- **Risk Management**: Position limits, circuit breakers, kill switch
- **Paper Trading**: Safe simulation mode (default)
- **Backtesting**: Historical replay with metrics
- **Observability**: Structured logging + Prometheus metrics

## Prerequisites

- Node.js 20+
- pnpm 8+
- PostgreSQL (optional, SQLite for dev)

## Installation

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm --filter @pm-bot/storage db:generate

# Run migrations
pnpm --filter @pm-bot/storage db:migrate

# Copy environment file
cp .env.example .env
# Edit .env with your configuration
```

## Configuration

Edit `.env`:

```bash
# Safety: Paper trading by default
SIMULATION_ONLY=true
LIVE_TRADING=false

# Polymarket API Keys (for authenticated endpoints only)
# Public endpoints (market data) don't require keys
POLYMARKET_API_KEY=your_api_key  # Optional: for order placement
POLYMARKET_PRIVATE_KEY=your_private_key  # Optional: for signing orders

# Database (SQLite for dev, Postgres for prod)
DATABASE_URL=file:./dev.db

# Risk Limits
MAX_POSITION_PER_MARKET=1000
MAX_DAILY_LOSS=500
MAX_ORDER_RATE_PER_SECOND=10
```

## Usage

### Run Paper Trading Bot

```bash
# Default (paper trading)
pnpm --filter bot dev run

# Explicit paper mode
pnpm --filter bot dev paper
```

### Run Live Trading Bot

⚠️ **WARNING**: This trades with real money!

```bash
# Set in .env: SIMULATION_ONLY=false, LIVE_TRADING=true
pnpm --filter bot dev live
# Confirmation prompt will appear
```

### Sync Market Data

```bash
# Sync markets, order books, and trades
pnpm --filter bot dev data:sync

# Sync only markets
pnpm --filter bot dev data:sync --markets

# Sync only order books
pnpm --filter bot dev data:sync --books
```

### Research Commands

```bash
# Scan for mispricing opportunities
pnpm --filter bot dev research:mispricing

# Check arbitrage opportunities
pnpm --filter bot dev research:arb
```

### Backtesting

```bash
# Backtest mispricing strategy
pnpm --filter backtester dev run --strategy mispricing --from 2024-01-01 --to 2024-01-31

# Backtest with custom capital
pnpm --filter backtester dev run --strategy mispricing --from 2024-01-01 --to 2024-01-31 --capital 50000
```

### Reports

```bash
# Daily PnL report
pnpm --filter bot dev report:daily
```

### Market Discovery (AI Agent)

Automatically discover equivalent markets using AI embeddings:

```bash
# Discover equivalent markets and update mappings
# Requires OPENAI_API_KEY in .env or --openai-key flag
pnpm --filter bot dev discover:markets

# With custom similarity threshold
pnpm --filter bot dev discover:markets --similarity-threshold 0.85
```

**Note**: Run this once daily. Markets don't change frequently, so daily updates are sufficient.

### Kill Switch

```bash
# Activate kill switch (stops all trading)
pnpm --filter bot dev kill-switch

# Clear kill switch
pnpm --filter bot dev kill-switch:clear
```

## Market Mappings for Arbitrage

Create `config/market-mappings.json` (copy from `config/market-mappings.json.example`):

```json
{
  "mappings": [
    {
      "type": "equivalent",
      "markets": [
        { "marketId": "market-1", "tokenId": "token-1", "weight": 1.0 },
        { "marketId": "market-2", "tokenId": "token-2", "weight": 1.0 }
      ]
    }
  ]
}
```

## Architecture

- [Architecture Overview](./docs/ARCHITECTURE.md) - System design and data flows
- [API Integration Guide](./docs/API_INTEGRATION.md) - Polymarket API usage
- [Experiment Framework](./docs/EXPERIMENT_FRAMEWORK.md) - Paper trading and backtesting

## Development

```bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Lint
pnpm lint

# Clean
pnpm clean
```

## Safety Features

1. **Paper Trading Default**: `SIMULATION_ONLY=true` prevents accidental live trading
2. **Live Trading Validation**: Requires both flags + confirmation prompt
3. **Kill Switch**: File-based emergency stop
4. **Circuit Breakers**: Auto-pause on disconnects, stale feeds, high error rates
5. **Risk Limits**: Hard caps on positions, daily loss, order rate

## Known Limitations

1. **Fair Value Source**: External reference adapter is stubbed; implement your own data source (news APIs, odds aggregators)
2. **Market Mappings**: Arbitrage requires manual configuration of equivalent markets in `config/market-mappings.json`
3. **Order Signing**: Uses `@polymarket/clob-client` but may need custom signing for advanced order types
4. **Fill Model**: Simplified probabilistic model; calibrate fill probability based on historical data
5. **Sharpe Ratio**: Calculation is simplified; implement proper returns series for production

## Testing

```bash
# Run all tests
pnpm test

# Run specific package tests
pnpm --filter @pm-bot/polymarket test
pnpm --filter @pm-bot/core test
pnpm --filter @pm-bot/execution test
pnpm --filter @pm-bot/signals test
```

Test coverage:
- Rate limiter behavior
- Order book updates
- Fill simulation
- Strategy signal generation

## Next Steps

1. Implement external fair value source (news, odds, etc.)
2. Add more sophisticated backtesting fill models
3. Implement microstructure strategy (spread capture)
4. Add dashboard UI (read-only web interface)
5. Enhance observability (Grafana dashboards)

## License

MIT

## Disclaimer

This software is for educational and research purposes. Trading involves risk. Use at your own discretion. The authors are not responsible for any losses.

