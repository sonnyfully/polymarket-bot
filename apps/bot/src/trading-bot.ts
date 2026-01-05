import { getConfig, validateLiveTrading } from '@pm-bot/config';
import { PolymarketRestClient, PolymarketWebSocketClient } from '@pm-bot/polymarket';
import { Repository } from '@pm-bot/storage';
import { OrderManager } from '@pm-bot/execution';
import { RiskManager } from '@pm-bot/risk';
import { MarketIngestion } from './market-ingestion.js';
import type { Strategy, TradingState, Signal, Fill } from '@pm-bot/signals';
import type { Position, Order } from '@pm-bot/core';
import { logger } from './logger.js';
import Decimal from 'decimal.js';

export class TradingBot {
  private config: ReturnType<typeof getConfig>;
  private isPaperTrading: boolean;
  private restClient: PolymarketRestClient;
  private wsClient: PolymarketWebSocketClient;
  private repository: Repository;
  private marketIngestion: MarketIngestion;
  private orderManager: OrderManager;
  private riskManager: RiskManager;
  private strategies: Strategy[] = [];
  private isRunning: boolean = false;
  private tickInterval: NodeJS.Timeout | null = null;
  private balance: Decimal = new Decimal(10000); // Starting balance

  constructor(strategies: Strategy[]) {
    this.config = getConfig();
    this.isPaperTrading = this.config.SIMULATION_ONLY || !this.config.LIVE_TRADING;
    
    if (!this.isPaperTrading) {
      validateLiveTrading();
    }

    this.restClient = new PolymarketRestClient();
    this.wsClient = new PolymarketWebSocketClient();
    this.repository = new Repository();
    this.marketIngestion = new MarketIngestion(
      this.restClient,
      this.wsClient,
      this.repository
    );
    this.orderManager = new OrderManager(
      this.restClient,
      this.repository,
      this.isPaperTrading
    );
    this.riskManager = new RiskManager();
    this.strategies = strategies;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }

    logger.info({ paperTrading: this.isPaperTrading }, 'Starting trading bot');

    // Initialize strategies
    const state = await this.buildTradingState();
    for (const strategy of this.strategies) {
      await strategy.onStart(state);
    }

    // Connect to WebSocket
    await this.marketIngestion.connectWebSocket();

    // Sync markets and order books
    await this.marketIngestion.syncMarkets(true);
    const markets = this.marketIngestion.getMarkets();
    const tokenIds: string[] = [];
    for (const market of markets.values()) {
      for (const outcome of market.outcomes) {
        tokenIds.push(outcome.tokenId);
      }
    }
    await this.marketIngestion.syncOrderBooks(tokenIds);

    // Start tick loop
    this.isRunning = true;
    this.tickInterval = setInterval(() => {
      this.tick().catch((err) => {
        logger.error({ err }, 'Error in tick loop');
        this.riskManager.recordError();
      });
    }, 5000); // 5 second ticks

    logger.info('Trading bot started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping trading bot');

    this.isRunning = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    // Stop strategies
    for (const strategy of this.strategies) {
      await strategy.onStop();
    }

    // Cancel all open orders
    const openOrders = this.orderManager.getOpenOrders();
    for (const order of openOrders) {
      try {
        await this.orderManager.cancelOrder(order.id);
      } catch (err) {
        logger.error({ err, orderId: order.id }, 'Failed to cancel order');
      }
    }

    // Disconnect
    this.wsClient.disconnect();
    await this.repository.disconnect();

