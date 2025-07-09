/**
 * Shared error handling utilities for OAuth operations
 * Standardizes error handling patterns across auth files
 */

import { getAuthUrl } from "./provider-config";

/**
 * Standard OAuth error response structure
 */
export interface OAuthErrorResponse {
  error: string;
  error_description?: string;
  error_uri?: string;
}

/**
 * Authentication required response structure
 */
export interface AuthRequiredResponse {
  requiresAuth: true;
  provider: string;
  authUrl: string;
  message: string;
}

/**
 * Check if a response is an OAuth error
 */
export function isOAuthError(data: any): data is OAuthErrorResponse {
  return data && typeof data === 'object' && 'error' in data;
}

/**
 * Create a standardized auth required response
 */
export function createAuthRequiredResponse(
  provider: string,
  baseUrl: string,
  userId: string,
  customMessage?: string
): AuthRequiredResponse {
  return {
    requiresAuth: true,
    provider,
    authUrl: getAuthUrl(provider, baseUrl, userId),
    message: customMessage || `Please authenticate with ${provider} to use this tool.`
  };
}

/**
 * Create a standardized token expired response
 */
export function createTokenExpiredResponse(
  provider: string,
  baseUrl: string,
  userId: string
): AuthRequiredResponse {
  return {
    requiresAuth: true,
    provider,
    authUrl: getAuthUrl(provider, baseUrl, userId),
    message: `Token expired for ${provider}. Please re-authenticate.`
  };
}

/**
 * Check if an error is token-related
 */
export function isTokenError(error: any): boolean {
  if (!error) return false;
  
  const message = error.message || error.toString();
  return message.includes("token") || 
         message.includes("unauthorized") ||
         message.includes("401") ||
         message.includes("403");
}

/**
 * Handle OAuth-related errors in a consistent way
 */
export function handleOAuthError(
  error: any,
  provider: string,
  baseUrl: string,
  userId: string,
  context?: string
): AuthRequiredResponse | never {
  console.error(`OAuth error for ${provider}${context ? ` in ${context}` : ''}:`, error);
  
  if (isTokenError(error)) {
    return createTokenExpiredResponse(provider, baseUrl, userId);
  }
  
  // Re-throw non-token errors
  throw error;
}

/**
 * Create a standardized HTTP error response
 */
export function createHttpErrorResponse(
  status: number,
  message: string,
  details?: any
): Response {
  return new Response(
    JSON.stringify({
      error: message,
      details: details || undefined
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

/**
 * Handle validation errors for OAuth parameters
 */
export function validateOAuthParams(params: {
  code?: string;
  state?: string;
  error?: string;
  userId?: string;
}): { isValid: boolean; error?: string } {
  if (params.error) {
    return { isValid: false, error: `OAuth error: ${params.error}` };
  }
  
  if (!params.code) {
    return { isValid: false, error: "Missing authorization code" };
  }
  
  if (!params.state) {
    return { isValid: false, error: "Missing state parameter" };
  }
  
  if (!params.userId) {
    return { isValid: false, error: "Missing user ID" };
  }
  
  return { isValid: true };
} 