import type { ExperimentMetrics, DailyMetrics, RelationStats } from './metrics.js';
import Decimal from 'decimal.js';

export class Reporter {
  /**
   * Generate CLI summary table
   */
  static generateCLISummary(metrics: ExperimentMetrics): string {
    const lines: string[] = [];

    lines.push('='.repeat(80));
    lines.push(`Experiment Summary: ${Array.isArray(metrics.strategy) ? metrics.strategy.join(', ') : metrics.strategy}`);
    lines.push('='.repeat(80));
    lines.push('');
    lines.push(`Period: ${metrics.startDate.toISOString().split('T')[0]} to ${metrics.endDate.toISOString().split('T')[0]}`);
    lines.push(`Initial Capital: $${metrics.initialCapital.toString()}`);
    lines.push(`Final Capital: $${metrics.finalCapital.toString()}`);
    lines.push(`Total PnL: $${metrics.totalPnl.toString()}`);
    lines.push(`Total Return: ${metrics.totalReturn.toFixed(2)}%`);
    lines.push(`Max Drawdown: $${metrics.maxDrawdown.toString()}`);
    lines.push('');

    lines.push('Overall Statistics:');
    lines.push(`  Total Signals: ${metrics.overallStats.totalSignals}`);
    lines.push(`  Total Fills: ${metrics.overallStats.totalFills}`);
    lines.push(`  Total Turnover: $${metrics.overallStats.totalTurnover.toString()}`);
    lines.push(`  Avg Hit Rate: ${(metrics.overallStats.avgHitRate * 100).toFixed(2)}%`);
    lines.push(`  Avg Edge (bps): ${metrics.overallStats.avgEdgeBps.toFixed(2)}`);
    lines.push(`  Avg Spread (bps): ${metrics.overallStats.avgSpreadBps.toFixed(2)}`);
    lines.push(`  Avg Slippage (bps): ${metrics.overallStats.avgSlippageBps.toFixed(2)}`);
    lines.push('');

    // Daily breakdown
    if (metrics.dailyMetrics.length > 0) {
      lines.push('Daily Breakdown:');
      lines.push('  Date       | Strategy | PnL      | Signals | Fills | Turnover');
      lines.push('  ' + '-'.repeat(70));
      for (const daily of metrics.dailyMetrics.slice(0, 10)) { // Show first 10 days
        lines.push(
          `  ${daily.date} | ${daily.strategy.padEnd(8)} | $${daily.totalPnl.toFixed(2).padStart(8)} | ${daily.signalCount.toString().padStart(7)} | ${daily.fillCount.toString().padStart(5)} | $${daily.turnover.toFixed(2)}`
        );
      }
      if (metrics.dailyMetrics.length > 10) {
        lines.push(`  ... (${metrics.dailyMetrics.length - 10} more days)`);
      }
      lines.push('');
    }

    // Relation stats (if available)
    if (metrics.relationStats.length > 0) {
      lines.push('Top Relations by Count:');
      const sorted = [...metrics.relationStats].sort((a, b) => b.count - a.count).slice(0, 5);
      for (const rel of sorted) {
        lines.push(
          `  ${rel.relationKind}: ${rel.count} trades, PnL: $${rel.pnl.toFixed(2)}, Avg Edge: ${rel.avgEdgeBps.toFixed(2)} bps`
        );
      }
      lines.push('');
    }

    lines.push('='.repeat(80));

    return lines.join('\n');
  }

  /**
   * Generate JSON output for plotting
   */
  static generateJSON(metrics: ExperimentMetrics): string {
    return JSON.stringify(
      {
        ...metrics,
        initialCapital: metrics.initialCapital.toString(),
        finalCapital: metrics.finalCapital.toString(),
        totalPnl: metrics.totalPnl.toString(),
        totalReturn: metrics.totalReturn.toString(),
        maxDrawdown: metrics.maxDrawdown.toString(),
        dailyMetrics: metrics.dailyMetrics.map((d) => ({
          ...d,
          realizedPnl: d.realizedPnl.toString(),
          unrealizedPnl: d.unrealizedPnl.toString(),
          totalPnl: d.totalPnl.toString(),
          maxDrawdown: d.maxDrawdown.toString(),
          turnover: d.turnover.toString(),
          avgNetEdgeBps: d.avgNetEdgeBps.toString(),
          avgSpreadBps: d.avgSpreadBps.toString(),
          avgSlippageBps: d.avgSlippageBps.toString(),
          avgGrossExposure: d.avgGrossExposure.toString(),
          maxGrossExposure: d.maxGrossExposure.toString(),
          worstDay: d.worstDay.toString(),
          concentration: Object.fromEntries(
            Object.entries(d.concentration).map(([k, v]) => [k, v.toString()])
          ),
          pnlDistribution: {
            mean: d.pnlDistribution.mean.toString(),
            std: d.pnlDistribution.std.toString(),
            skew: d.pnlDistribution.skew.toString(),
          },
        })),
        relationStats: metrics.relationStats.map((r) => ({
          ...r,
          pnl: r.pnl.toString(),
          avgEdgeBps: r.avgEdgeBps.toString(),
        })),
        overallStats: {
          ...metrics.overallStats,
          totalTurnover: metrics.overallStats.totalTurnover.toString(),
          avgEdgeBps: metrics.overallStats.avgEdgeBps.toString(),
          avgSpreadBps: metrics.overallStats.avgSpreadBps.toString(),
          avgSlippageBps: metrics.overallStats.avgSlippageBps.toString(),
        },
      },
      null,
      2
    );
  }
}

