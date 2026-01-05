import { PrismaClient } from '@prisma/client';
import type { Market, OrderBook, Trade, Position, Order, Fill } from '@pm-bot/core';
import Decimal from 'decimal.js';

export class Repository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // Markets
  async upsertMarket(market: Market): Promise<void> {
    await this.prisma.market.upsert({
      where: { id: market.id },
      update: {
        question: market.question,
        description: market.description,
        conditionId: market.conditionId,
        endDate: market.endDate,
        imageUrl: market.imageUrl,
        active: market.active,
      },
      create: {
        id: market.id,
        question: market.question,
        description: market.description,
        conditionId: market.conditionId,
        endDate: market.endDate,
        imageUrl: market.imageUrl,
        active: market.active,
        outcomes: {
          create: market.outcomes.map((o) => ({
            id: `${market.id}-${o.outcome}`,
            tokenId: o.tokenId,
            outcome: o.outcome,
            decimals: o.decimals,
          })),
        },
      },
    });
  }

  async getMarkets(active?: boolean): Promise<Market[]> {
    const markets = await this.prisma.market.findMany({
      where: active !== undefined ? { active } : undefined,
      include: { outcomes: true },
    });

    return markets.map((m) => ({
      id: m.id,
      question: m.question,
      description: m.description || undefined,
      conditionId: m.conditionId,
      outcomes: m.outcomes.map((o) => ({
        tokenId: o.tokenId,
        outcome: o.outcome,
        marketId: m.id,
        decimals: o.decimals,
      })),
      endDate: m.endDate || undefined,
      imageUrl: m.imageUrl || undefined,
      active: m.active,
    }));
  }

  // OrderBook snapshots
  async saveOrderBookSnapshot(book: OrderBook): Promise<void> {
    await this.prisma.orderBookSnapshot.create({
      data: {
        tokenId: book.tokenId,
        marketId: book.marketId,
        bids: JSON.stringify(book.bids.map((l) => [l.price.toString(), l.size.toString()])),
        asks: JSON.stringify(book.asks.map((l) => [l.price.toString(), l.size.toString()])),
        sequence: book.sequence || null,
        timestamp: book.lastUpdate,
      },
    });
  }

  async getOrderBookSnapshots(
    tokenId: string,
    from: Date,
    to: Date
  ): Promise<OrderBook[]> {
    const snapshots = await this.prisma.orderBookSnapshot.findMany({
      where: {
        tokenId,
        timestamp: { gte: from, lte: to },
      },
      orderBy: { timestamp: 'asc' },
    });

    return snapshots.map((s) => ({
      marketId: s.marketId,
      tokenId: s.tokenId,
      bids: JSON.parse(s.bids).map(([p, sz]: [string, string]) => ({
        price: new Decimal(p),
        size: new Decimal(sz),
      })),
      asks: JSON.parse(s.asks).map(([p, sz]: [string, string]) => ({
        price: new Decimal(p),
        size: new Decimal(sz),
      })),
      lastUpdate: s.timestamp,
      sequence: s.sequence || undefined,
    }));
  }

  // Trades
  async saveTrade(trade: Trade): Promise<void> {
    await this.prisma.trade.upsert({
      where: { id: trade.id },
      update: {
        price: trade.price.toString(),
        size: trade.size.toString(),
        side: trade.side,
        timestamp: trade.timestamp,
        taker: trade.taker || null,
        maker: trade.maker || null,
      },
      create: {
        id: trade.id,
        marketId: trade.marketId,
        tokenId: trade.tokenId,
        price: trade.price.toString(),
        size: trade.size.toString(),
        side: trade.side,
        timestamp: trade.timestamp,
        taker: trade.taker || null,
        maker: trade.maker || null,
      },
    });
  }

  async getTrades(tokenId: string, limit: number = 100): Promise<Trade[]> {
    const trades = await this.prisma.trade.findMany({
      where: { tokenId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return trades.map((t) => ({
      id: t.id,
      marketId: t.marketId,
      tokenId: t.tokenId,
      price: new Decimal(t.price),
      size: new Decimal(t.size),
      side: t.side as 'buy' | 'sell',
      timestamp: t.timestamp,
      taker: t.taker || undefined,
      maker: t.maker || undefined,
    }));
  }

  // Positions
  async upsertPosition(position: Position): Promise<void> {
    await this.prisma.position.upsert({
      where: {
        marketId_tokenId: {
          marketId: position.marketId,
          tokenId: position.tokenId,
        },
      },
      update: {
        size: position.size.toString(),
        avgPrice: position.avgPrice.toString(),
        realizedPnl: position.realizedPnl.toString(),
        unrealizedPnl: position.unrealizedPnl.toString(),
        lastUpdate: position.lastUpdate,
      },
      create: {
        id: `${position.marketId}-${position.tokenId}`,
        marketId: position.marketId,
        tokenId: position.tokenId,
        size: position.size.toString(),
        avgPrice: position.avgPrice.toString(),
        realizedPnl: position.realizedPnl.toString(),
        unrealizedPnl: position.unrealizedPnl.toString(),
        lastUpdate: position.lastUpdate,
      },
    });
  }

  async getPositions(): Promise<Position[]> {
    const positions = await this.prisma.position.findMany();

    return positions.map((p) => ({
      marketId: p.marketId,
      tokenId: p.tokenId,
      size: new Decimal(p.size),
      avgPrice: new Decimal(p.avgPrice),
      realizedPnl: new Decimal(p.realizedPnl),
      unrealizedPnl: new Decimal(p.unrealizedPnl),
      lastUpdate: p.lastUpdate,
    }));
  }

  // Orders
  async saveOrder(order: Order): Promise<void> {
    await this.prisma.order.upsert({
      where: { id: order.id },
      update: {
        price: order.price.toString(),
        size: order.size.toString(),
        filledSize: order.filledSize.toString(),
        status: order.status,
        reason: order.reason || null,
        updatedAt: order.updatedAt,
      },
      create: {
        id: order.id,
        marketId: order.marketId,
        tokenId: order.tokenId,
        side: order.side,
        type: order.type,
        price: order.price.toString(),
        size: order.size.toString(),
        filledSize: order.filledSize.toString(),
        status: order.status,
        clientOrderId: order.clientOrderId || null,
        reason: order.reason || null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    });
  }

  async getOpenOrders(): Promise<Order[]> {
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['pending', 'open', 'partially_filled'] },
      },
    });

    return orders.map((o) => ({
      id: o.id,
      marketId: o.marketId,
      tokenId: o.tokenId,
      side: o.side as 'buy' | 'sell',
      type: o.type as 'limit' | 'market',
      price: new Decimal(o.price),
      size: new Decimal(o.size),
      filledSize: new Decimal(o.filledSize),
      status: o.status as Order['status'],
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      clientOrderId: o.clientOrderId || undefined,
      reason: o.reason || undefined,
    }));
  }

  // Fills
  async saveFill(fill: Fill): Promise<void> {
    await this.prisma.fill.create({
      data: {
        id: fill.id,
        orderId: fill.orderId,
        marketId: fill.marketId,
        tokenId: fill.tokenId,
        side: fill.side,
        price: fill.price.toString(),
        size: fill.size.toString(),
        fee: fill.fee.toString(),
        timestamp: fill.timestamp,
      },
    });
  }

  async getFills(orderId?: string, limit: number = 100): Promise<Fill[]> {
    const fills = await this.prisma.fill.findMany({
      where: orderId ? { orderId } : undefined,
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return fills.map((f) => ({
      id: f.id,
      orderId: f.orderId,
      marketId: f.marketId,
      tokenId: f.tokenId,
      side: f.side as 'buy' | 'sell',
      price: new Decimal(f.price),
      size: new Decimal(f.size),
      fee: new Decimal(f.fee),
      timestamp: f.timestamp,
    }));
  }
}

