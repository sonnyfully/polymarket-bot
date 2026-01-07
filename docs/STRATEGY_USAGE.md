# Three-Strategy Paper Trading System - Usage Guide

## Overview

This system implements three paper trading strategies with a unified experiment framework:

1. **Strategy A - Structural Parity/Complement Constraints**: Captures violations of probability constraints among outcomes that should be linked (e.g., YES + NO = 1)
2. **Strategy B - Cross-Market Relative Value (XRV)**: Exploits inconsistent pricing between outcomes that the OpenAI mapping system says are equivalent or inverse across different markets
3. **Strategy C - Time-Based Mispricing**: Exploits predictable inefficiencies based on market age and proximity to resolution

All strategies share the same:
- MarketStateStore (single source of truth)
- RiskGate (unified risk controls)
- PaperExecutionSim (deterministic execution)
- Accounting (consistent PnL tracking)

## Prerequisites

1. **Environment Setup**:
   ```bash
   # Copy .env.example to .env and configure
   cp .env.example .env
   
   # Required: OpenAI API key for mapping system
   OPENAI_API_KEY=sk-your-key-here
   
   # Ensure paper trading is enabled (default)
   SIMULATION_ONLY=true
   ```

2. **Database Setup**:
   ```bash
   # Generate Prisma client
   cd packages/storage
   pnpm prisma generate
   pnpm prisma migrate dev
   ```

3. **Build Packages**:
   ```bash
   # Build all packages
   pnpm build
   ```

## Running Strategies

### Single Strategy Mode

Run a single strategy in paper mode:

```bash
# Strategy A: Parity
pnpm --filter bot dev paper:run --strategy=parity --hours=24

# Strategy B: XRV (Cross-Market Relative Value)
pnpm --filter bot dev paper:run --strategy=xrv --hours=24

# Strategy C: Time-Based Mispricing
pnpm --filter bot dev paper:run --strategy=time --hours=24
```

### Multi-Strategy Portfolio Mode

Run multiple strategies with equal or custom weights:

```bash
# Equal weights (1:1:1)
pnpm --filter bot dev paper:run --multi --strategies=parity,xrv,time --hours=24

# Custom weights (e.g., 2:1:1)
pnpm --filter bot dev paper:run --multi --strategies=parity,xrv,time --weights=2,1,1 --hours=24
```

### Backtest Mode

Run historical backtests:

```bash
# Backtest from date range
pnpm --filter bot dev backtest:run --from=2024-01-01 --to=2024-01-31 --strategy=parity --seed=42
```

## Mapping System Integration

### Refresh Market Mappings

The mapping system uses OpenAI embeddings to discover equivalent/parity markets. Refresh mappings:

```bash
# Run discovery (uses OPENAI_API_KEY from .env)
pnpm --filter market-discovery dev discover:markets

# Or with custom threshold
pnpm --filter market-discovery dev discover:markets --similarity-threshold 0.85
```

### View Mapping Versions

Mapping versions are stored with each signal. To view mapping versions used in an experiment:

```sql
-- Query signals with mapping versions
SELECT strategy, mappingVersion, COUNT(*) as count
FROM Signal
WHERE experimentId = 'your-experiment-id'
GROUP BY strategy, mappingVersion;
```

### Mapping Configuration

- **MAPPING_MIN_CONFIDENCE** (default: 0.80): Minimum confidence threshold for using a mapping relation
- **MAPPING_STALENESS_HOURS** (default: 24): Hours before mapping is considered stale and refreshed

## Viewing Results

### CLI Summary

After running an experiment, a CLI summary is printed showing:
- Total PnL and return
- Max drawdown
- Overall statistics (signals, fills, turnover, hit rate, etc.)
- Daily breakdown
- Top relations by count

### JSON Output

For programmatic analysis, JSON output is available:

```bash
# Save JSON to file
pnpm --filter bot dev paper:run --strategy=parity --hours=24 --output=results.json
```

### Database Queries

Query experiment results from the database:

