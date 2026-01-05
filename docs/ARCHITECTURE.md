# Architecture Documentation

## Overview

The Polymarket trading bot is a production-grade system designed for lawful alpha generation through mispricing detection, cross-market arbitrage, and risk-managed execution.

## System Architecture

### Data Flow

```
REST API + WebSocket → Market Ingestion → State Store → Strategy Engine → Execution Engine → Risk Gate → Broker
                                                              ↓
                                                         Position Tracking
                                                              ↓
                                                         PnL Calculation
```

### Components

#### 1. Market Ingestion (`apps/bot/src/market-ingestion.ts`)

- **REST Poller**: Periodically fetches market data, order books, and trades
- **WebSocket Subscriber**: Real-time updates for order book deltas and trades
- **In-Memory OrderBook**: Maintains current state with delta application
- **Persistence**: Saves snapshots to database for replay/backtesting

**Failure Modes:**
- WebSocket disconnection: Automatic reconnection with exponential backoff
- Stale books: Timestamp checking, reject orders if book age > threshold
- Rate limiting: Token bucket rate limiter per endpoint class

#### 2. Domain Models (`packages/core/src/types.ts`)

Strict TypeScript types for:
- `Market`, `OutcomeToken`, `OrderBook`, `Trade`, `Position`, `Order`, `Fill`

All prices and sizes use `Decimal.js` for precision.

#### 3. Strategy Engine (`packages/signals/`)

**Interface:**
```typescript
interface Strategy {
  name: string;
  onStart(state: TradingState): Promise<void>;
  onTick(state: TradingState): Promise<Signal[]>;
  onFill(fill: Fill, state: TradingState): Promise<void>;
  onStop(): Promise<void>;
}
```

**Implemented Strategies:**

1. **Mispricing Strategy** (`packages/signals/src/mispricing.ts`)
   - Fair value: EMA-smoothed prices + volatility-adjusted bands
   - External reference adapter interface (stubbed for news/odds)
   - Triggers when |p_market - p_fair| > threshold
   - Requires minimum book depth

2. **Arbitrage Strategy** (`packages/signals/src/arbitrage.ts`)
   - Cross-market: Detects equivalent outcomes with price differences
   - Parity checks: Validates sum of probabilities = 1
   - Market mappings: Configurable via `config/market-mappings.json`

3. **Microstructure Strategy** (optional, disabled by default)
   - Spread capture in high-liquidity markets
   - Mean reversion signals

#### 4. Execution Engine (`packages/execution/src/order-manager.ts`)

- **Quote Builder**: Calculates limit price based on aggressiveness
- **Slippage Model**: Estimates fill price from book depth
- **Order Manager**: Place, amend, cancel, track orders
- **Paper Trading**: Simulated execution without real orders
- **Idempotency**: Client order IDs prevent duplicate orders

**Safety Checks:**
- No crossing markets (bid > ask check)
- Stale book rejection
- Slippage limits

#### 5. Risk Management (`packages/risk/src/risk-manager.ts`)

**Position Limits:**
- Max position per market
- Max gross exposure (sum of absolute positions)
- Max daily loss
- Max order rate per second

**Circuit Breakers:**
- WebSocket disconnect > 30s → cancel orders, pause
- Price feed stale > 60s → pause
- Error rate > 10/min → pause
- Kill switch file → immediate stop

**Sizing:**
- Fixed fractional (default): Risk X% per trade
- Kelly criterion (optional): With probability shrinkage
- Conservative caps: Max 5% of balance per trade

#### 6. Storage (`packages/storage/`)

**Prisma Schema:**
- Markets, OutcomeTokens
- OrderBookSnapshots (for replay)
- Trades, Positions, Orders, Fills
- BacktestRun (results)

**Repository Pattern:**
- Type-safe database access
- Decimal serialization as strings
- Efficient queries with indexes

#### 7. Backtesting (`apps/backtester/`)

- Replays historical order book snapshots and trades chronologically
- Simulates fills:
  - Crossing spread → fill at best ask/bid + fee
  - Passive → probability-based fill model
- Outputs: PnL, Sharpe, drawdown, hit rate, slippage, fees

## Failure Modes & Recovery

### WebSocket Disconnection

1. Detection: `wsClient.isConnected()` check
2. Recovery: Automatic reconnection with exponential backoff
3. Circuit Breaker: If disconnected > 30s, cancel open orders and pause

### Stale Order Books

1. Detection: Timestamp check on `OrderBook.lastUpdate`
2. Rejection: Orders rejected if book age > 60s
3. Refresh: Periodic REST snapshot sync

### Partial Fills

1. Tracking: `Order.filledSize` updated via WebSocket user channel
2. Reconciliation: Periodic REST sync of open orders
3. Position Update: Positions recalculated on each fill

### Rate Limiting

1. Prevention: Token bucket rate limiter per endpoint
2. Backoff: Automatic wait when tokens exhausted
3. Monitoring: Log rate limit hits

## Paper Trading vs Live Trading

### Paper Trading (Default)

- `SIMULATION_ONLY=true` in `.env`
- Orders stored in database but not sent to Polymarket
- Simulated fills based on order book
- No real money at risk

### Live Trading

- Requires `SIMULATION_ONLY=false` AND `LIVE_TRADING=true`
- Confirmation prompt on CLI
- Real orders sent to Polymarket API
- Real money at risk

## Observability

### Logging (Pino)

- Structured JSON logs
- Log levels: debug, info, warn, error
- Pretty printing in development

### Metrics (Prometheus)

- Endpoint: `http://localhost:9090/metrics`
- Metrics:
  - `bot_balance`: Current account balance
  - `bot_positions`: Number of open positions
  - `bot_open_orders`: Number of open orders
  - `bot_daily_pnl`: Daily PnL
  - `bot_trades_total`: Total trades executed
  - `bot_errors_total`: Total errors

## Configuration

See `.env.example` for all configuration options.

Key settings:
- `MAX_POSITION_PER_MARKET`: Hard cap per market
- `MAX_DAILY_LOSS`: Daily loss limit
- `MAX_ORDER_RATE_PER_SECOND`: Order rate limit
- `MISPRICING_THRESHOLD`: Minimum mispricing to trade
- `MIN_BOOK_DEPTH`: Minimum liquidity required
- `MAX_SLIPPAGE_BPS`: Maximum slippage in basis points

## Market Mappings for Arbitrage

Create `config/market-mappings.json`:

```json
{
  "mappings": [
    {
      "type": "equivalent",
      "markets": [
        { "marketId": "market-1", "tokenId": "token-1", "weight": 1.0 },
        { "marketId": "market-2", "tokenId": "token-2", "weight": 1.0 }
      ]
    },
    {
      "type": "parity",
      "markets": [
        { "marketId": "market-3", "tokenId": "token-3", "weight": 1.0 },
        { "marketId": "market-3", "tokenId": "token-4", "weight": 1.0 }
      ]
    }
  ]
}
```

## Security Considerations

1. **Private Keys**: Never commit `.env` files
2. **Rate Limiting**: Respect Polymarket API limits
3. **Kill Switch**: File-based emergency stop
4. **Paper Trading Default**: Prevents accidental live trading
5. **Validation**: Zod schema validation for all config

## Performance

- Tick interval: 5 seconds (configurable)
- Order book updates: Real-time via WebSocket
- Database: Indexed queries for fast lookups
- Memory: In-memory order books for low latency

## Testing

- Unit tests: Order book delta application, risk checks, signal generation
- Integration tests: Market ingestion, order placement
- Backtesting: Historical replay validation

