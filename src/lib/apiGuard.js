/**
 * Shared, pure guard logic for public API routes that spend real
 * third-party credits per call (currently /api/token; the same pattern
 * was already used ad hoc in /api/dev/transcribe). Extracted here so it's
 * unit-testable without spinning up a Next.js request.
 */

/**
 * Best-effort same-origin check. A browser sending a fetch() request
 * generally attaches an Origin header, including for a same-origin
 * request in modern browsers — if one is present and doesn't match this
 * deployment's own origin, the request didn't come from this app's own
 * page. Honest limitation: a request with NO Origin header at all can't
 * be distinguished this way and is treated as same-origin — this is a
 * real deterrent against another site's page quietly calling this
 * endpoint from a browser, not an airtight authentication boundary.
 *
 * @param {{origin: string|null, requestUrl: string}} input
 */
function isCrossOrigin({ origin, requestUrl }) {
  if (!origin) return false;
  try {
    const requestOrigin = new URL(requestUrl).origin;
    return origin !== requestOrigin;
  } catch {
    // A request URL we can't parse can't be compared against — fail open
    // on the origin check specifically (rate limiting still applies), the
    // same honest best-effort stance as the missing-Origin-header case.
    return false;
  }
}

/**
 * A small in-memory, per-key sliding-window rate limiter. Honest caveat
 * (same as /api/dev/transcribe's): this is per serverless instance, not a
 * shared/durable limiter — a cold start resets it, and a platform running
 * many instances gives each its own bucket. A real deterrent against
 * automated abuse from one IP, not a hard guarantee.
 *
 * @param {{windowMs: number, maxPerKey: number}} config
 */
function createRateLimiter({ windowMs, maxPerKey }) {
  const state = new Map(); // key -> [timestamps]
  return {
    isLimited(key, now = Date.now()) {
      const timestamps = (state.get(key) || []).filter((t) => now - t < windowMs);
      if (timestamps.length >= maxPerKey) {
        state.set(key, timestamps);
        return true;
      }
      timestamps.push(now);
      state.set(key, timestamps);
      return false;
    },
  };
}

module.exports = { isCrossOrigin, createRateLimiter };
