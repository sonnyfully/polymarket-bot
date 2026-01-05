import { getConfig } from '@pm-bot/config';
import { createServer } from 'http';
import type { TradingBot } from './trading-bot.js';

export class MetricsServer {
  private server: ReturnType<typeof createServer> | null = null;
  private port: number;

  constructor() {
    const config = getConfig();
    this.port = config.METRICS_PORT;
  }

  start(bot: TradingBot): void {
    this.server = createServer(async (req, res) => {
      if (req.url === '/metrics') {
        const metrics = await this.collectMetrics(bot);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(metrics);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    this.server.listen(this.port, () => {
      console.log(`Metrics server listening on port ${this.port}`);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private async collectMetrics(bot: TradingBot): Promise<string> {
    // Simplified metrics collection
    // In production, would use prom-client or similar
    const lines: string[] = [];

    // Placeholder metrics
    lines.push('# HELP bot_balance Current account balance');
    lines.push('# TYPE bot_balance gauge');
    lines.push('bot_balance 10000');

    lines.push('# HELP bot_positions Number of open positions');
    lines.push('# TYPE bot_positions gauge');
    lines.push('bot_positions 0');

    lines.push('# HELP bot_open_orders Number of open orders');
    lines.push('# TYPE bot_open_orders gauge');
    lines.push('bot_open_orders 0');

    return lines.join('\n') + '\n';
  }
}

