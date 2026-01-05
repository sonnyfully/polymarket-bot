import WebSocket from 'ws';
import Decimal from 'decimal.js';
import type { OrderBook, PriceLevel } from './clob-public-client.js';

export interface BookUpdate {
  tokenId: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
  sequence?: number;
  timestamp: Date;
}

export interface TradeUpdate {
  tokenId: string;
  price: Decimal;
  size: Decimal;
  side: 'buy' | 'sell';
  timestamp: Date;
}

export type BookUpdateCallback = (update: BookUpdate) => void;
export type TradeUpdateCallback = (update: TradeUpdate) => void;
export type ErrorCallback = (error: Error) => void;

export class ClobWsClient {
  private ws: WebSocket | null = null;
  private wsUrl = 'wss://ws-subscriptions-clob.polymarket.com';
  private reconnectInterval = 5000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private subscribedTokens: Set<string> = new Set();

  private onBookUpdateCallbacks: BookUpdateCallback[] = [];
  private onTradeCallbacks: TradeUpdateCallback[] = [];
  private onErrorCallbacks: ErrorCallback[] = [];

  constructor() {
    // No rate limiting needed for WebSocket
  }

  connect(): Promise<void> {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.isConnecting = true;

      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          this.isConnecting = false;
          this.clearReconnectTimer();
          
          // Resubscribe to all tokens
          for (const tokenId of this.subscribedTokens) {
            this.subscribe(tokenId);
          }
          
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            this.emitError(error instanceof Error ? error : new Error(String(error)));
          }
        });

        this.ws.on('error', (error) => {
          this.isConnecting = false;
          this.emitError(error);
          reject(error);
        });

        this.ws.on('close', () => {
          this.isConnecting = false;
          this.scheduleReconnect();
        });
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribedTokens.clear();
  }

  subscribe(tokenId: string): void {
    this.subscribedTokens.add(tokenId);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        channel: `market:${tokenId}`,
      }));
    }
  }

  unsubscribe(tokenId: string): void {
    this.subscribedTokens.delete(tokenId);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'unsubscribe',
        channel: `market:${tokenId}`,
      }));
    }
  }

  onBookUpdate(callback: BookUpdateCallback): void {
    this.onBookUpdateCallbacks.push(callback);
  }

  onTrade(callback: TradeUpdateCallback): void {
    this.onTradeCallbacks.push(callback);
  }

  onError(callback: ErrorCallback): void {
    this.onErrorCallbacks.push(callback);
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private handleMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) {
      return;
    }

    const msg = message as Record<string, unknown>;

    if (msg.type === 'book_update' || msg.type === 'orderbook') {
      this.handleBookUpdate(msg);
    } else if (msg.type === 'trade') {
      this.handleTrade(msg);
    }
  }

  private handleBookUpdate(msg: Record<string, unknown>): void {
    const tokenId = msg.token_id as string;
    const bids = (msg.bids as Array<[string, string]> || []).map(([price, size]) => ({
      price: new Decimal(price),
      size: new Decimal(size),
    }));
    const asks = (msg.asks as Array<[string, string]> || []).map(([price, size]) => ({
      price: new Decimal(price),
      size: new Decimal(size),
    }));

    const update: BookUpdate = {
      tokenId,
      bids,
      asks,
      sequence: msg.sequence as number | undefined,
      timestamp: new Date(),
    };

    this.onBookUpdateCallbacks.forEach((cb) => cb(update));
  }

  private handleTrade(msg: Record<string, unknown>): void {
    const tokenId = msg.token_id as string;
    const price = new Decimal(msg.price as string);
    const size = new Decimal(msg.size as string);
    const side = (msg.side as string) === 'buy' ? 'buy' : 'sell';

    const update: TradeUpdate = {
      tokenId,
      price,
      size,
      side,
      timestamp: new Date(msg.timestamp as string || Date.now()),
    };

    this.onTradeCallbacks.forEach((cb) => cb(update));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // Error already handled
      });
    }, this.reconnectInterval);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitError(error: Error): void {
    this.onErrorCallbacks.forEach((cb) => cb(error));
  }
}

