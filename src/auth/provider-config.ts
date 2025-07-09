/**
 * Centralized provider configuration for OAuth flows
 * 
 * This module consolidates all provider-specific configuration that was
 * previously duplicated across oauth-handlers.ts and tool-auth.ts
 */

import { Provider } from "../types";
import type { MCPConfig } from "../config/mcp.defaults";

export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  authUrl: string;
  tokenUrl: string;
}

/**
 * Get OAuth configuration for a provider
 */
export function getProviderConfig(provider: Provider | string, config: MCPConfig): ProviderConfig {
  const toolConfig = config.tools[provider as keyof typeof config.tools];
  
  if (!toolConfig) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  return {
    clientId: toolConfig.clientId,
    clientSecret: toolConfig.clientSecret,
    scopes: getProviderScopes(provider),
    authUrl: getProviderAuthUrl(provider),
    tokenUrl: getProviderTokenUrl(provider),
  };
}

/**
 * Get OAuth scopes for each provider
 */
export function getProviderScopes(provider: Provider | string): string[] {
  switch (provider) {
    case Provider.PANDADOC:
      return ["read+write"];
    case Provider.HUBSPOT:
      return ["crm.objects.contacts.read", "crm.objects.contacts.write", "crm.objects.deals.read"];
    case Provider.XERO:
      return ["accounting.transactions", "accounting.contacts"];
    case Provider.NETSUITE:
      return ["restlets", "rest_webservices"];
    case Provider.AUTOTASK:
      return ["api"];
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Get OAuth authorization URLs for each provider
 */
export function getProviderAuthUrl(provider: Provider | string): string {
  switch (provider) {
    case Provider.PANDADOC:
      return "https://app.pandadoc.com/oauth2/authorize";
    case Provider.HUBSPOT:
      return "https://app.hubspot.com/oauth/authorize";
    case Provider.XERO:
      return "https://login.xero.com/identity/connect/authorize";
    case Provider.NETSUITE:
      return "https://system.netsuite.com/pages/customerlogin.jsp"; // OAuth 2.0 endpoint
    case Provider.AUTOTASK:
      return "https://ww14.autotask.net/atservicesrest/oauth/authorize";
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Get OAuth token URLs for each provider
 */
export function getProviderTokenUrl(provider: Provider | string): string {
  switch (provider) {
    case Provider.PANDADOC:
      return "https://api.pandadoc.com/oauth2/access_token";
    case Provider.HUBSPOT:
      return "https://api.hubapi.com/oauth/v1/token";
    case Provider.XERO:
      return "https://identity.xero.com/connect/token";
    case Provider.NETSUITE:
      return "https://system.netsuite.com/rest/oauth2/v1/token";
    case Provider.AUTOTASK:
      return "https://ww14.autotask.net/atservicesrest/oauth/token";
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Generate OAuth authorization URL for a provider
 * Routes through our OAuth endpoint to preserve user context
 */
export function buildAuthUrl(
  provider: Provider | string,
  config: ProviderConfig,
  state: string,
  baseUrl: string
): string {
  const redirectUri = new URL(`/auth/${provider}/callback`, baseUrl).toString();
  
  // Debug logging for authorization URL
  console.log(`Building auth URL for ${provider}:`, {
    authUrl: config.authUrl,
    redirectUri,
    clientId: config.clientId,
    scopes: config.scopes
  });
  
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
    redirect_uri: redirectUri,
  });

  // Provider-specific parameters
  if (provider === Provider.HUBSPOT) {
    params.set("optional_scope", "crm.objects.deals.write,crm.objects.companies.read");
  }

  const finalUrl = `${config.authUrl}?${params.toString()}`;
  console.log(`Final auth URL for ${provider}: ${finalUrl}`);
  
  return finalUrl;
}

/**
 * Generate a simple auth URL that routes through our OAuth endpoint
 * This preserves user context through the OAuth flow
 */
export function getAuthUrl(provider: Provider | string, baseUrl: string, userId: string): string {
  return `${baseUrl}/auth/${provider}?user_id=${encodeURIComponent(userId)}`;
}

/**
 * Generate cryptographically secure state parameter
 */
export function generateState(userId: string, provider: string): string {
  const payload = JSON.stringify({
    userId,
    provider,
    timestamp: Date.now(),
    nonce: crypto.randomUUID()
  });
  
  return btoa(payload).replace(/[+/=]/g, (match) => 
    ({ "+": "-", "/": "_", "=": "" }[match] || match)
  );
}

/**
 * Validate state parameter and extract user ID
 */
export function validateState(state: string, provider: string): { userId: string; isValid: boolean } {
  try {
    // Restore base64 padding
    const paddedState = state + "===".slice((state.length + 3) % 4);
    const restored = paddedState.replace(/[-_]/g, (match) => 
      ({ "-": "+", "_": "/" }[match] || match)
    );
    
    const payload = JSON.parse(atob(restored));
    
    // Validate provider matches
    if (payload.provider !== provider) {
      return { userId: "", isValid: false };
    }
    
    // Validate timestamp (allow 10 minutes)
    const maxAge = 10 * 60 * 1000; // 10 minutes
    if (Date.now() - payload.timestamp > maxAge) {
      return { userId: "", isValid: false };
    }

    return { userId: payload.userId, isValid: true };
  } catch {
    return { userId: "", isValid: false };
  }
} 