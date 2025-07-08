import { createRepositories } from "../db/operations";
import type { AuthHelper } from "../types";
import type { MCPConfig } from "../config/mcp.defaults";
import { Provider } from "../types";

export class ToolAuthHelper implements AuthHelper {
  private repositories;

  constructor(
    private db: D1Database,
    private config: MCPConfig,
    private userId: string,
    private baseUrl: string
  ) {
    this.repositories = createRepositories(db);
  }

  /**
   * Get a valid access token for the specified provider
   * Returns null if no token exists or token is expired
   */
  async getToken(provider: Provider | string): Promise<string | null> {
    try {
      console.log(`🔍 Looking up token for user: ${this.userId}, provider: ${provider}`);
      
      const credential = await this.repositories.toolCredentials.findByUserAndProvider(
        this.userId,
        provider
      );

      if (!credential) {
        console.log(`❌ No credential found for ${this.userId}:${provider}`);
        return null;
      }

      console.log(`✅ Credential found for ${this.userId}:${provider}:`, {
        hasAccessToken: !!credential.access_token,
        hasRefreshToken: !!credential.refresh_token,
        expiresAt: credential.expires_at,
        currentTime: Math.floor(Date.now() / 1000)
      });

      // Check if token is expired (with 5 minute buffer)
      const now = Math.floor(Date.now() / 1000);
      const expiryBuffer = 300; // 5 minutes
      
      if (credential.expires_at && credential.expires_at <= (now + expiryBuffer)) {
        console.log(`⏰ Token expired for ${this.userId}:${provider}, attempting refresh...`);
        // Token is expired, try to refresh if we have a refresh token
        if (credential.refresh_token) {
          return await this.refreshToken(provider, credential.refresh_token);
        }
        console.log(`❌ No refresh token available for ${this.userId}:${provider}`);
        return null;
      }

      console.log(`✅ Valid token found for ${this.userId}:${provider}`);
      return credential.access_token;
    } catch (error) {
      console.error(`Failed to get token for ${provider}:`, error);
      return null;
    }
  }

  /**
   * Check if authentication is required and return auth URL if needed
   */
  async requiresAuth(provider: Provider | string): Promise<{ authUrl: string } | null> {
    const token = await this.getToken(provider);
    
    if (token) {
      return null; // No auth required
    }

    // Generate auth URL for this provider
    const authUrl = this.getAuthUrl(provider);
    return { authUrl };
  }

  /**
   * Refresh an expired access token
   */
  private async refreshToken(provider: Provider | string, refreshToken: string): Promise<string | null> {
    try {
      const providerConfig = this.getProviderConfig(provider);
      
      const response = await fetch(providerConfig.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: providerConfig.clientId,
          client_secret: providerConfig.clientSecret,
        }),
      });

      if (!response.ok) {
        console.error(`Token refresh failed for ${provider}:`, response.status);
        return null;
      }

      const tokenData = await response.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        token_type?: string;
      };
      
      // Update the stored credential
      await this.repositories.toolCredentials.update(this.userId, provider, {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refreshToken,
        expires_at: tokenData.expires_in 
          ? Math.floor(Date.now() / 1000) + tokenData.expires_in
          : undefined,
      });

      // Log the token refresh event
      await this.repositories.auditLogs.create({
        user_id: this.userId,
        event_type: "token_refresh",
        provider,
        metadata: { 
          scope: tokenData.scope,
          expires_in: tokenData.expires_in 
        },
      });

      return tokenData.access_token;
    } catch (error) {
      console.error(`Failed to refresh token for ${provider}:`, error);
      return null;
    }
  }

  /**
   * Generate OAuth authorization URL for a provider
   * Routes through our OAuth endpoint to preserve user context
   */
  private getAuthUrl(provider: Provider | string): string {
    // Route through our OAuth endpoint with user_id parameter
    // This ensures the user context is preserved through the OAuth flow
    return `${this.baseUrl}/auth/${provider}?user_id=${encodeURIComponent(this.userId)}`;
  }

  /**
   * Get OAuth configuration for a provider
   */
  private getProviderConfig(provider: Provider | string) {
    const toolConfig = this.config.tools[provider as keyof typeof this.config.tools];
    
    if (!toolConfig) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    return {
      clientId: toolConfig.clientId,
      clientSecret: toolConfig.clientSecret,
      scopes: this.getProviderScopes(provider),
      authUrl: this.getProviderAuthUrl(provider),
      tokenUrl: this.getProviderTokenUrl(provider),
    };
  }

  /**
   * Get OAuth scopes for each provider
   */
  private getProviderScopes(provider: Provider | string): string[] {
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
  private getProviderAuthUrl(provider: Provider | string): string {
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
  private getProviderTokenUrl(provider: Provider | string): string {
    switch (provider) {
      case Provider.PANDADOC:
        return "https://app.pandadoc.com/oauth2/access_token";
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
   * Generate a secure state parameter for OAuth
   * Note: This method is no longer used since we route through our OAuth endpoints
   * but kept for potential future use or debugging
   */
  private generateState(provider: Provider | string): string {
    const data = {
      provider,
      userId: this.userId,
      timestamp: Date.now(),
      nonce: Math.random().toString(36).substring(2),
    };
    
    return btoa(JSON.stringify(data));
  }
} 