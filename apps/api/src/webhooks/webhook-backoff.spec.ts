import { backoffSeconds, effectiveDelaySeconds, shouldRetry } from './webhook-backoff';

describe('webhook backoff', () => {
  it('follows the documented schedule with jitter', () => {
    const fixed = () => 0.5; // jitter factor 1.0
    expect(backoffSeconds(1, fixed)).toBe(30);
    expect(backoffSeconds(2, fixed)).toBe(120);
    expect(backoffSeconds(3, fixed)).toBe(600);
    expect(backoffSeconds(7, fixed)).toBe(21_600);
  });

  it('clamps jitter to ±20% and never returns 0', () => {
    expect(backoffSeconds(1, () => 0)).toBe(24);
    expect(backoffSeconds(1, () => 1)).toBe(36);
    expect(backoffSeconds(1, () => 0.999)).toBeGreaterThanOrEqual(1);
  });

  it('repeats the last step instead of growing forever', () => {
    expect(backoffSeconds(20, () => 0.5)).toBe(21_600);
  });

  it('honours Retry-After but never below the normal backoff and never above 1 hour', () => {
    expect(effectiveDelaySeconds(1, 5, () => 0.5)).toBe(30); // too soon → backoff wins
    expect(effectiveDelaySeconds(1, 300, () => 0.5)).toBe(300);
    expect(effectiveDelaySeconds(1, 86_400, () => 0.5)).toBe(3600); // clamped
  });

  it('stops retrying at max attempts or max age', () => {
    const first = new Date('2026-11-02T00:00:00Z');
    expect(shouldRetry({ attemptCount: 7, maxAttempts: 8, firstAttemptAt: first, maxAgeHours: 24, now: new Date('2026-11-02T01:00:00Z') })).toBe(true);
    expect(shouldRetry({ attemptCount: 8, maxAttempts: 8, firstAttemptAt: first, maxAgeHours: 24, now: new Date('2026-11-02T01:00:00Z') })).toBe(false);
    expect(shouldRetry({ attemptCount: 1, maxAttempts: 8, firstAttemptAt: first, maxAgeHours: 24, now: new Date('2026-11-03T01:00:01Z') })).toBe(false);
  });
});
