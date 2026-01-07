# Complete Simulation Guide: Running Paper Trading from Start to Finish

This guide provides step-by-step instructions to set up and run paper trading simulations, backtests, and prepare for profitable trading.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Configuration](#configuration)
4. [Running Paper Trading](#running-paper-trading)
5. [Running Backtests](#running-backtests)
6. [Market Discovery](#market-discovery)
7. [Monitoring & Reports](#monitoring--reports)
8. [Optimizing for Profitability](#optimizing-for-profitability)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

1. **Node.js 20+**
   ```bash
   node --version  # Should show v20.x.x or higher
   ```

2. **pnpm 8+**
   ```bash
   npm install -g pnpm@latest
   pnpm --version  # Should show 8.x.x or higher
   ```

3. **PostgreSQL (Optional)**
   - For production: Install PostgreSQL
   - For development: SQLite is used by default (no installation needed)

### Optional: OpenAI API Key
- Required for automatic market discovery (arbitrage opportunities)
- Get from: https://platform.openai.com/api-keys
- Can skip if only running mispricing strategy

---

## Initial Setup

### Step 1: Install Dependencies

```bash
# Navigate to project root
cd /Users/sonnyfullerton/Projects/PM_bot

# Install all dependencies
pnpm install
```

This installs dependencies for all packages in the monorepo.

### Step 2: Generate Prisma Client

```bash
# Generate Prisma client for database access
pnpm --filter @pm-bot/storage db:generate
```

This creates the Prisma client based on the schema in `packages/storage/prisma/schema.prisma`.

### Step 3: Run Database Migrations

```bash
# Create database and run migrations
pnpm --filter @pm-bot/storage db:migrate
```

This:
- Creates SQLite database at `./dev.db` (default)
- Creates all required tables (Markets, Orders, Fills, Positions, etc.)

### Step 4: Create Environment File

```bash
# Copy example environment file
cp .env.example .env
```

If `.env.example` doesn't exist, create `.env` with the following:

```bash
# Safety: Paper trading by default
SIMULATION_ONLY=true
LIVE_TRADING=false

# Polymarket API (Optional - only needed for live trading)
POLYMARKET_API_KEY=
POLYMARKET_PRIVATE_KEY=

# Database (SQLite for dev, Postgres for prod)
DATABASE_URL=file:./dev.db

# Risk Limits
MAX_POSITION_PER_MARKET=1000
MAX_DAILY_LOSS=500
MAX_ORDER_RATE_PER_SECOND=10
MAX_GROSS_EXPOSURE=10000

# Strategy Configuration
MISPRICING_THRESHOLD=0.02
MIN_BOOK_DEPTH=100
MAX_SLIPPAGE_BPS=50

# Observability
LOG_LEVEL=info
METRICS_PORT=9090

# Circuit Breakers
WEBSOCKET_DISCONNECT_TIMEOUT_MS=30000
PRICE_FEED_STALE_MS=60000
MAX_ERROR_RATE_PER_MINUTE=10

# Market Discovery (Optional - for arbitrage)
OPENAI_API_KEY=
MARKET_DISCOVERY_SIMILARITY_THRESHOLD=0.82
MAPPING_MIN_CONFIDENCE=0.80
MAPPING_STALENESS_HOURS=24
```

### Step 5: Configure Market Mappings (For Arbitrage)

```bash
# Copy example market mappings
cp config/market-mappings.json.example config/market-mappings.json
```

The file `config/market-mappings.json` is used for arbitrage strategies. You can:
- Leave it empty initially (just `{"mappings": []}`)
- Use AI discovery to populate it (see [Market Discovery](#market-discovery))
- Manually add equivalent market pairs

---

## Configuration

### Key Configuration Variables

Edit `.env` to customize behavior:

**Safety Settings:**
- `SIMULATION_ONLY=true` - Enables paper trading (default)
- `LIVE_TRADING=false` - Disables live trading (default)

**Risk Management:**
- `MAX_POSITION_PER_MARKET=1000` - Max position size per market
- `MAX_DAILY_LOSS=500` - Circuit breaker: stop trading if daily loss exceeds this
- `MAX_GROSS_EXPOSURE=10000` - Max total exposure across all positions

**Strategy Tuning:**
- `MISPRICING_THRESHOLD=0.02` - Minimum mispricing (2%) to trigger trade
- `MIN_BOOK_DEPTH=100` - Minimum liquidity required
- `MAX_SLIPPAGE_BPS=50` - Maximum acceptable slippage (50 basis points)

**Market Discovery:**
- `OPENAI_API_KEY=sk-...` - Required for AI-powered market discovery
- `MARKET_DISCOVERY_SIMILARITY_THRESHOLD=0.82` - Similarity threshold (0-1)

---

## Running Paper Trading

### Basic Paper Trading

```bash
# Run bot in paper trading mode (default)
pnpm --filter bot dev run
```

This will:
1. Connect to Polymarket WebSocket for real-time data
2. Discover active markets
3. Subscribe to order book and trade updates
4. Run mispricing and arbitrage strategies
5. Simulate order execution (paper trading)
6. Log all activity

**Stop the bot:** Press `Ctrl+C`

### Explicit Paper Mode

```bash
# Explicitly run in paper mode
pnpm --filter bot dev paper
```

### What Happens During Paper Trading

1. **Market Discovery**: Fetches active markets from Polymarket Gamma API
2. **Real-time Updates**: Subscribes to WebSocket for:
   - Order book updates (bids/asks)
   - Trade executions
3. **Strategy Execution**: Every 5 seconds, runs:
   - **Mispricing Strategy**: Detects price deviations from fair value
   - **Arbitrage Strategy**: Finds price differences in equivalent markets
4. **Paper Execution**: Simulates order fills with:
   - Realistic slippage
   - Trading fees (2% default)
   - Probabilistic fills for limit orders
5. **Risk Management**: Checks:
   - Position limits
   - Daily loss limits
   - Order rate limits
6. **Data Storage**: Saves all:
   - Orders
   - Fills
   - Positions
   - Market snapshots

---

## Running Backtests

### Step 1: Sync Historical Data

Before backtesting, you need historical data:

```bash
# Sync markets, order books, and trades
pnpm --filter bot dev data:sync

# Or sync specific data types
pnpm --filter bot dev data:sync --markets    # Only markets
pnpm --filter bot dev data:sync --books      # Only order books
pnpm --filter bot dev data:sync --trades     # Only trades
```

**Note**: This syncs current data. For historical backtesting, you'll need to run this regularly or use historical data sources.

### Step 2: Run Backtest

```bash
# Basic backtest
pnpm --filter backtester dev run \
  --strategy mispricing \
  --from 2024-01-01 \
  --to 2024-01-31

# With custom capital
pnpm --filter backtester dev run \
  --strategy mispricing \
  --from 2024-01-01 \
  --to 2024-01-31 \
  --capital 50000

# With custom fee rate
pnpm --filter backtester dev run \
  --strategy mispricing \
  --from 2024-01-01 \
  --to 2024-01-31 \
  --capital 10000 \
  --fee-rate 0.02

# Test arbitrage strategy
pnpm --filter backtester dev run \
  --strategy arbitrage \
  --from 2024-01-01 \
  --to 2024-01-31
```

### Backtest Output

The backtest will show:
- Initial Capital
- Final Capital
- Total PnL
- Max Drawdown
- Hit Rate (%)
- Average Edge
- Total Fees
- Total Slippage
- Turnover
- Number of Trades

---

## Market Discovery

### Automatic Market Discovery (AI-Powered)

Discover equivalent markets for arbitrage using AI:

```bash
# Run market discovery (requires OPENAI_API_KEY in .env)
pnpm --filter bot dev discover:markets

# With custom similarity threshold
pnpm --filter bot dev discover:markets --similarity-threshold 0.85

# With API key as flag
pnpm --filter bot dev discover:markets --openai-key sk-your-key-here
```

**What it does:**
1. Fetches all active markets
2. Generates embeddings for each market question
3. Finds similar/equivalent markets
4. Updates `config/market-mappings.json` automatically

**When to run:**
- Once daily (markets don't change frequently)
- After new markets are created
- When arbitrage opportunities seem low

**Output:**
- Shows markets scanned
- Matches found
- Mappings added/updated
- Top matches with similarity scores

---

## Monitoring & Reports

### Daily PnL Report

```bash
# Generate daily performance report
pnpm --filter bot dev report:daily
```

Shows:
- Total PnL (realized + unrealized)
- Total Fees
- Total Volume
- Open Positions
- Number of Fills

### Research Commands

```bash
# Scan for mispricing opportunities (without trading)
pnpm --filter bot dev research:mispricing

# With custom threshold
pnpm --filter bot dev research:mispricing --threshold 0.03

# Check arbitrage opportunities
pnpm --filter bot dev research:arb
```

### Metrics Endpoint

Prometheus metrics available at:
```
http://localhost:9090/metrics
```

### Database Inspection

```bash
# Open Prisma Studio (database GUI)
pnpm --filter @pm-bot/storage db:studio
```

This opens a web interface at `http://localhost:5555` to browse:
- Markets
- Orders
- Fills
- Positions
- Trades

---

## Optimizing for Profitability

### 1. Calibrate Strategy Parameters

Edit `.env` to tune strategies:

```bash
# Increase mispricing threshold (fewer, higher-quality trades)
MISPRICING_THRESHOLD=0.03

# Require more liquidity (better fills)
MIN_BOOK_DEPTH=200

# Reduce slippage tolerance (better execution)
MAX_SLIPPAGE_BPS=30
```

### 2. Run Multiple Backtests

Test different parameter combinations:

```bash
# Test conservative strategy
MISPRICING_THRESHOLD=0.05 MIN_BOOK_DEPTH=500 \
pnpm --filter backtester dev run --strategy mispricing --from 2024-01-01 --to 2024-01-31

# Test aggressive strategy
MISPRICING_THRESHOLD=0.01 MIN_BOOK_DEPTH=50 \
pnpm --filter backtester dev run --strategy mispricing --from 2024-01-01 --to 2024-01-31
```

### 3. Monitor Key Metrics

Focus on:
- **Hit Rate**: Should be >50% for profitable strategy
- **Average Edge**: Should exceed fees + slippage
- **Max Drawdown**: Keep under 20% of capital
- **Sharpe Ratio**: Aim for >1.0

### 4. Use Market Discovery

Regularly discover new arbitrage opportunities:

```bash
# Run daily
pnpm --filter bot dev discover:markets
```

### 5. Analyze Daily Reports

```bash
# Check performance daily
pnpm --filter bot dev report:daily
```

Look for:
- Consistent positive PnL
- Low fees relative to profits
- Reasonable position sizes
- Good fill rates

### 6. Adjust Risk Limits

Based on performance, adjust in `.env`:

```bash
# If profitable, increase limits
MAX_POSITION_PER_MARKET=2000
MAX_GROSS_EXPOSURE=20000

# If losing, decrease limits
MAX_POSITION_PER_MARKET=500
MAX_DAILY_LOSS=250
```

### 7. Test Different Strategies

The bot supports multiple strategies:
- **Mispricing**: Price deviations from fair value
- **Arbitrage**: Cross-market price differences

You can modify `apps/bot/src/cli.ts` to add/remove strategies.

---

## Troubleshooting

### "Cannot find module" errors

```bash
# Reinstall dependencies
pnpm install

# Regenerate Prisma client
pnpm --filter @pm-bot/storage db:generate
```

### Database errors

```bash
# Reset database
rm dev.db
pnpm --filter @pm-bot/storage db:migrate
```

### WebSocket connection issues

- Check internet connection
- Verify Polymarket API is accessible
- Check rate limits (may need to reduce `MAX_ORDER_RATE_PER_SECOND`)

### No trades being executed

1. Check mispricing threshold: `MISPRICING_THRESHOLD` may be too high
2. Check book depth: `MIN_BOOK_DEPTH` may be too high
3. Check risk limits: May be hitting position/exposure limits
4. Check kill switch: `pnpm --filter bot dev kill-switch:clear`

### Low profitability

1. **Reduce fees**: Check if fee rate is realistic (default 2%)
2. **Improve fill model**: Adjust fill probability in `PaperExecutionSim`
3. **Tune thresholds**: Lower `MISPRICING_THRESHOLD` for more trades
4. **Increase capital**: More capital = more opportunities
5. **Use market discovery**: Find better arbitrage opportunities

### Kill Switch

```bash
# Activate kill switch (stops all trading)
pnpm --filter bot dev kill-switch

# Clear kill switch
pnpm --filter bot dev kill-switch:clear
```

---

## Complete Workflow Example

Here's a complete workflow from setup to profitable trading:

```bash
# 1. Initial setup
pnpm install
pnpm --filter @pm-bot/storage db:generate
pnpm --filter @pm-bot/storage db:migrate
cp .env.example .env
# Edit .env with your settings

# 2. Discover markets (optional, for arbitrage)
pnpm --filter bot dev discover:markets

# 3. Sync current data
pnpm --filter bot dev data:sync

# 4. Run backtest to validate strategy
pnpm --filter backtester dev run \
  --strategy mispricing \
  --from 2024-01-01 \
  --to 2024-01-31 \
  --capital 10000

# 5. If backtest looks good, run paper trading
pnpm --filter bot dev run

# 6. Monitor performance
pnpm --filter bot dev report:daily

# 7. Adjust parameters based on results
# Edit .env, then repeat steps 4-6

# 8. Once consistently profitable in paper trading,
#    consider live trading (with caution!)
```

---

## Next Steps

1. **Implement Fair Value Source**: Currently stubbed. Add real data source (news APIs, odds aggregators)
2. **Enhance Fill Model**: Calibrate based on historical data
3. **Add More Strategies**: Implement additional trading strategies
4. **Build Dashboard**: Create web UI for monitoring
5. **Add Alerts**: Set up notifications for important events

---

## Safety Reminders

⚠️ **Always test in paper trading first!**

- Paper trading is enabled by default (`SIMULATION_ONLY=true`)
- Live trading requires explicit flags AND confirmation prompt
- Use kill switch if needed: `pnpm --filter bot dev kill-switch`
- Monitor daily reports regularly
- Start with small position sizes

---

## Additional Resources

- [Architecture Overview](./docs/ARCHITECTURE.md)
- [API Integration Guide](./docs/API_INTEGRATION.md)
- [Experiment Framework](./docs/EXPERIMENT_FRAMEWORK.md)
- [Market Discovery Guide](./docs/MARKET_DISCOVERY.md)
- [Strategy Usage](./docs/STRATEGY_USAGE.md)

