import type { NextFunction, Request, Response } from "express";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
  message?: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  }
  return req.ip ?? "unknown";
}

export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, keyPrefix, message = "Too many requests, please try again later." } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${keyPrefix}:${getClientIp(req)}`;
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    existing.count += 1;
    if (existing.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}

