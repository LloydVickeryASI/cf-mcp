/**
 * Helper functions for creating MCP-compliant tool responses
 * 
 * These helpers make it easy to create responses that match the MCP SDK's
 * CallToolResult format while providing convenient shortcuts for common patterns.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AuthRequiredResponse } from "../auth/withOAuth";

/**
 * Create a text response for tool results
 */
export function createTextResponse(text: string, meta?: Record<string, unknown>): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text,
        ...(meta && { _meta: meta })
      }
    ]
  };
}

/**
 * Create a JSON response (formatted as text) for structured data
 */
export function createJsonResponse(data: unknown, meta?: Record<string, unknown>): CallToolResult {
  return createTextResponse(JSON.stringify(data, null, 2), meta);
}

/**
 * Create an error response for tool failures
 */
export function createErrorResponse(message: string, code?: string, meta?: Record<string, unknown>): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: `Error: ${message}`,
        ...(meta && { _meta: meta })
      }
    ],
    isError: true,
    ...(meta && { _meta: meta })
  };
}

/**
 * Create an image response
 */
export function createImageResponse(
  data: string, 
  mimeType: string, 
  meta?: Record<string, unknown>
): CallToolResult {
  return {
    content: [
      {
        type: "image",
        data,
        mimeType,
        ...(meta && { _meta: meta })
      }
    ]
  };
}

/**
 * Create a resource response
 */
export function createResourceResponse(
  uri: string, 
  text?: string,
  mimeType?: string,
  meta?: Record<string, unknown>
): CallToolResult {
  return {
    content: [
      {
        type: "resource",
        resource: {
          uri,
          ...(text && { text }),
          ...(mimeType && { mimeType }),
          ...(meta && { _meta: meta })
        },
        ...(meta && { _meta: meta })
      }
    ]
  };
}

/**
 * Type guard to check if a response requires authentication
 */
export function isAuthRequired(response: CallToolResult | AuthRequiredResponse): response is AuthRequiredResponse {
  return (response as AuthRequiredResponse).requiresAuth === true;
}

/**
 * Convert AuthRequiredResponse to CallToolResult for tools that need OAuth
 */
export function authRequiredToCallToolResult(authResponse: AuthRequiredResponse): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: `Authentication required for ${authResponse.provider}. Please visit: ${authResponse.authUrl}`
      }
    ],
    isError: true,
    _meta: {
      requiresAuth: true,
      provider: authResponse.provider,
      authUrl: authResponse.authUrl
    }
  };
}

/**
 * Helper to handle both regular responses and auth-required responses
 */
export function handleToolResponse(response: CallToolResult | AuthRequiredResponse): CallToolResult {
  if (isAuthRequired(response)) {
    return authRequiredToCallToolResult(response);
  }
  return response;
}