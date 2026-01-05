import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SIMULATION_ONLY: z.string().transform((val) => val === 'true').default('true'),
  LIVE_TRADING: z.string().transform((val) => val === 'true').default('false'),

  // Polymarket API
  POLYMARKET_API_URL: z.string().url().default('https://clob.polymarket.com'),
  POLYMARKET_PRIVATE_KEY: z.string().optional(),
  POLYMARKET_API_KEY: z.string().optional(),

  // Database
  DATABASE_URL: z.string().default('file:./dev.db'),

  // Risk Limits
  MAX_POSITION_PER_MARKET: z.string().transform(Number).default('1000'),
  MAX_DAILY_LOSS: z.string().transform(Number).default('500'),
  MAX_ORDER_RATE_PER_SECOND: z.string().transform(Number).default('10'),
  MAX_GROSS_EXPOSURE: z.string().transform(Number).default('10000'),

  // Strategy Config
  MISPRICING_THRESHOLD: z.string().transform(Number).default('0.02'),
  MIN_BOOK_DEPTH: z.string().transform(Number).default('100'),
  MAX_SLIPPAGE_BPS: z.string().transform(Number).default('50'),

  // Observability
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  METRICS_PORT: z.string().transform(Number).default('9090'),

  // Circuit Breakers
  WEBSOCKET_DISCONNECT_TIMEOUT_MS: z.string().transform(Number).default('30000'),
  PRICE_FEED_STALE_MS: z.string().transform(Number).default('60000'),
  MAX_ERROR_RATE_PER_MINUTE: z.string().transform(Number).default('10'),

  // Market Discovery
  OPENAI_API_KEY: z.string().optional(),
  MARKET_DISCOVERY_SIMILARITY_THRESHOLD: z.string().transform(Number).default('0.82'),
  MAPPING_MIN_CONFIDENCE: z.string().transform(Number).default('0.80'),
  MAPPING_STALENESS_HOURS: z.string().transform(Number).default('24'),
});

export type Config = z.infer<typeof envSchema>;

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.message}`);
  }

  cachedConfig = parsed.data;
  return cachedConfig;
}

export function validateLiveTrading(): void {
  const config = getConfig();
  if (!config.SIMULATION_ONLY && !config.LIVE_TRADING) {
    throw new Error(
      'Live trading requires SIMULATION_ONLY=false AND LIVE_TRADING=true. ' +
      'This is a safety measure to prevent accidental live trading.'
    );
  }
}

