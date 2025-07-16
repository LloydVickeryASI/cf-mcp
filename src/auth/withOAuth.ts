/**
 * Higher-Order Function wrapper for per-tool OAuth authentication
 * 
 * Provides a standard way to wrap MCP tool handlers with OAuth token management.
 * Automatically handles token retrieval, refresh, and auth URL generation.
 */

import { ToolAuthHelper } from "./tool-auth";
import { createRepositories } from "../db/operations";
import { withSentryTracing } from "../sentry";
import type { ToolContext } from "../types";
import { getAuthUrl } from "./provider-config";

export interface OAuthContext {
  accessToken: string;
  provider: string;
  userId: string;
}

export interface AuthRequiredResponse {
  requiresAuth: true;
  provider: string;
  authUrl: string;
  message: string;
}

export type ToolHandler<T, R> = (context: { args: T } & OAuthContext) => Promise<R>;

/**
 * Higher-order function that wraps a tool handler with OAuth authentication
 * Designed to work with Cloudflare MCP Agent context
 * 
 * @param provider - The OAuth provider name (e.g., 'pandadoc', 'hubspot')
 * @param handler - The tool handler function to wrap
 * @param agentContext - The agent context containing env, props, and baseUrl
 * @returns Wrapped handler that includes OAuth token management
 */
export function withOAuth<T, R>(
  provider: string,
  handler: ToolHandler<T, R>,
  agentContext: { env: any; props: any; baseUrl: string; config: any }
) {
  const wrappedHandler = async (args: T): Promise<R | AuthRequiredResponse> => {
    try {
      console.log(`🔍 [withOAuth] Starting OAuth check for provider: ${provider}`);
      
      // Extract user info from agent props
      const userId = agentContext.props?.id;
      const baseUrl = agentContext.baseUrl;
      
      if (!userId) {
        console.log(`❌ [withOAuth] No user ID available in agent context`);
        return {
          requiresAuth: true,
          provider: "main",
          authUrl: `${baseUrl}/authorize`,
          message: "User authentication required. No user ID found in context."
        } as AuthRequiredResponse;
      }
      
      console.log(`🔍 [withOAuth] Using agent context user: ${userId}`);
      
      if (!agentContext.env || !agentContext.config) {
        console.log(`❌ [withOAuth] No environment or config available - cannot proceed`);
        return {
          requiresAuth: true,
          provider: "main",
          authUrl: `${baseUrl}/authorize`,
          message: "Authentication context not available. Please try again."
        } as AuthRequiredResponse;
      }

      // Create tool auth helper with authenticated user context
      const authHelper = new ToolAuthHelper(
        agentContext.env.MCP_DB,
        agentContext.config,
        userId,
        baseUrl
      );
      
      console.log(`🔍 [withOAuth] Created ToolAuthHelper for user: ${userId}, provider: ${provider}`);
      
      // Get or refresh access token for this provider
      const accessToken = await authHelper.getToken(provider);
      
      console.log(`🔍 [withOAuth] Token lookup result:`, {
        provider,
        userId,
        hasToken: !!accessToken,
        tokenLength: accessToken?.length
      });
      
      if (!accessToken) {
        console.log(`❌ [withOAuth] No access token found for ${userId}:${provider} - redirecting to provider auth`);
        // No token available - user needs to authenticate with this provider
        const authResult = await authHelper.requiresAuth(provider);
        
        return {
          requiresAuth: true,
          provider,
          authUrl: authResult?.authUrl || getAuthUrl(provider, baseUrl, userId),
          message: `Please authenticate with ${provider} to use this tool.`
        } as AuthRequiredResponse;
      }

      console.log(`✅ [withOAuth] Successfully retrieved access token for ${userId}:${provider}`);

      // Create enhanced context with OAuth token
      const oauthContext: { args: T } & OAuthContext = {
        args,
        accessToken,
        provider,
        userId
      };

      // Log tool usage for audit trail
      const repositories = createRepositories(agentContext.env.MCP_DB);
      await repositories.auditLogs.create({
        user_id: userId,
        event_type: "tool_call",
        provider,
        tool_name: handler.name || "unknown",
        metadata: {
          args: Object.keys(args as object || {}),
          user_source: "mcp_agent",
        },
        ip_address: undefined,
        user_agent: undefined
      });

      // Execute the wrapped handler with OAuth context
      return await handler(oauthContext);

    } catch (error) {
      console.error(`❌ [withOAuth] OAuth error for ${provider}:`, error);
      
      // If it's a token refresh error, provide auth URL
      if (error instanceof Error && error.message.includes("token")) {
        const userId = agentContext.props?.id;
        
        if (!userId) {
          return {
            requiresAuth: true,
            provider: "main",
            authUrl: `${agentContext.baseUrl}/authorize`,
            message: "User authentication required. No user ID found in context."
          } as AuthRequiredResponse;
        }
        
        return {
          requiresAuth: true,
          provider,
          authUrl: getAuthUrl(provider, agentContext.baseUrl, userId),
          message: `Token expired for ${provider}. Please re-authenticate.`
        } as AuthRequiredResponse;
      }

      throw error;
    }
  };
  
  return wrappedHandler;
}

/**
 * Utility function to check if a response requires authentication
 */
export function requiresAuth(response: any): response is AuthRequiredResponse {
  return response && typeof response === 'object' && response.requiresAuth === true;
} 