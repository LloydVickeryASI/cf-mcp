/**
 * Provider-specific rate limiting and throttling helpers
 * 
 * Helps prevent overloading destination APIs like HubSpot, PandaDoc, etc.
 * Works in conjunction with retry logic for graceful degradation.
 */

import { RateLimiter, type RateLimitResult, type RateLimitConfig } from "./rate-limit";
import { withRetry, PROVIDER_RETRY_CONFIGS, type RetryConfig } from "./retry";
import * as Sentry from "@sentry/cloudflare";

export interface ProviderRateLimitConfig {
  // Provider-specific limits
  requestsPerMinute: number;
  requestsPerHour?: number;
  requestsPerDay?: number;
  
  // Burst handling
  burstLimit?: number;
  burstWindow?: number; // seconds
  
  // Circuit breaker
  circuitBreakerThreshold?: number; // failures before opening
  circuitBreakerTimeout?: number; // seconds to wait before retry
  
  // Queue management
  maxQueueSize?: number;
  queueTimeout?: number; // milliseconds
}

export const PROVIDER_RATE_LIMITS: Record<string, ProviderRateLimitConfig> = {
  hubspot: {
    requestsPerMinute: 100,
    requestsPerHour: 40000,
    requestsPerDay: 1000000,
    burstLimit: 10,
    burstWindow: 10,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 60,
    maxQueueSize: 100,
    queueTimeout: 30000,
  },
  pandadoc: {
    requestsPerMinute: 30,
    requestsPerHour: 1800,
    burstLimit: 5,
    burstWindow: 10,
    circuitBreakerThreshold: 3,
    circuitBreakerTimeout: 120,
    maxQueueSize: 50,
    queueTimeout: 45000,
  },
  xero: {
    requestsPerMinute: 60,
    requestsPerHour: 5000,
    requestsPerDay: 10000,
    burstLimit: 5,
    burstWindow: 10,
    circuitBreakerThreshold: 3,
    circuitBreakerTimeout: 60,
    maxQueueSize: 75,
    queueTimeout: 30000,
  },
  netsuite: {
    requestsPerMinute: 20,
    requestsPerHour: 1000,
    burstLimit: 3,
    burstWindow: 10,
    circuitBreakerThreshold: 3,
    circuitBreakerTimeout: 180,
    maxQueueSize: 25,
    queueTimeout: 60000,
  },
  autotask: {
    requestsPerMinute: 25,
    requestsPerHour: 1500,
    burstLimit: 5,
    burstWindow: 10,
    circuitBreakerThreshold: 3,
    circuitBreakerTimeout: 90,
    maxQueueSize: 40,
    queueTimeout: 45000,
  },
};

export interface CircuitBreakerState {
  state: "closed" | "open" | "half-open";
  failures: number;
  lastFailureTime: number;
  nextRetryTime: number;
}

export class ProviderRateLimiter {
  private circuitBreakers = new Map<string, CircuitBreakerState>();
  private rateLimiter: RateLimiter;
  
  constructor(rateLimiter: RateLimiter) {
    this.rateLimiter = rateLimiter;
  }
  
