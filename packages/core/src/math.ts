import Decimal from 'decimal.js';

export class EMA {
  private alpha: Decimal;
  private value: Decimal | null = null;

  constructor(period: number) {
    this.alpha = new Decimal(2).div(period + 1);
  }

  update(price: Decimal): Decimal {
    if (this.value === null) {
      this.value = price;
    } else {
      this.value = this.alpha.times(price).plus(new Decimal(1).minus(this.alpha).times(this.value));
    }
    return this.value;
  }

  getValue(): Decimal | null {
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}

export function calculateVolatility(
  prices: Decimal[],
  _window: number = 20
): Decimal {
  if (prices.length < 2) {
    return new Decimal(0);
  }

  const returns: Decimal[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1].gt(0)) {
      returns.push(prices[i].minus(prices[i - 1]).div(prices[i - 1]));
    }
  }

  if (returns.length === 0) {
    return new Decimal(0);
  }

  const mean = returns.reduce((sum, r) => sum.plus(r), new Decimal(0)).div(returns.length);
  const variance = returns
    .reduce((sum, r) => sum.plus(r.minus(mean).pow(2)), new Decimal(0))
    .div(returns.length);

  return variance.sqrt();
}

export function kellyFraction(
  winProb: Decimal,
  winAmount: Decimal,
  lossAmount: Decimal
): Decimal {
  if (lossAmount.lte(0) || winAmount.lte(0)) {
    return new Decimal(0);
  }
  const q = new Decimal(1).minus(winProb);
  const b = winAmount.div(lossAmount);
  const kelly = winProb.minus(q.div(b));
  return Decimal.max(0, Decimal.min(1, kelly));
}

export function fixedFractionalSize(
  accountBalance: Decimal,
  riskPerTrade: Decimal,
  stopLoss: Decimal
): Decimal {
  if (stopLoss.lte(0)) {
    return new Decimal(0);
  }
  return accountBalance.times(riskPerTrade).div(stopLoss.abs());
}

