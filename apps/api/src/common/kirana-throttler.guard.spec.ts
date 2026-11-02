import { retryAfterSeconds } from './kirana-throttler.guard';

describe('retryAfterSeconds', () => {
  it('rounds up and never answers less than one second', () => {
    expect(retryAfterSeconds({ timeToExpire: 12.2 })).toBe(13);
    expect(retryAfterSeconds({ timeToExpire: 0 })).toBe(1);
    expect(retryAfterSeconds({ timeToExpire: 0.001 })).toBe(1);
  });
  it('uses the block time when the caller is blocked', () => {
    expect(retryAfterSeconds({ timeToExpire: 5, timeToBlockExpire: 40, isBlocked: true })).toBe(40);
    expect(retryAfterSeconds({ timeToExpire: 5, timeToBlockExpire: 40, isBlocked: false })).toBe(5);
  });
});
