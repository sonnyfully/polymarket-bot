import type { OrderBook, PriceLevel } from '@pm-bot/core';
import Decimal from 'decimal.js';

export class InMemoryOrderBook {
  private book: OrderBook;
  private lastSequence: number | undefined;

  constructor(initialBook: OrderBook) {
    this.book = {
      ...initialBook,
      bids: [...initialBook.bids],
      asks: [...initialBook.asks],
    };
    this.lastSequence = initialBook.sequence;
  }

  getBook(): OrderBook {
    return {
      ...this.book,
      bids: [...this.book.bids],
      asks: [...this.book.asks],
    };
  }

  applyDelta(bids: PriceLevel[], asks: PriceLevel[], sequence?: number): void {
    // Check sequence ordering
    if (sequence !== undefined && this.lastSequence !== undefined) {
      if (sequence <= this.lastSequence) {
        // Stale update, ignore
        return;
      }
    }

    // Apply bid updates
    this.applyLevels(this.book.bids, bids, 'desc');

    // Apply ask updates
    this.applyLevels(this.book.asks, asks, 'asc');

    this.book.lastUpdate = new Date();
    if (sequence !== undefined) {
      this.lastSequence = sequence;
      this.book.sequence = sequence;
    }
  }

  private applyLevels(
    existing: PriceLevel[],
    updates: PriceLevel[],
    sortOrder: 'asc' | 'desc'
  ): void {
    const priceMap = new Map<string, PriceLevel>();
    
    // Add existing levels
    for (const level of existing) {
      priceMap.set(level.price.toString(), level);
    }

    // Apply updates (size 0 means remove)
    for (const update of updates) {
      const key = update.price.toString();
      if (update.size.lte(0)) {
        priceMap.delete(key);
      } else {
        priceMap.set(key, update);
      }
    }

    // Convert back to array and sort
    const levels = Array.from(priceMap.values());
    levels.sort((a, b) => {
      const cmp = a.price.comparedTo(b.price);
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    // Replace existing array
    existing.length = 0;
    existing.push(...levels);
  }

  getBestBid(): Decimal | null {
    return this.book.bids.length > 0 ? this.book.bids[0].price : null;
  }

  getBestAsk(): Decimal | null {
    return this.book.asks.length > 0 ? this.book.asks[0].price : null;
  }

  getMidPrice(): Decimal | null {
    const bid = this.getBestBid();
    const ask = this.getBestAsk();
    if (bid === null || ask === null) {
      return null;
    }
    return bid.plus(ask).div(2);
  }

  getSpread(): Decimal | null {
    const bid = this.getBestBid();
    const ask = this.getBestAsk();
    if (bid === null || ask === null) {
      return null;
    }
    return ask.minus(bid);
  }
}

