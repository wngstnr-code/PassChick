import type { Request, RequestHandler } from "express";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyFn?: (req: Request) => string;
  message?: string;
};

type RateLimitEntry = {
  count: number;
  windowStart: number;
};

export function createRateLimiter(opts: RateLimitOptions): RequestHandler {
  const { windowMs, max, keyFn, message } = opts;
  const store = new Map<string, RateLimitEntry>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.windowStart >= windowMs) {
        store.delete(key);
      }
    }
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.ip ?? "unknown");
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { count: 0, windowStart: now };
      store.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      const remainingMs = windowMs - (now - entry.windowStart);
      const retryAfterSeconds = Math.ceil(remainingMs / 1000);
      res.setHeader("Retry-After", String(Math.max(0, retryAfterSeconds)));
      res.status(429).json({ error: message ?? "Too many requests. Try again later." });
      return;
    }

    next();
  };
}

export const authIpLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

export const authAddressLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 5,
  keyFn: (req) =>
    typeof req.body?.address === "string" && req.body.address
      ? req.body.address.toLowerCase()
      : (req.ip ?? "unknown"),
});
