/**
 * Token refresh utilities with retry logic
 */

import { ToolError } from "@/types";
import type { OAuthTokenResponse } from "./types";

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determines if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof ToolError) {
    // Retry on network errors and 5xx errors
    return (
      error.code === "NETWORK_ERROR" ||
      error.code === "TIMEOUT" ||
      (error.statusCode !== undefined && error.statusCode >= 500)
    );
  }
  
  if (error instanceof Error) {
    // Retry on network-related errors
    return (
      error.message.includes("fetch failed") ||
      error.message.includes("network") ||
      error.message.includes("timeout")
    );
  }
  
  return false;
}

/**
 * Refresh token with exponential backoff retry
 */
export async function refreshTokenWithRetry(
  provider: string,
  refreshToken: string,
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<OAuthTokenResponse> {
  let lastError: unknown;
  let delay = config.initialDelay;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempting token refresh for ${provider} (attempt ${attempt + 1}/${config.maxRetries + 1})`);
      
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: any;
        
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText };
        }

        // Check if this is a permanent error (e.g., invalid refresh token)
        if (response.status === 400 || response.status === 401) {
          throw new ToolError(
            `Token refresh failed: ${errorData.error || errorData.error_description || response.statusText}`,
            "REFRESH_FAILED",
            response.status,
            provider
          );
        }

        // Otherwise, it might be retryable
        throw new ToolError(
          `Token refresh HTTP error: ${response.status}`,
          "HTTP_ERROR",
          response.status,
          provider
        );
      }

      const tokenData = await response.json() as OAuthTokenResponse;
      
      // Validate the response
      if (!tokenData.access_token) {
        throw new ToolError(
          "Invalid token response: missing access_token",
          "INVALID_RESPONSE",
          500,
          provider
        );
      }

      console.log(`✅ Token refresh successful for ${provider}`);
      return tokenData;
      
    } catch (error) {
      lastError = error;
      
      // Don't retry if it's not a retryable error
      if (!isRetryableError(error)) {
        console.error(`❌ Non-retryable error during token refresh for ${provider}:`, error);
        throw error;
      }
      
      // Don't sleep after the last attempt
      if (attempt < config.maxRetries) {
        console.log(`⏳ Retrying token refresh for ${provider} after ${delay}ms...`);
        await sleep(delay);
        
        // Exponential backoff with jitter
        delay = Math.min(
          delay * config.backoffMultiplier + Math.random() * 1000,
          config.maxDelay
        );
      }
    }
  }

  // All retries exhausted
  console.error(`❌ Token refresh failed after ${config.maxRetries + 1} attempts for ${provider}`);
  throw new ToolError(
    `Token refresh failed after ${config.maxRetries + 1} attempts`,
    "REFRESH_EXHAUSTED",
    500,
    provider
  );
}

/**
 * Handle refresh token rotation per OAuth 2.1
 */
export interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export async function handleTokenRotation(
  provider: string,
  currentRefreshToken: string,
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  config?: RetryConfig
): Promise<RefreshResult> {
  const response = await refreshTokenWithRetry(
    provider,
    currentRefreshToken,
    tokenUrl,
    clientId,
    clientSecret,
    config
  );

  // OAuth 2.1 recommends refresh token rotation
  // If a new refresh token is provided, it should be used for future refreshes
  const result: RefreshResult = {
    accessToken: response.access_token,
    expiresIn: response.expires_in,
  };

  // Only update refresh token if a new one is provided
  if (response.refresh_token && response.refresh_token !== currentRefreshToken) {
    console.log(`🔄 Refresh token rotated for ${provider}`);
    result.refreshToken = response.refresh_token;
  }

  return result;
}