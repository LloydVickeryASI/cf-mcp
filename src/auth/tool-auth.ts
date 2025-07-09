import { createRepositories } from "../db/operations";
import type { AuthHelper } from "../types";
import type { MCPConfig } from "../config/mcp.defaults";
import { Provider } from "../types";
import { getProviderConfig, getAuthUrl } from "./provider-config";
import type { OAuthTokenResponse } from "./types";

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
    const authUrl = this.getAuthUrlForProvider(provider);
    return { authUrl };
  }

  /**
   * Refresh an expired access token
   */
  private async refreshToken(provider: Provider | string, refreshToken: string): Promise<string | null> {
    try {
      const providerConfig = this.getProviderConfigForProvider(provider);
      
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

      const tokenData = await response.json() as OAuthTokenResponse;
      
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
  private getAuthUrlForProvider(provider: Provider | string): string {
    // Route through our OAuth endpoint with user_id parameter
    // This ensures the user context is preserved through the OAuth flow
    return getAuthUrl(provider, this.baseUrl, this.userId);
  }

  /**
   * Get OAuth configuration for a provider
   */
  private getProviderConfigForProvider(provider: Provider | string) {
    return getProviderConfig(provider, this.config);
  }


} 