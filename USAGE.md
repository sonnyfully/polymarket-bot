# Usage Guide

## Quick Start

### 1. Run Paper Bot

```bash
# Install dependencies first
pnpm install

# Generate Prisma client
pnpm --filter @pm-bot/storage db:generate

# Run migrations
pnpm --filter @pm-bot/storage db:migrate

# Run paper trading bot
pnpm --filter bot dev run
```

### 2. Run Backtest

```bash
# First, sync some historical data
pnpm --filter bot dev data:sync

# Run backtest
pnpm --filter backtester dev run --strategy mispricing --from 2024-01-01 --to 2024-01-31
```

### 3. Enable Live Trading Safely

⚠️ **WARNING**: Live trading uses real money!

1. Get API keys from Polymarket (see [API Integration Guide](./docs/API_INTEGRATION.md))

2. Edit `.env`:
   ```bash
   SIMULATION_ONLY=false
   LIVE_TRADING=true
   POLYMARKET_API_KEY=your_key
   POLYMARKET_PRIVATE_KEY=your_private_key
   ```

3. Run with confirmation:
   ```bash
   pnpm --filter bot dev live
   # Type "yes" when prompted
   ```

## Configure Market Mappings for Arbitrage

1. Copy example config:
   ```bash
   cp config/market-mappings.json.example config/market-mappings.json
   ```

2. Edit `config/market-mappings.json` with your market pairs:
   ```json
   {
     "mappings": [
       {
         "type": "equivalent",
         "markets": [
           { "marketId": "market-1-id", "tokenId": "token-1-id", "weight": 1.0 },
           { "marketId": "market-2-id", "tokenId": "token-2-id", "weight": 1.0 }
         ]
       }
     ]
   }
   ```

## Market Discovery (AI Agent)

Automatically discover equivalent markets using AI:

```bash
# Set OpenAI API key in .env
OPENAI_API_KEY=sk-...

# Run discovery (once daily recommended)
pnpm --filter bot dev discover:markets
```

See [Market Discovery Guide](./docs/MARKET_DISCOVERY.md) for details.

## Top 5 Known Limitations / Next Steps

1. **Fair Value Source**: The external reference adapter (`FairValueSource`) is stubbed. Implement your own data source (news APIs, odds aggregators, etc.) in `packages/signals/src/mispricing.ts`.

2. **Market Mappings**: ✅ **SOLVED** - AI agent automatically discovers equivalent markets. Run `discover:markets` daily.

3. **Order Signing**: Currently uses `@polymarket/clob-client` but may need custom signing for advanced order types. Review Polymarket API docs for latest signing requirements.

4. **Backtesting Fill Model**: Simplified fill simulation. Enhance with:
   - Historical fill rate analysis
   - Market impact modeling
   - Partial fill probability distributions

5. **Sharpe Ratio Calculation**: Currently simplified. Implement proper:
   - Returns series calculation
   - Risk-free rate adjustment
   - Rolling window Sharpe ratios

## Additional Commands

### Data Sync
```bash
# Sync everything
pnpm --filter bot dev data:sync

# Sync only markets
pnpm --filter bot dev data:sync --markets

# Sync only order books
pnpm --filter bot dev data:sync --books

# Sync only trades
pnpm --filter bot dev data:sync --trades
```

### Research
```bash
# Find mispricing opportunities
pnpm --filter bot dev research:mispricing

# Check arbitrage
pnpm --filter bot dev research:arb
```

### Reports
```bash
# Daily PnL report
pnpm --filter bot dev report:daily
```

### Kill Switch
```bash
# Activate (stops all trading)
pnpm --filter bot dev kill-switch

# Clear
pnpm --filter bot dev kill-switch:clear
```

## Metrics

Metrics are available at `http://localhost:9090/metrics` (Prometheus format).

## Troubleshooting

### "Cannot find module" errors
- Run `pnpm install` to install dependencies
- Run `pnpm --filter @pm-bot/storage db:generate` to generate Prisma client

### Database errors
- Ensure database is initialized: `pnpm --filter @pm-bot/storage db:migrate`
- Check `DATABASE_URL` in `.env`

### WebSocket connection issues
- Check network connectivity
- Verify Polymarket API is accessible
- Check rate limits

### Rate limit errors
- Adjust `MAX_ORDER_RATE_PER_SECOND` in `.env`
- Reduce tick frequency in `trading-bot.ts`

