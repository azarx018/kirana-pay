import { parseAmount } from './amount.util';

const limits = { min: 1, max: 100_000_000 };

describe('parseAmount', () => {
  it('accepts integers as string or number', () => {
    expect(parseAmount('2300', limits)).toBe(2300);
    expect(parseAmount(150000, limits)).toBe(150000);
  });

  it('rejects floats, zero, negatives and junk', () => {
    expect(() => parseAmount('23.5', limits)).toThrow();
    expect(() => parseAmount(0, limits)).toThrow();
    expect(() => parseAmount(-1, limits)).toThrow();
    expect(() => parseAmount('abc', limits)).toThrow();
    expect(() => parseAmount('', limits)).toThrow();
  });

  it('enforces configured limits', () => {
    expect(() => parseAmount(100_000_001, limits)).toThrow();
  });
});
