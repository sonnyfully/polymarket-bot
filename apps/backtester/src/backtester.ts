import { Repository } from '@pm-bot/storage';
import type { Strategy, TradingState, Signal } from '@pm-bot/signals';
import type { Market, OrderBook, Trade, Order, Fill, Position } from '@pm-bot/core';
import { InMemoryOrderBook } from '@pm-bot/storage';
import { calculateMidPrice, estimateSlippage } from '@pm-bot/core';
import Decimal from 'decimal.js';

export interface BacktestConfig {
  strategy: Strategy;
  startDate: Date;
  endDate: Date;
  initialCapital: Decimal;
  feeRate: Decimal;
}

export interface BacktestResult {
  initialCapital: Decimal;
  finalCapital: Decimal;
  totalPnl: Decimal;
  sharpeRatio: Decimal | null;
  maxDrawdown: Decimal;
  hitRate: Decimal;
  avgEdge: Decimal;
  totalSlippage: Decimal;
  totalFees: Decimal;
  turnover: Decimal;
  trades: number;
}

export class Backtester {
  private repository: Repository;
  private markets: Map<string, Market> = new Map();
  private orderBooks: Map<string, InMemoryOrderBook> = new Map();
  private positions: Map<string, Position> = new Map();
  private orders: Map<string, Order> = new Map();
  private fills: Fill[] = [];
  private balance: Decimal;
  private initialBalance: Decimal;
  private peakBalance: Decimal;
  private maxDrawdown: Decimal = new Decimal(0);
  private winningTrades: number = 0;
  private losingTrades: number = 0;
  private totalEdge: Decimal = new Decimal(0);
  private totalSlippage: Decimal = new Decimal(0);
  private totalFees: Decimal = new Decimal(0);
  private totalVolume: Decimal = new Decimal(0);

  constructor(repository: Repository) {
    this.repository = repository;
  }

  async run(config: BacktestConfig): Promise<BacktestResult> {
    this.balance = config.initialCapital;
    this.initialBalance = config.initialCapital;
    this.peakBalance = config.initialCapital;

    // Load markets
    const markets = await this.repository.getMarkets(true);
    for (const market of markets) {
      this.markets.set(market.id, market);
    }

    // Load historical data
    const tokenIds: string[] = [];
    for (const market of markets) {
      for (const outcome of market.outcomes) {
        tokenIds.push(outcome.tokenId);
      }
    }

    // Get order book snapshots and trades
    const snapshots = await this.loadSnapshots(tokenIds, config.startDate, config.endDate);
    const trades = await this.loadTrades(tokenIds, config.startDate, config.endDate);

    // Initialize strategy
    const initialState = this.buildState();
    await config.strategy.onStart(initialState);

    // Replay chronologically
    const events = this.buildEventTimeline(snapshots, trades);
    events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    for (const event of events) {
      if (event.type === 'snapshot') {
        this.applySnapshot(event.snapshot);
      } else if (event.type === 'trade') {
        this.applyTrade(event.trade);
      }

      // Run strategy on tick
      const currentState = this.buildState();
      const signals = await config.strategy.onTick(currentState);
      
      // Execute signals
      for (const signal of signals) {
        await this.executeSignal(signal, config.feeRate);
      }
    }

    // Calculate final metrics
    await config.strategy.onStop();
    const results = this.calculateResults();
    return results;
  }

  private async loadSnapshots(
    tokenIds: string[],
    from: Date,
    to: Date
  ): Promise<Array<{ tokenId: string; book: OrderBook; timestamp: Date }>> {
    const snapshots: Array<{ tokenId: string; book: OrderBook; timestamp: Date }> = [];
    
    for (const tokenId of tokenIds) {
      const books = await this.repository.getOrderBookSnapshots(tokenId, from, to);
      for (const book of books) {
        snapshots.push({ tokenId, book, timestamp: book.lastUpdate });
      }
    }

    return snapshots;
  }

  private async loadTrades(
    tokenIds: string[],
    from: Date,
    to: Date
  ): Promise<Trade[]> {
    const allTrades: Trade[] = [];
    
    for (const tokenId of tokenIds) {
      const trades = await this.repository.getTrades(tokenId, 10000);
      for (const trade of trades) {
        if (trade.timestamp >= from && trade.timestamp <= to) {
          allTrades.push(trade);
        }
      }
    }

    return allTrades;
  }

  private buildEventTimeline(
    snapshots: Array<{ tokenId: string; book: OrderBook; timestamp: Date }>,
    trades: Trade[]
  ): Array<{ type: 'snapshot' | 'trade'; timestamp: Date; snapshot?: OrderBook; trade?: Trade }> {
    const events: Array<{ type: 'snapshot' | 'trade'; timestamp: Date; snapshot?: OrderBook; trade?: Trade }> = [];

    for (const snap of snapshots) {
      events.push({ type: 'snapshot', timestamp: snap.timestamp, snapshot: snap.book });
    }

    for (const trade of trades) {
      events.push({ type: 'trade', timestamp: trade.timestamp, trade });
    }

    return events;
  }

