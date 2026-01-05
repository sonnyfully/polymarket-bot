export interface RateLimiter {
  acquire(): Promise<void>;
  reset(): void;
}

export class TokenBucketRateLimiter implements RateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second
  private lastRefill: number;

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Exponential backoff: wait for tokens with jitter
    const waitTime = ((1 - this.tokens) / this.refillRate) * 1000;
    const jitter = Math.random() * 100; // 0-100ms jitter
    await new Promise((resolve) => {
      setTimeout(resolve, Math.ceil(waitTime + jitter));
    });
    this.refill();
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  reset(): void {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }
}

export class EndpointRateLimiter {
  private limiters: Map<string, RateLimiter> = new Map();

  getLimiter(endpoint: string, capacity: number, refillRate: number): RateLimiter {
    if (!this.limiters.has(endpoint)) {
      this.limiters.set(endpoint, new TokenBucketRateLimiter(capacity, refillRate));
    }
    return this.limiters.get(endpoint)!;
  }

  reset(endpoint?: string): void {
    if (endpoint) {
      this.limiters.get(endpoint)?.reset();
    } else {
      this.limiters.forEach((limiter) => limiter.reset());
    }
  }
}

