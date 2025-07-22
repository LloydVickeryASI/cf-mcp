import { createRepositories } from "../db/operations";
import type { AuthHelper } from "../types";
import type { MCPConfig } from "../config/mcp.defaults";
import { Provider, ToolError } from "../types";
import { getProviderConfig, getAuthUrl } from "./provider-config";
import type { OAuthTokenResponse } from "./types";
import { EncryptedTokenStorage } from "./token-encryption";
import { handleTokenRotation } from "./token-refresh";

export class ToolAuthHelper implements AuthHelper {
  private repositories;
  private tokenStorage?: EncryptedTokenStorage;

  constructor(
    private db: D1Database,
    private config: MCPConfig,
    private userId: string,
    private baseUrl: string,
    encryptionKey?: string
  ) {
    this.repositories = createRepositories(db);
    // Use encryption if key is provided, otherwise fall back to plain storage
    if (encryptionKey) {
      this.tokenStorage = new EncryptedTokenStorage(encryptionKey);
    }
  }

  /**
   * Get a valid access token for the specified provider
   * Returns null if no token exists or token is expired
   */
  async getToken(provider: Provider | string): Promise<string | null> {
    try {
      console.log(`🔍 Looking up token for user: ${this.userId}, provider: ${provider}`);
      
      // Use encrypted storage if available
      let credential;
      if (this.tokenStorage) {
        const encrypted = await this.tokenStorage.retrieve(this.db, this.userId, provider);
        if (encrypted) {
          credential = {
            access_token: encrypted.accessToken,
            refresh_token: encrypted.refreshToken,
            expires_at: encrypted.expiresAt ? Math.floor(encrypted.expiresAt.getTime() / 1000) : null,
          };
        }
      } else {
        credential = await this.repositories.toolCredentials.findByUserAndProvider(
          this.userId,
          provider
        );
      }

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
   * Refresh an expired access token with retry logic
   */
  private async refreshToken(provider: Provider | string, refreshToken: string): Promise<string | null> {
    try {
      const providerConfig = this.getProviderConfigForProvider(provider);
      
      // Use the retry-enabled token rotation handler
      const result = await handleTokenRotation(
        provider,
        refreshToken,
        providerConfig.tokenUrl,
        providerConfig.clientId,
        providerConfig.clientSecret
      );
      
      // Calculate expiration time
      const expiresAt = result.expiresIn
        ? new Date(Date.now() + result.expiresIn * 1000)
        : undefined;
      
      // Update the stored credential with encryption if available
      if (this.tokenStorage) {
        await this.tokenStorage.store(
          this.db,
          this.userId,
          provider,
          result.accessToken,
          result.refreshToken || refreshToken, // Use new refresh token if provided
          expiresAt
        );
      } else {
        await this.repositories.toolCredentials.update(this.userId, provider, {
          access_token: result.accessToken,
          refresh_token: result.refreshToken || refreshToken,
          expires_at: result.expiresIn 
            ? Math.floor(Date.now() / 1000) + result.expiresIn
            : undefined,
        });
      }

      // Log the token refresh event
      await this.repositories.auditLogs.create({
        user_id: this.userId,
        event_type: "token_refresh",
        provider,
        metadata: { 
          refreshed: true,
          has_new_refresh_token: !!result.refreshToken
        },
      });

      return result.accessToken;
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