    logger.info('Trading bot stopped');
  }

  private async tick(): Promise<void> {
    // Check kill switch
    if (this.riskManager.checkKillSwitch()) {
      logger.warn('Kill switch activated, stopping bot');
      await this.stop();
      return;
    }

    // Check circuit breakers
    const circuitCheck = this.riskManager.checkCircuitBreakers(
      this.marketIngestion.isWebSocketConnected(),
      this.marketIngestion.getWsDisconnectTime(),
      this.getLatestPriceUpdate()
    );

    if (!circuitCheck.allowed) {
      logger.warn({ reason: circuitCheck.reason }, 'Circuit breaker triggered');
      return;
    }

    // Build trading state
    const state = await this.buildTradingState();

    // Update risk metrics
    this.updateRiskMetrics(state);

    // Run strategies
    const allSignals: Signal[] = [];
    for (const strategy of this.strategies) {
      try {
        const signals = await strategy.onTick(state);
        allSignals.push(...signals);
      } catch (err) {
        logger.error({ err, strategy: strategy.name }, 'Strategy error');
        this.riskManager.recordError();
      }
    }

    // Process signals through risk gate and execution
    for (const signal of allSignals) {
      await this.processSignal(signal, state);
    }

    // Sync open orders
    await this.orderManager.syncOpenOrders();
  }

  private async processSignal(signal: Signal, state: TradingState): Promise<void> {
    // Risk checks
    const position = state.positions.get(`${signal.marketId}-${signal.tokenId}`);
    
    const riskChecks = [
      this.riskManager.checkKillSwitch(),
      this.riskManager.checkDailyLoss(this.balance),
      this.riskManager.checkPositionLimit(
        signal.marketId,
        signal.tokenId,
        position || null,
        signal.size
      ),
      this.riskManager.checkGrossExposure(Array.from(state.positions.values())),
      this.riskManager.checkOrderRate(),
    ];

    for (const check of riskChecks) {
      if (!check.allowed) {
        logger.debug({ reason: check.reason, signal }, 'Signal rejected by risk check');
        return;
      }
    }

    // Calculate position size
    const adjustedSize = this.riskManager.calculatePositionSize(
      signal.size,
      this.balance
    );

    if (adjustedSize.lte(0)) {
      logger.debug({ signal }, 'Signal size adjusted to zero');
      return;
    }

    // Get order book
    const book = state.orderBooks.get(signal.tokenId);
    if (!book) {
      logger.debug({ signal }, 'No order book available for signal');
      return;
    }

    // Place order
    const result = await this.orderManager.placeOrder(
      {
        tokenId: signal.tokenId,
        marketId: signal.marketId,
        side: signal.side,
        price: signal.price,
        size: adjustedSize,
        reason: signal.reason,
      },
      book
    );

    if (result.order) {
      logger.info({ order: result.order, signal }, 'Order placed');
    } else {
      logger.warn({ error: result.error, signal }, 'Order rejected');
    }
  }

  private async buildTradingState(): Promise<TradingState> {
    const markets = this.marketIngestion.getMarkets();
    const orderBooks = this.marketIngestion.getAllOrderBooks();
    const positions = await this.repository.getPositions();
    const openOrders = this.orderManager.getOpenOrders();

    const positionMap = new Map<string, Position>();
    for (const pos of positions) {
      positionMap.set(`${pos.marketId}-${pos.tokenId}`, pos);
    }

    const orderMap = new Map<string, Order>();
    for (const order of openOrders) {
      orderMap.set(order.id, order);
    }

    return {
      markets,
      orderBooks,
      positions: positionMap,
      openOrders: orderMap,
      timestamp: new Date(),
    };
  }

  private updateRiskMetrics(state: TradingState): void {
    // Calculate unrealized PnL from positions
    let totalPnl = new Decimal(0);
    for (const position of state.positions.values()) {
      const book = state.orderBooks.get(position.tokenId);
      if (book) {
        const midPrice = book.bids.length > 0 && book.asks.length > 0
          ? book.bids[0].price.plus(book.asks[0].price).div(2)
          : position.avgPrice;

        const unrealizedPnl = position.size.times(midPrice.minus(position.avgPrice));
        totalPnl = totalPnl.plus(position.realizedPnl).plus(unrealizedPnl);
      } else {
        totalPnl = totalPnl.plus(position.realizedPnl);
      }
    }

    const currentBalance = this.balance.plus(totalPnl);
    this.riskManager.updateDrawdown(currentBalance);
  }

  private getLatestPriceUpdate(): Date | null {
    const markets = this.marketIngestion.getMarkets();
    let latest: Date | null = null;
    for (const market of markets.values()) {
      for (const outcome of market.outcomes) {
        const update = this.marketIngestion.getLastPriceUpdate(outcome.tokenId);
        if (update && (!latest || update > latest)) {
          latest = update;
        }
      }
    }
    return latest;
  }

  async handleFill(fill: Fill): Promise<void> {
    await this.orderManager.recordFill(fill);

    const state = await this.buildTradingState();
    for (const strategy of this.strategies) {
      await strategy.onFill(fill, state);
    }
  }
}

