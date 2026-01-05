import { describe, it, expect, beforeEach } from 'vitest';
import { TokenBucketRateLimiter } from './rate-limiter.js';

describe('TokenBucketRateLimiter', () => {
  let limiter: TokenBucketRateLimiter;

  beforeEach(() => {
    limiter = new TokenBucketRateLimiter(10, 1); // 10 capacity, 1 token/sec
  });

  it('should allow immediate acquisition when tokens available', async () => {
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // Should be immediate
  });

  it('should wait when tokens exhausted', async () => {
    // Exhaust tokens
    for (let i = 0; i < 10; i++) {
      await limiter.acquire();
    }

    const start = Date.now();
    await limiter.acquire(); // Should wait ~1 second
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThan(900);
    expect(elapsed).toBeLessThan(1200);
  });

  it('should refill tokens over time', async () => {
    // Exhaust tokens
    for (let i = 0; i < 10; i++) {
      await limiter.acquire();
    }

    // Wait for refill
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // Should be immediate after refill
  });

  it('should reset tokens', () => {
    // Exhaust tokens
    for (let i = 0; i < 5; i++) {
      limiter.acquire();
    }

    limiter.reset();

    // Should be able to acquire immediately
    const start = Date.now();
    limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