  private applySnapshot(book: OrderBook): void {
    const inMemoryBook = this.orderBooks.get(book.tokenId);
    if (inMemoryBook) {
      inMemoryBook.applyDelta(book.bids, book.asks, book.sequence);
    } else {
      this.orderBooks.set(book.tokenId, new InMemoryOrderBook(book));
    }
  }

  private applyTrade(trade: Trade): void {
    // Update order book if needed (simplified)
    // In production, would apply trade to book
  }

  private async executeSignal(signal: Signal, feeRate: Decimal): Promise<void> {
    const book = this.orderBooks.get(signal.tokenId)?.getBook();
    if (!book) return;

    // Simulate fill
    const slippageEst = estimateSlippage(book, signal.side, signal.size);
    if (!slippageEst) return;

    const fillPrice = slippageEst.avgPrice;
    const fee = fillPrice.times(signal.size).times(feeRate);
    const cost = fillPrice.times(signal.size).plus(fee);

    if (cost.gt(this.balance)) {
      return; // Insufficient balance
    }

    // Create fill
    const fill: Fill = {
      id: `backtest-${Date.now()}-${Math.random()}`,
      orderId: `order-${Date.now()}`,
      marketId: signal.marketId,
      tokenId: signal.tokenId,
      side: signal.side,
      price: fillPrice,
      size: signal.size,
      fee,
      timestamp: new Date(),
    };

    this.fills.push(fill);
    this.balance = this.balance.minus(cost);
    this.totalFees = this.totalFees.plus(fee);
    this.totalSlippage = this.totalSlippage.plus(slippageEst.slippage.times(signal.size));
    this.totalVolume = this.totalVolume.plus(signal.size);
    this.totalEdge = this.totalEdge.plus(signal.expectedEdge.times(signal.size));

    // Update position
    const positionKey = `${signal.marketId}-${signal.tokenId}`;
    const existing = this.positions.get(positionKey);
    
    if (existing) {
      const totalSize = existing.size.plus(signal.side === 'buy' ? signal.size : signal.size.neg());
      const totalCost = existing.avgPrice.times(existing.size.abs()).plus(fillPrice.times(signal.size));
      const newAvgPrice = totalSize.abs().gt(0) ? totalCost.div(totalSize.abs()) : fillPrice;
      
      this.positions.set(positionKey, {
        ...existing,
        size: totalSize,
        avgPrice: newAvgPrice,
        lastUpdate: new Date(),
      });
    } else {
      this.positions.set(positionKey, {
        marketId: signal.marketId,
        tokenId: signal.tokenId,
        size: signal.side === 'buy' ? signal.size : signal.size.neg(),
        avgPrice: fillPrice,
        realizedPnl: new Decimal(0),
        unrealizedPnl: new Decimal(0),
        lastUpdate: new Date(),
      });
    }

    // Update drawdown
    if (this.balance.gt(this.peakBalance)) {
      this.peakBalance = this.balance;
    } else {
      const drawdown = this.peakBalance.minus(this.balance);
      if (drawdown.gt(this.maxDrawdown)) {
        this.maxDrawdown = drawdown;
      }
    }

    // Strategy will be notified via onTick
  }

  private buildState(): TradingState {
    const orderBookMap = new Map<string, OrderBook>();
    for (const [tokenId, book] of this.orderBooks.entries()) {
      orderBookMap.set(tokenId, book.getBook());
    }

    return {
      markets: this.markets,
      orderBooks: orderBookMap,
      positions: this.positions,
      openOrders: this.orders,
      timestamp: new Date(),
    };
  }

  private calculateResults(): BacktestResult {
    // Calculate final capital (close all positions at current prices)
    let finalCapital = this.balance;
    for (const position of this.positions.values()) {
      const book = this.orderBooks.get(position.tokenId)?.getBook();
      if (book) {
        const midPrice = calculateMidPrice(book);
        if (midPrice) {
          const pnl = position.size.times(midPrice.minus(position.avgPrice));
          finalCapital = finalCapital.plus(pnl);
        }
      }
    }

    const totalPnl = finalCapital.minus(this.initialBalance);
    const trades = this.fills.length;
    const hitRate = trades > 0 ? new Decimal(this.winningTrades).div(trades) : new Decimal(0);
    const avgEdge = this.totalVolume.gt(0) ? this.totalEdge.div(this.totalVolume) : new Decimal(0);
    const sharpeRatio = this.calculateSharpeRatio();

    return {
      initialCapital: this.initialBalance,
      finalCapital,
      totalPnl,
      sharpeRatio,
      maxDrawdown: this.maxDrawdown,
      hitRate,
      avgEdge,
      totalSlippage: this.totalSlippage,
      totalFees: this.totalFees,
      turnover: this.totalVolume,
      trades,
    };
  }

  private calculateSharpeRatio(): Decimal | null {
    // Simplified Sharpe ratio calculation
    // In production, would use proper returns series
    return null;
  }
}

