import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';

export interface DailyReport {
  date: string;
  initialBalance: Decimal;
  finalBalance: Decimal;
  totalPnl: Decimal;
  realizedPnl: Decimal;
  unrealizedPnl: Decimal;
  maxDrawdown: Decimal;
  trades: number;
  winningTrades: number;
  losingTrades: number;
  hitRate: Decimal;
  avgEdge: Decimal;
  totalSlippage: Decimal;
  totalFees: Decimal;
  totalSpreadPaid: Decimal;
  turnover: Decimal;
  sharpeRatio: Decimal | null;
}

export class DailyReportGenerator {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async generateReport(date: Date): Promise<DailyReport> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all fills for the day
    const fills = await this.prisma.fill.findMany({
      where: {
        timestamp: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
        order: true,
      },
    });

    // Get positions at end of day
    const positions = await this.prisma.position.findMany();

    // Calculate metrics
    let totalPnl = new Decimal(0);
    let realizedPnl = new Decimal(0);
    let totalSlippage = new Decimal(0);
    let totalFees = new Decimal(0);
    let totalSpreadPaid = new Decimal(0);
    let totalVolume = new Decimal(0);
    let totalEdge = new Decimal(0);
    let winningTrades = 0;
    let losingTrades = 0;

    for (const fill of fills) {
      const price = new Decimal(fill.price);
      const size = new Decimal(fill.size);
      const fee = new Decimal(fill.fee);
      
      // Calculate PnL for this fill (simplified)
      const fillPnl = fill.side === 'buy'
        ? price.times(size).neg().minus(fee)
        : price.times(size).minus(fee);
      
      totalPnl = totalPnl.plus(fillPnl);
      realizedPnl = realizedPnl.plus(fillPnl);
      totalFees = totalFees.plus(fee);
      totalVolume = totalVolume.plus(size);
      
      // Slippage and spread would need to be stored in fill record
      // For now, estimate from order price vs fill price
      if (fill.order) {
        const orderPrice = new Decimal(fill.order.price);
        const slippage = price.minus(orderPrice).abs().times(size);
        totalSlippage = totalSlippage.plus(slippage);
      }

      if (fillPnl.gt(0)) {
        winningTrades++;
      } else if (fillPnl.lt(0)) {
        losingTrades++;
      }
    }

    // Calculate unrealized PnL from positions
    let unrealizedPnl = new Decimal(0);
    for (const position of positions) {
      unrealizedPnl = unrealizedPnl.plus(new Decimal(position.unrealizedPnl));
    }

    // Calculate hit rate
    const trades = fills.length;
    const hitRate = trades > 0
      ? new Decimal(winningTrades).div(trades)
      : new Decimal(0);

    // Average edge (would need to be stored per fill)
    const avgEdge = totalVolume.gt(0)
      ? totalEdge.div(totalVolume)
      : new Decimal(0);

    // Calculate max drawdown (simplified - would need historical balance)
    const maxDrawdown = new Decimal(0); // TODO: Calculate from historical data

    // Sharpe ratio (simplified)
    const sharpeRatio = null; // TODO: Calculate from returns series

    return {
      date: date.toISOString().split('T')[0],
      initialBalance: new Decimal(10000), // TODO: Get from historical data
      finalBalance: new Decimal(10000).plus(totalPnl).plus(unrealizedPnl),
      totalPnl: totalPnl.plus(unrealizedPnl),
      realizedPnl,
      unrealizedPnl,
      maxDrawdown,
      trades,
      winningTrades,
      losingTrades,
      hitRate,
      avgEdge,
      totalSlippage,
      totalFees,
      totalSpreadPaid: new Decimal(0), // TODO: Store in fill record
      turnover: totalVolume,
      sharpeRatio,
    };
  }

  async saveReport(report: DailyReport): Promise<void> {
    // Save to database (would need a DailyReport table)
    // For now, just log it
    console.log('Daily Report:', JSON.stringify(report, null, 2));
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

