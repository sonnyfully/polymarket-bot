import WebSocket from 'ws';
import type { OrderBook, Trade, Order, Fill } from '@pm-bot/core';
import Decimal from 'decimal.js';

export interface WebSocketMessage {
  type: string;
  channel?: string;
  data?: unknown;
}

export interface BookUpdateMessage {
  type: 'book_update';
  token_id: string;
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
  sequence?: number;
}

export interface TradeMessage {
  type: 'trade';
  token_id: string;
  price: string;
  size: string;
  side: 'buy' | 'sell';
  timestamp: string;
}

export interface OrderUpdateMessage {
  type: 'order_update';
  order_id: string;
  status: string;
  filled: string;
}

export interface FillMessage {
  type: 'fill';
  order_id: string;
  token_id: string;
  price: string;
  size: string;
  fee: string;
  timestamp: string;
}

export type BookUpdateCallback = (tokenId: string, book: OrderBook) => void;
export type TradeCallback = (trade: Trade) => void;
export type OrderUpdateCallback = (order: Order) => void;
export type FillCallback = (fill: Fill) => void;
export type ErrorCallback = (error: Error) => void;

export class PolymarketWebSocketClient {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private reconnectInterval: number = 5000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting: boolean = false;
  private subscribedChannels: Set<string> = new Set();

  // Callbacks
  private onBookUpdateCallbacks: BookUpdateCallback[] = [];
  private onTradeCallbacks: TradeCallback[] = [];
  private onOrderUpdateCallbacks: OrderUpdateCallback[] = [];
  private onFillCallbacks: FillCallback[] = [];
  private onErrorCallbacks: ErrorCallback[] = [];

  constructor(wsUrl: string = 'wss://clob-ws.polymarket.com') {
    this.wsUrl = wsUrl;
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
          // Resubscribe to all channels
          this.subscribedChannels.forEach((channel) => {
            this.send({ type: 'subscribe', channel });
          });
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString()) as WebSocketMessage;
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
    this.subscribedChannels.clear();
  }

  subscribeMarket(tokenId: string): void {
    const channel = `market:${tokenId}`;
    this.subscribedChannels.add(channel);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'subscribe', channel });
    }
  }

  unsubscribeMarket(tokenId: string): void {
    const channel = `market:${tokenId}`;
    this.subscribedChannels.delete(channel);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'unsubscribe', channel });
    }
  }

  subscribeUser(userId: string): void {
    const channel = `user:${userId}`;
    this.subscribedChannels.add(channel);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'subscribe', channel });
    }
  }

  onBookUpdate(callback: BookUpdateCallback): void {
    this.onBookUpdateCallbacks.push(callback);
  }

  onTrade(callback: TradeCallback): void {
    this.onTradeCallbacks.push(callback);
  }

  onOrderUpdate(callback: OrderUpdateCallback): void {
    this.onOrderUpdateCallbacks.push(callback);
  }

  onFill(callback: FillCallback): void {
    this.onFillCallbacks.push(callback);
  }

  onError(callback: ErrorCallback): void {
    this.onErrorCallbacks.push(callback);
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private send(message: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(message: WebSocketMessage): void {
    switch (message.type) {
      case 'book_update':
        this.handleBookUpdate(message as unknown as BookUpdateMessage);
        break;
      case 'trade':
        this.handleTrade(message as unknown as TradeMessage);
        break;
      case 'order_update':
        this.handleOrderUpdate(message as unknown as OrderUpdateMessage);
        break;
      case 'fill':
        this.handleFill(message as unknown as FillMessage);
        break;
      default:
        // Unknown message type, ignore
        break;
    }
  }

  private handleBookUpdate(msg: BookUpdateMessage): void {
    const book: OrderBook = {
      marketId: '', // Will be filled by caller
      tokenId: msg.token_id,
      bids: msg.bids.map(([price, size]) => ({
        price: new Decimal(price),
        size: new Decimal(size),
      })),
      asks: msg.asks.map(([price, size]) => ({
        price: new Decimal(price),
        size: new Decimal(size),
      })),
      lastUpdate: new Date(),
      sequence: msg.sequence,
    };

    this.onBookUpdateCallbacks.forEach((cb) => cb(msg.token_id, book));
  }

  private handleTrade(msg: TradeMessage): void {
    const trade: Trade = {
      id: `${msg.token_id}-${msg.timestamp}`,
      marketId: '',
      tokenId: msg.token_id,
      price: new Decimal(msg.price),
      size: new Decimal(msg.size),
      side: msg.side,
      timestamp: new Date(msg.timestamp),
    };

    this.onTradeCallbacks.forEach((cb) => cb(trade));
  }

  private handleOrderUpdate(msg: OrderUpdateMessage): void {
    // This would need to be mapped to full Order object
    // For now, we'll emit a partial update
    const order: Partial<Order> = {
      id: msg.order_id,
      status: this.mapOrderStatus(msg.status),
      filledSize: new Decimal(msg.filled),
    };

    this.onOrderUpdateCallbacks.forEach((cb) => cb(order as Order));
  }

  private handleFill(msg: FillMessage): void {
    const fill: Fill = {
      id: `${msg.order_id}-${msg.timestamp}`,
      orderId: msg.order_id,
      marketId: '',
      tokenId: msg.token_id,
      side: 'buy', // Would need to be determined from order
      price: new Decimal(msg.price),
      size: new Decimal(msg.size),
      fee: new Decimal(msg.fee),
      timestamp: new Date(msg.timestamp),
    };

    this.onFillCallbacks.forEach((cb) => cb(fill));
  }

  private mapOrderStatus(status: string): Order['status'] {
    const statusMap: Record<string, Order['status']> = {
      pending: 'pending',
      open: 'open',
      filled: 'filled',
      partially_filled: 'partially_filled',
      cancelled: 'cancelled',
      rejected: 'rejected',
    };
    return statusMap[status] || 'pending';
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

