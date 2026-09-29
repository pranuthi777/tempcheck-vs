const test = require("node:test");
const assert = require("node:assert/strict");
const { isCrossOrigin, createRateLimiter } = require("./apiGuard");

test("Round-3 P1: no Origin AND no Referer at all — the direct-script fingerprint — is cross-origin (fixes the bypass)", () => {
  assert.equal(isCrossOrigin({ origin: null, referer: null, requestUrl: "https://tempcheck-vsh.vercel.app/api/token" }), true);
});

test("an Origin header matching the request's own origin is same-origin", () => {
  assert.equal(
    isCrossOrigin({ origin: "https://tempcheck-vsh.vercel.app", requestUrl: "https://tempcheck-vsh.vercel.app/api/token" }),
    false
  );
});

test("an Origin header from a different site is cross-origin", () => {
  assert.equal(
    isCrossOrigin({ origin: "https://evil.example.com", requestUrl: "https://tempcheck-vsh.vercel.app/api/token" }),
    true
  );
});

test("a different scheme on the same host is still cross-origin", () => {
  assert.equal(
    isCrossOrigin({ origin: "http://tempcheck-vsh.vercel.app", requestUrl: "https://tempcheck-vsh.vercel.app/api/token" }),
    true
  );
});

test("no Origin but a matching Referer falls back to same-origin", () => {
  assert.equal(
    isCrossOrigin({
      origin: null,
      referer: "https://tempcheck-vsh.vercel.app/",
      requestUrl: "https://tempcheck-vsh.vercel.app/api/token",
    }),
    false
  );
});

test("no Origin and a Referer from a different site is cross-origin", () => {
  assert.equal(
    isCrossOrigin({
      origin: null,
      referer: "https://evil.example.com/attack",
      requestUrl: "https://tempcheck-vsh.vercel.app/api/token",
    }),
    true
  );
});

test("Origin takes priority over Referer when both are present and disagree", () => {
  assert.equal(
    isCrossOrigin({
      origin: "https://tempcheck-vsh.vercel.app",
      referer: "https://evil.example.com/attack",
      requestUrl: "https://tempcheck-vsh.vercel.app/api/token",
    }),
    false
  );
});

test("a malformed request URL never throws, defaults to not-cross-origin", () => {
  assert.doesNotThrow(() => isCrossOrigin({ origin: "https://evil.example.com", requestUrl: "not a url" }));
});

test("a malformed Referer with no Origin is not usable evidence, so it's cross-origin", () => {
  assert.equal(
    isCrossOrigin({ origin: null, referer: "not a url", requestUrl: "https://tempcheck-vsh.vercel.app/api/token" }),
    true
  );
});

test("rate limiter allows requests under the limit", () => {
  const limiter = createRateLimiter({ windowMs: 10000, maxPerKey: 3 });
  assert.equal(limiter.isLimited("1.2.3.4", 0), false);
  assert.equal(limiter.isLimited("1.2.3.4", 1), false);
  assert.equal(limiter.isLimited("1.2.3.4", 2), false);
});

test("rate limiter blocks once the limit is exceeded within the window", () => {
  const limiter = createRateLimiter({ windowMs: 10000, maxPerKey: 2 });
  assert.equal(limiter.isLimited("1.2.3.4", 0), false);
  assert.equal(limiter.isLimited("1.2.3.4", 1), false);
  assert.equal(limiter.isLimited("1.2.3.4", 2), true);
});

test("rate limiter tracks each key (IP) independently", () => {
  const limiter = createRateLimiter({ windowMs: 10000, maxPerKey: 1 });
  assert.equal(limiter.isLimited("1.1.1.1", 0), false);
  assert.equal(limiter.isLimited("2.2.2.2", 0), false);
  assert.equal(limiter.isLimited("1.1.1.1", 1), true);
  assert.equal(limiter.isLimited("2.2.2.2", 1), true);
});

test("rate limiter forgets requests once they age out of the window", () => {
  const limiter = createRateLimiter({ windowMs: 1000, maxPerKey: 1 });
  assert.equal(limiter.isLimited("1.2.3.4", 0), false);
  assert.equal(limiter.isLimited("1.2.3.4", 500), true); // still within window
  assert.equal(limiter.isLimited("1.2.3.4", 1500), false); // window has passed
});
