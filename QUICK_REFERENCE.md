# Quick Reference: Essential Commands

## Initial Setup (One-Time)

```bash
# 1. Install dependencies
pnpm install

# 2. Setup database
pnpm --filter @pm-bot/storage db:generate
pnpm --filter @pm-bot/storage db:migrate

# 3. Create .env file (copy template below)
# 4. Create market mappings
cp config/market-mappings.json.example config/market-mappings.json
```

## Daily Operations

### Start Paper Trading
```bash
pnpm --filter bot dev run
```

### Sync Market Data
```bash
pnpm --filter bot dev data:sync
```

### Discover Markets (for arbitrage)
```bash
pnpm --filter bot dev discover:markets
```

### View Daily Report
```bash
pnpm --filter bot dev report:daily
```

### Research Opportunities
```bash
pnpm --filter bot dev research:mispricing
pnpm --filter bot dev research:arb
```

## Backtesting

```bash
# Sync data first
pnpm --filter bot dev data:sync

# Run backtest
pnpm --filter backtester dev run \
  --strategy mispricing \
  --from 2024-01-01 \
  --to 2024-01-31 \
  --capital 10000
```

## Safety

```bash
# Activate kill switch
pnpm --filter bot dev kill-switch

# Clear kill switch
pnpm --filter bot dev kill-switch:clear
```

## .env Template

Create `.env` file with:

```bash
SIMULATION_ONLY=true
LIVE_TRADING=false
DATABASE_URL=file:./dev.db
MAX_POSITION_PER_MARKET=1000
MAX_DAILY_LOSS=500
MISPRICING_THRESHOLD=0.02
MIN_BOOK_DEPTH=100
OPENAI_API_KEY=sk-...  # Optional, for market discovery
```

## Monitoring

- Metrics: http://localhost:9090/metrics
- Database GUI: `pnpm --filter @pm-bot/storage db:studio` → http://localhost:5555

## Full Guide

See [SIMULATION_GUIDE.md](./SIMULATION_GUIDE.md) for comprehensive documentation.