  /**
   * Check if we can make a request to the provider
   */
  async canMakeRequest(
    provider: string,
    userId: string,
    operation: string
  ): Promise<{ allowed: boolean; reason?: string; retryAfter?: number }> {
    const config = PROVIDER_RATE_LIMITS[provider];
    if (!config) {
      return { allowed: true };
    }
    
    // Check circuit breaker first
    const circuitCheck = this.checkCircuitBreaker(provider);
    if (!circuitCheck.allowed) {
      return circuitCheck;
    }
    
    // Check rate limits
    const rateLimitKey = `provider:${provider}:user:${userId}`;
    const rateLimitConfig: RateLimitConfig = {
      max: config.requestsPerMinute,
      period: "1m",
    };
    
    const result = await this.rateLimiter.checkLimit(rateLimitKey, rateLimitConfig);
    
    if (!result.success) {
      Sentry.addBreadcrumb({
        category: "rate_limit",
        message: `Rate limit exceeded for ${provider}`,
        level: "warning",
        data: { provider, userId, operation, remaining: result.remaining }
      });
      
      return { 
        allowed: false, 
        reason: "rate_limit_exceeded", 
        retryAfter: result.retryAfter 
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Check circuit breaker state
   */
  private checkCircuitBreaker(provider: string): { allowed: boolean; reason?: string; retryAfter?: number } {
    const state = this.circuitBreakers.get(provider);
    const config = PROVIDER_RATE_LIMITS[provider];
    
    if (!state || !config?.circuitBreakerThreshold) {
      return { allowed: true };
    }
    
    const now = Date.now();
    
    switch (state.state) {
      case "open":
        if (now >= state.nextRetryTime) {
          // Transition to half-open
          state.state = "half-open";
          this.circuitBreakers.set(provider, state);
          return { allowed: true };
        }
        return { 
          allowed: false, 
          reason: "circuit_breaker_open", 
          retryAfter: state.nextRetryTime - now 
        };
        
      case "half-open":
        // Allow one request to test if service is back
        return { allowed: true };
        
      case "closed":
      default:
        return { allowed: true };
    }
  }
  
  /**
   * Record a successful request
   */
  recordSuccess(provider: string): void {
    const state = this.circuitBreakers.get(provider);
    if (state) {
      if (state.state === "half-open") {
        // Service is back, close the circuit
        state.state = "closed";
        state.failures = 0;
        this.circuitBreakers.set(provider, state);
      } else if (state.state === "closed") {
        // Reset failure count on success
        state.failures = Math.max(0, state.failures - 1);
        this.circuitBreakers.set(provider, state);
      }
    }
  }
  
  /**
   * Record a failed request
   */
  recordFailure(provider: string, error: Error): void {
    const config = PROVIDER_RATE_LIMITS[provider];
    if (!config?.circuitBreakerThreshold) {
      return;
    }
    
    const now = Date.now();
    let state = this.circuitBreakers.get(provider) || {
      state: "closed" as const,
      failures: 0,
      lastFailureTime: 0,
      nextRetryTime: 0,
    };
    
    state.failures++;
    state.lastFailureTime = now;
    
    if (state.failures >= config.circuitBreakerThreshold) {
      // Open the circuit breaker
      state.state = "open";
      state.nextRetryTime = now + (config.circuitBreakerTimeout * 1000);
      
      Sentry.captureException(error, {
        tags: {
          provider,
          circuit_breaker: "opened",
        },
        extra: {
          failures: state.failures,
          threshold: config.circuitBreakerThreshold,
          nextRetryTime: state.nextRetryTime,
        }
      });
    }
    
    this.circuitBreakers.set(provider, state);
  }
  
  /**
   * Get circuit breaker status for monitoring
   */
  getCircuitBreakerStatus(provider: string): CircuitBreakerState | null {
    return this.circuitBreakers.get(provider) || null;
  }
}

/**
 * Higher-order function to wrap API calls with provider-specific rate limiting and retries
 */
export function withProviderRateLimit<TArgs extends any[], TReturn>(
  provider: string,
  operation: (...args: TArgs) => Promise<TReturn>,
  operationName?: string
): (...args: TArgs) => Promise<TReturn> {
  const retryConfig = PROVIDER_RETRY_CONFIGS[provider];
  
  return async (...args: TArgs): Promise<TReturn> => {
    const result = await withRetry(
      async () => {
        // The actual operation - rate limiting is handled by the client
        return await operation(...args);
      },
      retryConfig,
      operationName || `${provider}_${operation.name || "operation"}`
    );
    
    if (!result.success) {
      throw result.error;
    }
    
    return result.data!;
  };
}

/**
 * Wrapper for fetch requests with provider-specific handling
 */
export async function fetchWithProviderLimits(
  provider: string,
  url: string,
  options: RequestInit = {},
  userId: string,
  rateLimiter: ProviderRateLimiter
): Promise<Response> {
  // Check if request is allowed
  const permission = await rateLimiter.canMakeRequest(provider, userId, "api_call");
  
  if (!permission.allowed) {
    const error = new Error(`${provider} API: ${permission.reason}`);
    rateLimiter.recordFailure(provider, error);
    
    if (permission.retryAfter) {
      // Wait and retry once if retry-after is provided
      await new Promise(resolve => setTimeout(resolve, permission.retryAfter!));
      return fetchWithProviderLimits(provider, url, options, userId, rateLimiter);
    }
    
    throw error;
  }
  
  try {
    const retryConfig = PROVIDER_RETRY_CONFIGS[provider];
    const response = await withRetry(
      async () => {
        const resp = await fetch(url, options);
        
        // Check for rate limit responses
        if (resp.status === 429) {
          const retryAfter = resp.headers.get("Retry-After");
          const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
          
          throw new Error(`Rate limited by ${provider}, retry after ${retryAfterMs}ms (429)`);
        }
        
        return resp;
      },
      retryConfig,
      `${provider}_fetch`
    );
    
    if (response.success) {
      rateLimiter.recordSuccess(provider);
      return response.data!;
    } else {
      rateLimiter.recordFailure(provider, response.error!);
      throw response.error;
    }
  } catch (error) {
    rateLimiter.recordFailure(provider, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Helper to create a rate-limited API client method
 */
export function createRateLimitedMethod<TArgs extends any[], TReturn>(
  provider: string,
  methodName: string,
  method: (...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return withProviderRateLimit(provider, method, `${provider}_${methodName}`);
}

/**
 * Get provider-specific rate limit information
 */
export function getProviderLimits(provider: string): ProviderRateLimitConfig | null {
  return PROVIDER_RATE_LIMITS[provider] || null;
}

/**
 * Helper to estimate wait time based on rate limits
 */
export function estimateWaitTime(provider: string, requestsInQueue: number): number {
  const config = PROVIDER_RATE_LIMITS[provider];
  if (!config) return 0;
  
  const requestsPerSecond = config.requestsPerMinute / 60;
  return Math.ceil(requestsInQueue / requestsPerSecond) * 1000;
}