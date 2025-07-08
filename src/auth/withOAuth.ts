/**
 * Higher-Order Function wrapper for per-tool OAuth authentication
 * 
 * Provides a standard way to wrap MCP tool handlers with OAuth token management.
 * Automatically handles token retrieval, refresh, and auth URL generation.
 */

import { ToolAuthHelper } from "./tool-auth";
import { createRepositories } from "../db/operations";
import { withSentryTracing } from "../sentry";
import { extractUserContext, type UserContext } from "../middleware/user-context";
import type { ToolContext } from "../types";

export interface OAuthContext extends ToolContext {
  accessToken: string;
  provider: string;
  userId: string;
  userContext: UserContext;
}

export interface AuthRequiredResponse {
  requiresAuth: true;
  provider: string;
  authUrl: string;
  message: string;
}

export type ToolHandler<T, R> = (args: T, context: OAuthContext) => Promise<R>;

/**
 * Higher-order function that wraps a tool handler with OAuth authentication
 * 
 * @param provider - The OAuth provider name (e.g., 'pandadoc', 'hubspot')
 * @param handler - The tool handler function to wrap
 * @returns Wrapped handler that includes OAuth token management
 */
export function withOAuth<T, R>(
  provider: string,
  handler: ToolHandler<T, R>,
  toolName?: string
) {
  const wrappedHandler = async (args: T, ctx: ToolContext): Promise<R | AuthRequiredResponse> => {
    try {
      // Extract user context from the request (async with session validation)
      const userContext = await extractUserContext(ctx.request, ctx.env);
      
      if (!userContext) {
        return {
          requiresAuth: true,
          provider: "main",
          authUrl: `${new URL(ctx.request.url).origin}/authorize`,
          message: "Please authenticate first to use this tool."
        } as AuthRequiredResponse;
      }

      const baseUrl = new URL(ctx.request.url).origin;

      // Create tool auth helper with authenticated user context
      const authHelper = new ToolAuthHelper(
        ctx.env.MCP_DB,
        ctx.config,
        userContext.id,
        baseUrl
      );
      
      // Get or refresh access token for this provider
      const accessToken = await authHelper.getToken(provider);
      
      if (!accessToken) {
        // No token available - user needs to authenticate with this provider
        const authResult = await authHelper.requiresAuth(provider);
        
        return {
          requiresAuth: true,
          provider,
          authUrl: authResult?.authUrl || `${baseUrl}/auth/${provider}?user_id=${encodeURIComponent(userContext.id)}`,
          message: `Please authenticate with ${provider} to use this tool.`
        } as AuthRequiredResponse;
      }

      // Create enhanced context with OAuth token and user context
      const oauthContext: OAuthContext = {
        ...ctx,
        accessToken,
        provider,
        userId: userContext.id,
        userContext
      };

      // Log tool usage for audit trail
      const repositories = createRepositories(ctx.env.MCP_DB);
      await repositories.auditLogs.create({
        user_id: userContext.id,
        event_type: "tool_call",
        provider,
        tool_name: handler.name || toolName || "unknown",
        metadata: {
          args: Object.keys(args as object || {}),
          user_agent: ctx.request.headers.get("User-Agent") || undefined,
          user_source: userContext.source,
        },
        ip_address: ctx.request.headers.get("CF-Connecting-IP") || undefined,
        user_agent: ctx.request.headers.get("User-Agent") || undefined
      });

      // Execute the wrapped handler with OAuth context
      return await handler(args, oauthContext);

    } catch (error) {
      console.error(`OAuth error for ${provider}:`, error);
      
      // If it's a token refresh error, provide auth URL
      if (error instanceof Error && error.message.includes("token")) {
        const userContext = await extractUserContext(ctx.request, ctx.env);
        const authResult = await ctx.auth.requiresAuth(provider);
        const baseUrl = new URL(ctx.request.url).origin;
        
        return {
          requiresAuth: true,
          provider,
          authUrl: authResult?.authUrl || `${baseUrl}/auth/${provider}?user_id=${encodeURIComponent(userContext?.id || 'anonymous')}`,
          message: `Token expired for ${provider}. Please re-authenticate.`
        } as AuthRequiredResponse;
      }

      throw error;
    }
  };
  
  // Apply Sentry tracing if toolName is provided
  if (toolName) {
    return withSentryTracing(toolName, wrappedHandler);
  }
  
  return wrappedHandler;
}

/**
 * Utility function to check if a response requires authentication
 */
export function requiresAuth(response: any): response is AuthRequiredResponse {
  return response && typeof response === 'object' && response.requiresAuth === true;
}

/**
 * Enhanced withOAuth that includes rate limiting
 */
export function withOAuthAndRateLimit<T, R>(
  provider: string,
  rateLimit: { max: number; period: string },
  handler: ToolHandler<T, R>
) {
  const oauthHandler = withOAuth(provider, handler);
  
  return async (args: T, ctx: ToolContext): Promise<R | AuthRequiredResponse> => {
    // TODO: Implement rate limiting using Cloudflare Workers Rate Limiting API
    // For now, just call the OAuth handler
    return await oauthHandler(args, ctx);
  };
} 