```sql
-- List all experiments
SELECT id, strategy, startDate, endDate, totalPnl, totalReturn
FROM ExperimentRun
ORDER BY createdAt DESC;

-- Daily stats for an experiment
SELECT date, totalPnl, signalCount, fillCount, turnover
FROM DailyStats
WHERE experimentId = 'your-experiment-id'
ORDER BY date;

-- Relation-level breakdown
SELECT relationKind, relationId, count, pnl, avgEdgeBps
FROM RelationStats
WHERE experimentId = 'your-experiment-id'
ORDER BY count DESC;
```

## Strategy-Specific Configuration

### Strategy A: Parity

Configuration options (via environment or config):
- `PARITY_MIN_EDGE_BPS`: Minimum edge in basis points (default: 50)
- `PARITY_MAX_SPREAD_BPS`: Maximum spread to trade (default: 200)
- `PARITY_LONG_ONLY`: If true, only buy underpriced (default: true)

### Strategy B: XRV

Configuration options:
- `XRV_MIN_EDGE_BPS`: Minimum edge (default: 100)
- `XRV_THRESHOLD_BPS`: Price divergence threshold (default: 50)
- `XRV_RELATION_COOLDOWN_MS`: Cooldown between trades on same relation (default: 5 minutes)
- `XRV_LONG_ONLY`: If true, only buy underpriced (default: true)

### Strategy C: Time-Based Mispricing

Configuration options:
- `TIME_EARLY_MARKET_HOURS`: Market is "new" if created within X hours (default: 24)
- `TIME_PRE_RESOLUTION_HOURS`: Final window before resolution (default: 24)
- `TIME_LONG_ONLY`: If true, only buy (default: true)

## Risk Controls

All strategies share the same risk limits (from config):
- `MAX_POSITION_PER_MARKET`: Max position per token (default: 1000)
- `MAX_DAILY_LOSS`: Max daily loss (default: 500)
- `MAX_GROSS_EXPOSURE`: Max gross exposure (default: 10000)
- `MAX_ORDER_RATE_PER_SECOND`: Max order rate (default: 10)

## Limitations & Next Steps

### Current Limitations

1. **Position Tracking**: Unrealized PnL calculation is simplified - needs current price integration
2. **Hit Rate**: Currently uses placeholder - needs actual trade outcome tracking
3. **Sharpe Ratio**: Not yet implemented - needs risk-free rate and return series
4. **Mapping Error Tracking**: Relation performance tracking is basic - needs full PnL attribution
5. **Deterministic Execution**: Passive fill simulation uses RNG but seed control needs verification

### Next Steps

1. **Enhanced Metrics**: 
   - Implement full unrealized PnL calculation
   - Add Sharpe ratio calculation
   - Track actual hit rate from trade outcomes

2. **Mapping Improvements**:
   - Full PnL attribution per relation
   - Automatic relation disabling based on performance
   - Mapping version comparison tools

3. **Strategy Refinements**:
   - Add more sophisticated sizing (Kelly criterion with probability shrinkage)
   - Improve time-based strategy market age detection
   - Add regime filters for dead markets

4. **Testing**:
   - Unit tests for each strategy
   - Integration tests for experiment runner
   - Validation tests for orderbook delta correctness

5. **Performance**:
   - Optimize mapping refresh (incremental updates)
   - Add caching for derived features
   - Parallelize strategy signal generation

## Troubleshooting

### "No strategies found"

Ensure strategies are registered:
```typescript
experimentRunner.registerStrategy(new ParityStrategy(mappingService));
experimentRunner.registerStrategy(new XRVStrategy(mappingService));
experimentRunner.registerStrategy(new TimeMispricingStrategy(mappingService));
```

### "Mapping service error"

Check OpenAI API key:
```bash
echo $OPENAI_API_KEY
```

Refresh mappings:
```bash
pnpm --filter market-discovery dev discover:markets
```

### "Stale price feed"

Check market data ingestion:
- Verify WebSocket connection
- Check `lastPriceUpdate` timestamps
- Increase `PRICE_FEED_STALE_MS` if needed

### Low signal generation

- Check mapping confidence threshold (`MAPPING_MIN_CONFIDENCE`)
- Verify market liquidity (spread, depth)
- Check strategy-specific thresholds (min edge, max spread)

