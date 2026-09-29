/**
 * Shared, pure guard logic for public API routes that spend real
 * third-party credits per call (currently /api/token; the same pattern
 * was already used ad hoc in /api/dev/transcribe). Extracted here so it's
 * unit-testable without spinning up a Next.js request.
 */

/**
 * Best-effort same-origin check. A browser sending a fetch() request from
 * this app's own page attaches an Origin header (and/or a Referer), so a
 * request whose Origin doesn't match this deployment's own origin didn't
 * come from this app's own page.
 *
 * Round-3 P1 fix: an earlier version treated a request with NO Origin
 * header at all as same-origin ("can't tell, so allow"). That was a real
 * bypass — a plain server-to-server call (curl, a script, another
 * backend) never sends an Origin header either, so it sailed straight
 * through untouched, which defeats the entire point of this check for
 * the most likely abuse path (a script hitting the token endpoint
 * directly to burn AssemblyAI credits), not just the browser-based one.
 * Now: Origin is checked first when present; Referer is used as a
 * fallback when Origin is absent (a real page navigation or fetch from
 * this app almost always sends at least one of the two); a request with
 * NEITHER header is treated as cross-origin and rejected, since that
 * combination is the fingerprint of a direct script call, not a
 * legitimate browser request from this app's own page. Still an honest
 * deterrent, not an airtight authentication boundary — a determined
 * caller can forge either header — but it no longer waves through the
 * single most common shape of automated abuse.
 *
 * @param {{origin: string|null, referer?: string|null, requestUrl: string}} input
 */
function isCrossOrigin({ origin, referer, requestUrl }) {
  let requestOrigin;
  try {
    requestOrigin = new URL(requestUrl).origin;
  } catch {
    // A request URL we can't parse can't be compared against — fail open
    // on the origin check itself (rate limiting still applies).
    return false;
  }

  if (origin) {
    return origin !== requestOrigin;
  }

  if (referer) {
    try {
      return new URL(referer).origin !== requestOrigin;
    } catch {
      // A Referer we can't parse isn't usable evidence of same-origin —
      // treat it like having no evidence at all.
      return true;
    }
  }

  // Neither Origin nor Referer present: can't establish same-origin, so
  // don't assume it. This is what closes the no-Origin bypass.
  return true;
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
