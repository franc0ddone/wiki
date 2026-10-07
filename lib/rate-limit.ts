/**
 * In-process fixed-window rate limiting.
 *
 * The public registration endpoint needs a cheap flood guard, and this is the
 * honest implementation for a single-node deployment: one counter per key per
 * window, held in memory.
 *
 * **Its limits, stated plainly:** state is per process, so a multi-instance
 * deployment gives each instance its own allowance, and a restart clears the
 * counters. That is acceptable for a first line of defence against a scripted
 * sign-up loop; the durable answer is a shared store (Redis) or a WAF, which is
 * a later infrastructure decision, not a frontend one.
 */

interface Bucket {
  count: number;
  /** Epoch ms at which the window resets and the count returns to zero. */
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Drop windows that have already elapsed so the map cannot grow without bound. */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Whole seconds until the window resets; `0` when allowed. */
  retryAfterSeconds: number;
  remaining: number;
}

/**
 * Consume one token for `key`.
 *
 * @param key        Stable identity for the caller (e.g. `register:<ip>`).
 * @param limit      Requests permitted per window.
 * @param windowMs   Window length in milliseconds.
 */
export function consumeRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  // Sweeping on every call is O(buckets); the map stays tiny because expired
  // windows are removed as soon as they are seen.
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0, remaining: limit - 1 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      remaining: 0,
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0, remaining: limit - existing.count };
}
