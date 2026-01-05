# Polymarket API Integration Guide

## Overview

This bot integrates with Polymarket's official APIs:
- **Gamma API**: Market discovery and metadata
- **CLOB Public API**: Real-time prices and order books
- **CLOB WebSocket**: Live market updates

## API Clients

### GammaClient

Discovers active events and markets, extracts `clobTokenId` for each outcome.

**Base URL**: `https://gamma-api.polymarket.com`

**Rate Limits**: 4,000 requests per 10 seconds

**Usage**:
```typescript
import { GammaClient } from '@pm-bot/polymarket';

const gamma = new GammaClient();

// Get all active markets
const universe = await gamma.buildMarketUniverse(true);

// Access markets
for (const [marketId, market] of universe.markets) {
  for (const outcome of market.outcomes) {
    const clobTokenId = outcome.clobTokenId; // Use this for CLOB API
  }
}
```

**Key Methods**:
- `getEvents(active?: boolean)`: Fetch events
- `getMarkets(eventId?: string, active?: boolean)`: Fetch markets
- `buildMarketUniverse(activeOnly: boolean)`: Build complete market universe with token mappings

### ClobPublicClient

Fetches real-time prices and order books for specific tokens.

**Base URL**: `https://clob.polymarket.com`

**Rate Limits**: 9,000 requests per 10 seconds

**Usage**:
```typescript
import { ClobPublicClient } from '@pm-bot/polymarket';

const clob = new ClobPublicClient();

// Get current price
const { price, timestamp } = await clob.getPrice('token-id');

// Get order book (top 20 levels by default)
const book = await clob.getBook('token-id', 20);
```

**Key Methods**:
- `getPrice(tokenId: string)`: Get current price
- `getBook(tokenId: string, depth?: number)`: Get order book

### ClobWsClient

Subscribes to real-time market updates via WebSocket.

**WebSocket URL**: `wss://ws-subscriptions-clob.polymarket.com`

**Usage**:
```typescript
import { ClobWsClient } from '@pm-bot/polymarket';

const ws = new ClobWsClient();

// Connect
await ws.connect();

// Subscribe to market updates
ws.subscribe('token-id');

// Handle book updates
ws.onBookUpdate((update) => {
  console.log('Book update:', update.tokenId, update.bids, update.asks);
});

// Handle trades
ws.onTrade((trade) => {
  console.log('Trade:', trade.tokenId, trade.price, trade.size);
});

// Handle errors
ws.onError((error) => {
  console.error('WebSocket error:', error);
});
```

**Key Methods**:
- `connect()`: Connect to WebSocket
- `subscribe(tokenId: string)`: Subscribe to market channel
- `unsubscribe(tokenId: string)`: Unsubscribe
- `onBookUpdate(callback)`: Register book update handler
- `onTrade(callback)`: Register trade handler
- `isConnected()`: Check connection status

## Rate Limiting

All API clients use token bucket rate limiters with exponential backoff.

**Configuration**:
- Gamma API: 400 tokens/sec capacity, 400 tokens/sec refill
- CLOB API: 900 tokens/sec capacity, 900 tokens/sec refill

Rate limiters automatically:
- Wait when tokens are exhausted
- Add jitter to prevent thundering herd
- Reset on manual reset call

## Authentication

**For Public Endpoints**: No authentication required

**For Private Endpoints** (order placement, user data):
1. Set `POLYMARKET_API_KEY` in `.env`
2. Set `POLYMARKET_PRIVATE_KEY` in `.env` (for signing)

**Note**: The bot uses `@polymarket/clob-client` for authenticated requests. See Polymarket docs for signing requirements.

## Error Handling

All clients throw errors on:
- HTTP errors (non-2xx responses)
- Network failures
- Rate limit violations (handled automatically with backoff)

**Example**:
```typescript
try {
  const book = await clob.getBook('token-id');
} catch (error) {
  if (error.message.includes('429')) {
    // Rate limited - will retry automatically
  } else {
    // Other error
    console.error('API error:', error);
  }
}
```

## Best Practices

1. **Use MarketStateStore**: Centralized state management prevents redundant API calls
2. **Subscribe to WebSocket**: Use WebSocket for real-time updates, REST for snapshots
3. **Respect Rate Limits**: Let rate limiters handle throttling automatically
4. **Handle Reconnections**: WebSocket client auto-reconnects on disconnect
5. **Cache Market Universe**: Build once, reuse for session

## Example: Complete Integration

```typescript
import { GammaClient, ClobPublicClient, ClobWsClient } from '@pm-bot/polymarket';
import { MarketStateStore } from '@pm-bot/core';

// Initialize clients
const gamma = new GammaClient();
const clob = new ClobPublicClient();
const ws = new ClobWsClient();
const stateStore = new MarketStateStore();

// Build market universe
const universe = await gamma.buildMarketUniverse(true);
stateStore.setUniverse(universe);

// Connect WebSocket
await ws.connect();

// Subscribe to all tokens
for (const tokenId of stateStore.getAllTokenIds()) {
  ws.subscribe(tokenId);
  
  // Get initial snapshot
  const book = await clob.getBook(tokenId);
  stateStore.updateOrderBook(tokenId, book);
}

// Handle updates
ws.onBookUpdate((update) => {
  stateStore.updateOrderBook(update.tokenId, {
    tokenId: update.tokenId,
    bids: update.bids,
    asks: update.asks,
    timestamp: update.timestamp,
    sequence: update.sequence,
  });
});

ws.onTrade((trade) => {
  stateStore.addTrade({
    tokenId: trade.tokenId,
    price: trade.price,
    size: trade.size,
    side: trade.side,
    timestamp: trade.timestamp,
  });
});
```

