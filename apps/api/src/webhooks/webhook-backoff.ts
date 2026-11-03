/** Retry schedule and result classification (pure functions, unit-tested). */

export const BACKOFF_SECONDS = [30, 120, 600, 1800, 3600, 10_800, 21_600] as const;

/**
 * Delay before attempt N+1. `attempt` is how many attempts have already happened (1-based after
 * the first failure). Jitter is ±20% so a burst of failures does not retry in lockstep.
 */
export function backoffSeconds(attempt: number, random: () => number = Math.random): number {
  const base = BACKOFF_SECONDS[Math.min(Math.max(attempt - 1, 0), BACKOFF_SECONDS.length - 1)];
  const jitter = 0.8 + random() * 0.4;
  return Math.max(1, Math.round(base * jitter));
}

/**
 * `Retry-After` is honoured but clamped: never sooner than the normal backoff, never later than
 * one hour. A receiver cannot make us retry in a tight loop or park a delivery for a week.
 */
export function effectiveDelaySeconds(
  attempt: number,
  retryAfter: number | null,
  random: () => number = Math.random,
): number {
  const base = backoffSeconds(attempt, random);
  if (retryAfter === null) return base;
  return Math.min(Math.max(retryAfter, base), 3600);
}

export function shouldRetry(input: {
  attemptCount: number;
  maxAttempts: number;
  firstAttemptAt: Date;
  now?: Date;
  maxAgeHours: number;
}): boolean {
  const now = input.now ?? new Date();
  if (input.attemptCount >= input.maxAttempts) return false;
  const ageMs = now.getTime() - input.firstAttemptAt.getTime();
  return ageMs < input.maxAgeHours * 3600_000;
}
