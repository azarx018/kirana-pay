export interface AmountLimits {
  min: number;
  max: number;
}

/** Parse and validate an integer rupiah amount. No floating point arithmetic. */
export function parseAmount(raw: unknown, limits: AmountLimits): number {
  const value = typeof raw === 'string' ? raw.trim() : raw;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error('amount must be an integer');
  }
  if (typeof value === 'string' && !/^\d+$/.test(value)) {
    throw new Error('amount must be a positive integer');
  }
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('amount must be a positive integer');
  }
  if (amount < limits.min || amount > limits.max) {
    throw new Error(`amount must be between ${limits.min} and ${limits.max}`);
  }
  return amount;
}
