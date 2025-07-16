import type { RateLimitConfig } from "../types";

import type { Env } from "../../worker-configuration.d.ts";

/**
 * Rate limiting utility using Cloudflare's Workers Rate Limiting API
 * This provides per-user, per-tool quotas for fairness, not security
 */

export interface RateLimitResult {
  success: boolean;
  remaining?: number;
  resetTime?: number;
  retryAfter?: number;
}

export class RateLimiter {
  constructor(private rateLimit?: RateLimit) {}

  /**
   * Check rate limit for a given key
   * @param key - Unique identifier (e.g., "user:123:tool:pandadoc")
   * @param config - Rate limit configuration
   */
  async checkLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    if (!this.rateLimit) {
      // Rate limiting not available, allow request
      return { success: true };
    }

    try {
      const result = await this.rateLimit.limit({ key });
      return {
        success: result.success,
        // Add additional metadata if available from the rate limit response
      };
    } catch (error) {
      console.error("Rate limit check failed:", error);
      // On error, allow the request to proceed
      return { success: true };
    }
  }

  /**
   * Generate a rate limit key for a user and tool
   */
  static getUserToolKey(userId: string, tool: string): string {
    return `user:${userId}:tool:${tool}`;
  }

  /**
   * Generate a rate limit key for a user and provider
   */
  static getUserProviderKey(userId: string, provider: string): string {
    return `user:${userId}:provider:${provider}`;
  }
}

/**
 * Higher-order function to wrap tool handlers with rate limiting
 * This is optional for fairness/back-pressure, not security
 */
export function withRateLimit<T extends any[], R>(
  maxRequests: number,
  period: string,
  handler: (...args: T) => Promise<R>
) {
  return async function rateLimitedHandler(...args: T): Promise<R> {
    // For now, this is a placeholder - actual rate limiting would require
    // access to the ToolContext to get user ID and rate limiter instance
    // This will be implemented when we create the tool registration system
    
    console.log(`Rate limit check: ${maxRequests} requests per ${period}`);
    return handler(...args);
  };
}

/**
 * Parse period string to seconds
 * @param period - Period string like "1m", "1h", "1d"
 */
export function parsePeriodToSeconds(period: string): number {
  const match = period.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid period format: ${period}`);
  }

  const [, amount, unit] = match;
  const value = parseInt(amount, 10);

  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 60 * 60;
    case "d":
      return value * 60 * 60 * 24;
    default:
      throw new Error(`Invalid period unit: ${unit}`);
  }
} 

/**
 * Check rate limit for authentication endpoints
 * Uses userId from query if available, else falls back to IP
 * @param env Worker environment with RATE_LIMITER binding
 * @param request Incoming request
 * @param provider Optional provider for key
 * @returns Rate limit result
 */
export async function checkAuthRateLimit(env: Env, request: Request, provider?: string): Promise<RateLimitResult> {
  const url = new URL(request.url);
  let keyPrefix = 'auth:';
  const userId = url.searchParams.get('user_id');
  let key = keyPrefix + (userId ? `user:${userId}` : `ip:${request.cf?.connecting_ip || 'unknown'}`);
  if (provider) {
    key += `:${provider}`;
  }
  
  const limiter = new RateLimiter(env.RATE_LIMITER);
  const config: RateLimitConfig = { max: 50, period: '1m' }; // From spec section 9
  return limiter.checkLimit(key, config);
} 