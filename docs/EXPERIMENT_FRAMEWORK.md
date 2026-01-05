# Paper Trading Experiment Framework

## Overview

The experiment framework provides a controlled environment for testing trading strategies without risking real capital. It includes:

- **MarketStateStore**: Centralized market data management
- **PaperExecutionSim**: Realistic order execution simulation
- **Strategy Harness**: Standardized strategy interface
- **Daily Reporting**: Performance metrics and analysis

## Architecture

```
Gamma API → Market Discovery
    ↓
MarketStateStore (universe, orderbooks, trades, features)
    ↓
Strategy Harness → Strategies (mispricing, arbitrage, parity)
    ↓
PaperExecutionSim → Order Execution
    ↓
Daily Report → Metrics & Analysis
```

## MarketStateStore

Centralized store for all market data with derived features.

**Components**:
- `MarketUniverse`: Events, markets, token mappings
- `OrderBookStore`: Top N bids/asks per token
- `TradeTapeStore`: Recent trades per token
- `DerivedFeatures`: Mid price, spread, depth, EMA, volatility

**Usage**:
```typescript
import { MarketStateStore } from '@pm-bot/core';

const stateStore = new MarketStateStore();

// Set universe (from GammaClient)
stateStore.setUniverse(universe);

// Update order book (from ClobPublicClient or WebSocket)
stateStore.updateOrderBook(tokenId, book);

// Add trade (from WebSocket)
stateStore.addTrade({
  tokenId: 'token-1',
  price: new Decimal('0.5'),
  size: new Decimal('100'),
  side: 'buy',
  timestamp: new Date(),
});

// Get derived features
const features = stateStore.getDerivedFeatures(tokenId);
// features.midPrice, features.spread, features.ema, etc.
```

## PaperExecutionSim

Simulates order execution with realistic fill logic.

**Fill Rules**:
1. **Market Orders**: Fill immediately at best bid/ask
2. **Limit Orders Crossing Spread**: Fill immediately at best bid/ask
3. **Passive Limit Orders**: Fill probabilistically when price moves through limit

**Usage**:
```typescript
import { PaperExecutionSim } from '@pm-bot/execution';

const sim = new PaperExecutionSim({
  feeRate: new Decimal(0.02), // 2% fee
  fillProbability: new Decimal(0.5), // 50% fill probability for passive orders
});

// Place order
const order = sim.placeOrder({
  id: 'order-1',
  tokenId: 'token-1',
  side: 'buy',
  price: new Decimal('0.5'),
  size: new Decimal('100'),
  type: 'limit',
  timestamp: new Date(),
});

// Process market update (called on each book/trade update)
const fills = sim.processMarketUpdate(tokenId, book, trade);

// Each fill includes:
// - price, size, slippage, spreadPaid, fee
```

**Fill Metrics**:
- `slippage`: Difference between expected and actual fill price
- `spreadPaid`: Spread cost (for market orders)
- `fee`: Trading fee (configurable)

## Strategy Harness

Standardized interface for all strategies.

**Strategy Interface**:
```typescript
interface Strategy {
  name: string;
  onStart(context: StrategyContext): Promise<void>;
  onTick(context: StrategyContext): Promise<Signal[]>;
  onFill(fill: unknown, context: StrategyContext): Promise<void>;
  onStop(): Promise<void>;
}
```

**Usage**:
```typescript
import { StrategyHarness } from '@pm-bot/signals';
import { MispricingStrategy, ArbitrageStrategy } from '@pm-bot/signals';

const harness = new StrategyHarness(stateStore);

// Add strategies
harness.addStrategy(new MispricingStrategy());
harness.addStrategy(new ArbitrageStrategy());

// Start
await harness.start();

// Tick (called periodically)
const signals = await harness.tick();

// Convert signals to orders
for (const signal of signals) {
  const orderIntent = harness.signalToOrderIntent(signal);
  sim.placeOrder(orderIntent);
}

// Handle fills
for (const fill of fills) {
  await harness.handleFill(fill);
}
```

## Daily Reporting

Generates comprehensive performance reports.

**Metrics**:
- PnL (realized, unrealized, total)
- Drawdown (max drawdown)
- Trades (count, win rate)
- Edge (average expected edge)
- Costs (slippage, fees, spread paid)
- Turnover
- Sharpe ratio (if returns series available)

**Usage**:
```typescript
import { DailyReportGenerator } from '@pm-bot/storage';

const generator = new DailyReportGenerator();

// Generate report for today
const report = await generator.generateReport(new Date());

// Save to database
await generator.saveReport(report);

// Print summary
console.table([{
  Date: report.date,
  'Total PnL': report.totalPnl.toString(),
  'Trades': report.trades,
  'Hit Rate': report.hitRate.times(100).toString() + '%',
  'Avg Edge': report.avgEdge.toString(),
  'Total Fees': report.totalFees.toString(),
}]);
```

## Running Experiments

### 1. Paper Trading Mode

```bash
# Run bot in paper mode
pnpm --filter bot dev run
```

The bot will:
1. Discover markets
2. Subscribe to real-time updates
3. Run strategies
4. Simulate execution
5. Generate daily reports

### 2. Backtesting

```bash
# Sync historical data first
pnpm --filter bot dev data:sync

# Run backtest
pnpm --filter backtester dev run \
  --strategy mispricing \
  --from 2024-01-01 \
  --to 2024-01-31 \
  --capital 10000 \
  --fee-rate 0.02
```

### 3. Research Mode

```bash
# Scan for opportunities
pnpm --filter bot dev research:mispricing
pnpm --filter bot dev research:arb
```

## Configuration

### Paper Execution Config

Edit strategy config in `.env`:
```bash
MISPRICING_THRESHOLD=0.02  # 2% mispricing threshold
MIN_BOOK_DEPTH=100          # Minimum liquidity
MAX_SLIPPAGE_BPS=50         # Max slippage in basis points
```

### Fee Configuration

Fees are configurable in `PaperExecutionSim`:
- Default: 2% (0.02)
- Adjust based on actual Polymarket fees

### Fill Probability

Passive limit order fill probability:
- Default: 50% (0.5)
- Adjust based on market conditions
- Higher for liquid markets, lower for illiquid

## Best Practices

1. **Start with Paper Trading**: Always test strategies in paper mode first
2. **Monitor Metrics**: Review daily reports for edge, slippage, fees
3. **Adjust Fill Model**: Calibrate fill probability based on backtest results
4. **Use MarketStateStore**: Centralized state prevents redundant API calls
5. **Test Strategies Independently**: Run one strategy at a time initially

## Limitations

1. **Fill Model**: Simplified probabilistic model; real fills may differ
2. **Slippage**: Estimated from order book; actual slippage may vary
3. **Latency**: Paper trading has no network latency; real trading does
4. **Market Impact**: Not modeled; large orders may move price
5. **Partial Fills**: Simplified; real orders may partially fill over time

## Next Steps

1. Calibrate fill probability from historical data
2. Add market impact modeling for large orders
3. Implement partial fill tracking
4. Add more sophisticated slippage models
5. Enhance backtesting with realistic fill simulation

