# Polymarket Trading Bot

A research-grade trading simulator and experimentation framework for Polymarket. This is not a "get rich quick" bot. The goal is to understand where prediction markets break down, how information and liquidity propagate, and which strategies hold up when accounting for costs, slippage, and human behavior.

**Everything is paper-traded by default.** The emphasis is on learning, measurement, and correctness rather than speed or hype.

## Philosophy

Prediction markets are often described as "truth machines," but in practice they are messy systems: thin liquidity, inconsistent market design, slow information diffusion, and highly variable participant sophistication. Most people talk about prediction markets at the level of outcomes ("who will win?"), while very little work is done at the level that actually determines profitability: structure, mechanics, and constraints.

This system treats Polymarket as a real market, not a forecasting toy — something that can ingest live order books, reason about logical relationships between markets, simulate realistic execution, and keep an auditable record of what worked and what didn't.

## Core Problem: Mispricing, Not Prediction

The core problem is not prediction. It's mispricing:

- How often do Polymarket outcomes violate basic probability constraints?
- When two markets encode the same real-world event, how long do inconsistencies persist?
- Which strategies survive once you include spreads, slippage, and realistic fills?
- Where does human behavior (overreaction, anchoring, late certainty) create edge?

Most existing bots skip straight to execution. This project is deliberately slower and more introspective: it compares strategies over time, understands failure modes, and surfaces where apparent "alpha" disappears under scrutiny.

## Architecture

The system is split into four layers:

1. **Market Ingestion**: Live market metadata and order book data from Polymarket's Gamma and CLOB APIs (REST + WebSocket). Maintains an in-memory view of markets, order books, and recent trades.

2. **State and Feature Derivation**: Raw market data transformed into derived features (midprice, spread, depth, volatility, time-to-resolution). These are shared inputs to all strategies.

3. **Strategy Engine + Paper Execution**: Multiple strategy modules run in parallel on the same market state. Signals pass through a common risk gate and sizing logic, then execute through a deterministic paper execution simulator that models book depth, slippage, and fees.

4. **Persistence and Evaluation**: All signals, simulated orders, fills, and PnL stored in a local database via Prisma. Makes runs reproducible and allows meaningful comparisons across strategies, markets, and time windows.

A key piece is a semantic market-mapping system (powered by an LLM) that identifies equivalences, inversions, and constraint sets across markets. Strategies that rely on parity or cross-market relative value use this mapping as a first-class input, with confidence thresholds and versioning to avoid silent errors.

## Design Constraints

- **Paper-only by default** with explicit safeguards against accidental live trading
- **Shared infrastructure**: All strategies share the same ingestion, execution model, and risk limits so results are comparable
- **Conservative execution**: If an edge does not survive spreads and slippage, it is treated as nonexistent
- **Clarity over cleverness**: Logic is deterministic, testable, and explainable

## Known Limitations

Paper trading will always lie in subtle ways, especially around passive fills and adverse selection. Market mappings can be wrong or stale, even with confidence thresholds. Some markets are so illiquid that any simulated edge is purely theoretical. Many strategies that look good in isolation degrade when multiple strategies interact or when capital constraints bind.

These failure modes are not treated as bugs to hide; they are part of what the system is designed to surface.

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- PostgreSQL (optional, SQLite for dev)

### Installation

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm --filter @pm-bot/storage db:generate

# Run migrations
pnpm --filter @pm-bot/storage db:migrate

# Copy environment file
cp .env.example .env
```

### Configuration

Edit `.env`:

```bash
# Safety: Paper trading by default
SIMULATION_ONLY=true
LIVE_TRADING=false

# Polymarket API Keys (optional, for authenticated endpoints)
POLYMARKET_API_KEY=your_api_key
POLYMARKET_PRIVATE_KEY=your_private_key

# Database
DATABASE_URL=file:./dev.db

# Risk Limits
MAX_POSITION_PER_MARKET=1000
MAX_DAILY_LOSS=500
MAX_ORDER_RATE_PER_SECOND=10

# Market Discovery (optional)
OPENAI_API_KEY=sk-...
```

### Basic Usage

```bash
# Run paper trading bot (default)
pnpm --filter bot dev run

# Sync market data
pnpm --filter bot dev data:sync

# Discover equivalent markets (for arbitrage, run once daily)
pnpm --filter bot dev discover:markets

# View daily report
pnpm --filter bot dev report:daily

# Research opportunities
pnpm --filter bot dev research:mispricing
pnpm --filter bot dev research:arb
```

### Backtesting

```bash
# Backtest a strategy
pnpm --filter backtester dev run \
  --strategy mispricing \
  --from 2024-01-01 \
  --to 2024-01-31 \
  --capital 10000
```

### Live Trading

⚠️ **WARNING**: This trades with real money!

```bash
# Set in .env: SIMULATION_ONLY=false, LIVE_TRADING=true
pnpm --filter bot dev live
# Confirmation prompt will appear
```

### Market Mappings

For arbitrage strategies, create `config/market-mappings.json` (copy from `config/market-mappings.json.example`):

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

Or use the AI discovery agent (recommended):

```bash
pnpm --filter bot dev discover:markets
```

## Safety Features

1. **Paper Trading Default**: `SIMULATION_ONLY=true` prevents accidental live trading
2. **Live Trading Validation**: Requires both flags + confirmation prompt
3. **Kill Switch**: File-based emergency stop (`pnpm --filter bot dev kill-switch`)
4. **Circuit Breakers**: Auto-pause on disconnects, stale feeds, high error rates
5. **Risk Limits**: Hard caps on positions, daily loss, order rate

## Development

```bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Lint
pnpm lint
```

## Future Directions

- Better execution realism, especially around passive orders and queue position
- Systematic analysis of where the market-mapping model is overconfident or brittle
- Strategy attribution: breaking PnL down into structural edge vs behavioral edge
- Extending the framework to conditional and nested markets, where logical constraints become more complex
- Eventually, carefully gated live trading on a very small subset of strategies to validate simulator assumptions

## Documentation

- [Architecture Overview](./docs/ARCHITECTURE.md) - System design and data flows
- [API Integration Guide](./docs/API_INTEGRATION.md) - Polymarket API usage
- [Experiment Framework](./docs/EXPERIMENT_FRAMEWORK.md) - Paper trading and backtesting
- [Quick Reference](./QUICK_REFERENCE.md) - Essential commands
- [Usage Guide](./USAGE.md) - Detailed usage instructions

## License

MIT

## Disclaimer

This software is for educational and research purposes. Trading involves risk. Use at your own discretion. The authors are not responsible for any losses.

---

This repo is best read as an experiment log and a thinking tool. If it ends up producing a profitable strategy, that's a bonus — the primary goal is to understand prediction markets as systems, not as betting games.
