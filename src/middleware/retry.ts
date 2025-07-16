/**
 * Retry logic with exponential backoff for API providers
 * 
 * Handles rate limiting, network errors, and temporary failures
 * when calling external APIs like HubSpot, PandaDoc, etc.
 */

import * as Sentry from "@sentry/cloudflare";

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableStatusCodes: number[];
  retryableErrors: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  retryableErrors: ["TIMEOUT", "NETWORK_ERROR", "ECONNRESET", "ENOTFOUND"],
};

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalDelay: number;
}

export class RetryableError extends Error {
  constructor(message: string, public statusCode?: number, public retryAfter?: number) {
    super(message);
    this.name = "RetryableError";
  }
}

export class NonRetryableError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/**
 * Determines if an error is retryable based on configuration
 */
export function isRetryable(error: Error, config: RetryConfig): boolean {
  // Check if it's explicitly marked as retryable
  if (error instanceof RetryableError) {
    return true;
  }
  
  // Check if it's explicitly marked as non-retryable
  if (error instanceof NonRetryableError) {
    return false;
  }
  
  // Check for HTTP status codes in error message
  const statusCodeMatch = error.message.match(/\((\d{3})\)/);
  if (statusCodeMatch) {
    const statusCode = parseInt(statusCodeMatch[1], 10);
    return config.retryableStatusCodes.includes(statusCode);
  }
  
  // Check for specific error patterns
  return config.retryableErrors.some(pattern => 
    error.message.includes(pattern) || error.name.includes(pattern)
  );
}

/**
 * Extract retry-after value from error or response
 */
export function extractRetryAfter(error: Error): number | null {
  if (error instanceof RetryableError && error.retryAfter) {
    return error.retryAfter * 1000; // Convert to milliseconds
  }
  
  // Look for Retry-After in error message
  const retryAfterMatch = error.message.match(/retry[_-]after[:\s]*(\d+)/i);
  if (retryAfterMatch) {
    return parseInt(retryAfterMatch[1], 10) * 1000;
  }
  
  return null;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig,
  retryAfter?: number
): number {
  // If server provides Retry-After, use it
  if (retryAfter) {
    return Math.min(retryAfter, config.maxDelay);
  }
  
  // Calculate exponential backoff
  const baseDelay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt - 1);
  
  // Add jitter (randomness) to prevent thundering herd
  const jitter = Math.random() * 0.1; // ±10% jitter
  const jitteredDelay = baseDelay * (1 + jitter);
  
  return Math.min(jitteredDelay, config.maxDelay);
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  operationName: string = "operation"
): Promise<RetryResult<T>> {
  let lastError: Error;
  let totalDelay = 0;
  
  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
    try {
      const startTime = Date.now();
      const result = await operation();
      const duration = Date.now() - startTime;
      
      // Success! Log the result
      console.log(`✅ ${operationName} succeeded on attempt ${attempt}${totalDelay > 0 ? ` after ${totalDelay}ms delay` : ""}`);
      
      // Report to Sentry if this required retries
      if (attempt > 1) {
        Sentry.addBreadcrumb({
          category: "retry",
          message: `${operationName} succeeded after ${attempt} attempts`,
          level: "info",
          data: { attempts: attempt, totalDelay, duration }
        });
      }
      
      return {
        success: true,
        data: result,
        attempts: attempt,
        totalDelay,
      };
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if this is the last attempt
      if (attempt === config.maxRetries + 1) {
        console.error(`❌ ${operationName} failed after ${attempt} attempts:`, lastError.message);
        
        // Report final failure to Sentry
        Sentry.captureException(lastError, {
          tags: {
            operation: operationName,
            finalAttempt: "true",
          },
          extra: {
            attempts: attempt,
            totalDelay,
            retryConfig: config,
          }
        });
        
        break;
      }
      
      // Check if error is retryable
      if (!isRetryable(lastError, config)) {
        console.error(`❌ ${operationName} failed with non-retryable error:`, lastError.message);
        
        Sentry.captureException(lastError, {
          tags: {
            operation: operationName,
            retryable: "false",
          },
          extra: {
            attempts: attempt,
            totalDelay,
          }
        });
        
        break;
      }
      
      // Calculate delay for next attempt
      const retryAfter = extractRetryAfter(lastError);
      const delay = calculateDelay(attempt, config, retryAfter);
      totalDelay += delay;
      
      console.warn(`⚠️  ${operationName} failed on attempt ${attempt}, retrying in ${delay}ms: ${lastError.message}`);
      
      // Add breadcrumb for retry attempt
      Sentry.addBreadcrumb({
        category: "retry",
        message: `${operationName} failed, retrying`,
        level: "warning",
        data: { 
          attempt, 
          error: lastError.message, 
          delay,
          retryAfter: retryAfter || null,
        }
      });
      
      await sleep(delay);
    }
  }
  
  return {
    success: false,
    error: lastError,
    attempts: config.maxRetries + 1,
    totalDelay,
  };
}

/**
 * Wrapper for fetch with retry logic
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<Response> {
  const result = await withRetry(
    async () => {
      const response = await fetch(url, options);
      
      // Check if response indicates a retryable error
      if (config.retryableStatusCodes.includes(response.status)) {
        // Extract Retry-After header if present
        const retryAfter = response.headers.get("Retry-After");
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : undefined;
        
        throw new RetryableError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          retryAfterSeconds
        );
      }
      
      return response;
    },
    config,
    `fetch ${options.method || "GET"} ${url}`
  );
  
  if (!result.success) {
    throw result.error;
  }
  
  return result.data!;
}

/**
 * Higher-order function to wrap any async operation with retry logic
 */
export function withRetryWrapper<TArgs extends any[], TReturn>(
  operation: (...args: TArgs) => Promise<TReturn>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  operationName?: string
) {
  return async (...args: TArgs): Promise<TReturn> => {
    const result = await withRetry(
      () => operation(...args),
      config,
      operationName || operation.name || "operation"
    );
    
    if (!result.success) {
      throw result.error;
    }
    
    return result.data!;
  };
}

/**
 * Provider-specific retry configurations
 */
export const PROVIDER_RETRY_CONFIGS: Record<string, RetryConfig> = {
  hubspot: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    retryableErrors: ["TIMEOUT", "NETWORK_ERROR", "ECONNRESET"],
  },
  pandadoc: {
    maxRetries: 2,
    initialDelay: 2000,
    maxDelay: 20000,
    backoffMultiplier: 1.5,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    retryableErrors: ["TIMEOUT", "NETWORK_ERROR"],
  },
  xero: {
    maxRetries: 3,
    initialDelay: 1500,
    maxDelay: 25000,
    backoffMultiplier: 2,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    retryableErrors: ["TIMEOUT", "NETWORK_ERROR"],
  },
  netsuite: {
    maxRetries: 2,
    initialDelay: 3000,
    maxDelay: 45000,
    backoffMultiplier: 2,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    retryableErrors: ["TIMEOUT", "NETWORK_ERROR"],
  },
  autotask: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    retryableErrors: ["TIMEOUT", "NETWORK_ERROR"],
  },
};