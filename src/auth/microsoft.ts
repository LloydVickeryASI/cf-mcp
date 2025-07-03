/**
 * Microsoft Azure AD OAuth Handler
 * 
 * Handles OAuth flow with PKCE, stores tokens in D1 database
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createRepositories } from "../db/operations";
import { loadConfig } from "../config/loader";
import type { MicrosoftUserInfo, MicrosoftOAuthConfig } from "./types";

export interface MicrosoftOAuthContext {
  env: Env;
  request: Request;
  waitUntil: (promise: Promise<any>) => void;
}

export class MicrosoftOAuthHandler {
  private repositories;
  private config;

  constructor(private env: Env) {
    this.repositories = createRepositories(env.MCP_DB);
    this.config = loadConfig(env);
  }

  /**
   * Handle OAuth authorization request
   */
  async handleAuthorize(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const clientId = this.config.oauth.clientId;
    const redirectUri = `${url.origin}${this.config.oauth.redirectUri}`;
    
    // Generate PKCE challenge
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    const state = this.generateState();

    // Store PKCE verifier and state in KV for the callback
    await this.env.OAUTH_KV.put(`pkce:${state}`, codeVerifier, { expirationTtl: 600 });
    await this.env.OAUTH_KV.put(`state:${state}`, JSON.stringify({ timestamp: Date.now() }), { expirationTtl: 600 });

    // Build Microsoft OAuth authorization URL
    const authUrl = this.buildAuthorizationUrl({
      clientId,
      redirectUri,
      scopes: this.config.oauth.scopes,
      state,
      codeChallenge,
      tenantId: this.config.oauth.tenantId,
    });

    return Response.redirect(authUrl);
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      console.error("OAuth error:", error, url.searchParams.get("error_description"));
      return new Response("Authentication failed", { status: 400 });
    }

    if (!code || !state) {
      return new Response("Missing code or state parameter", { status: 400 });
    }

    try {
      // Verify state and get PKCE verifier
      const storedState = await this.env.OAUTH_KV.get(`state:${state}`);
      const codeVerifier = await this.env.OAUTH_KV.get(`pkce:${state}`);

      if (!storedState || !codeVerifier) {
        return new Response("Invalid or expired state", { status: 400 });
      }

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(code, codeVerifier);
      
      // Get user information
      const userInfo = await this.getUserInfo(tokens.access_token);

      // Store user session in D1
      await this.repositories.userSessions.create({
        user_id: userInfo.id,
        email: userInfo.mail || userInfo.userPrincipalName,
        name: userInfo.displayName,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : 0,
      });

      // Log the authentication event
      await this.repositories.auditLogs.create({
        user_id: userInfo.id,
        event_type: "auth_grant",
        metadata: {
          provider: "microsoft",
          scopes: tokens.scope?.split(" ") || this.config.oauth.scopes,
        },
        ip_address: request.headers.get("CF-Connecting-IP") || undefined,
        user_agent: request.headers.get("User-Agent") || undefined,
      });

      // Clean up temporary storage
      await this.env.OAUTH_KV.delete(`pkce:${state}`);
      await this.env.OAUTH_KV.delete(`state:${state}`);

      // Create encrypted session token for the user
      const sessionToken = await this.createSessionToken(userInfo);

      // Redirect to MCP endpoint with session
      const mcpUrl = new URL("/mcp", url.origin);
      return new Response(null, {
        status: 302,
        headers: {
          Location: mcpUrl.toString(),
          "Set-Cookie": `mcp_session=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`, // 24 hours
        },
      });

    } catch (error) {
      console.error("OAuth callback error:", error);
      return new Response("Authentication failed", { status: 500 });
    }
  }

  /**
   * Build Microsoft OAuth authorization URL
   */
  private buildAuthorizationUrl(params: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state: string;
    codeChallenge: string;
    tenantId?: string;
  }): string {
    const baseUrl = params.tenantId 
      ? `https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/authorize`
      : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";

    const searchParams = new URLSearchParams({
      client_id: params.clientId,
      response_type: "code",
      redirect_uri: params.redirectUri,
      scope: params.scopes.join(" "),
      state: params.state,
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      response_mode: "query",
    });

    return `${baseUrl}?${searchParams.toString()}`;
  }

  /**
   * Exchange authorization code for access tokens
   */
  private async exchangeCodeForTokens(code: string, codeVerifier: string) {
    const tokenUrl = this.config.oauth.tenantId 
      ? `https://login.microsoftonline.com/${this.config.oauth.tenantId}/oauth2/v2.0/token`
      : "https://login.microsoftonline.com/common/oauth2/v2.0/token";

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        client_id: this.config.oauth.clientId,
        client_secret: this.config.oauth.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.config.oauth.redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${error}`);
    }

    return await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope?: string;
      token_type: string;
    };
  }

  /**
   * Get user information from Microsoft Graph API
   */
  private async getUserInfo(accessToken: string): Promise<MicrosoftUserInfo> {
    const response = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.status}`);
    }

    return await response.json() as MicrosoftUserInfo;
  }

  /**
   * Generate PKCE code verifier
   */
  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  /**
   * Generate PKCE code challenge
   */
  private async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  /**
   * Generate secure state parameter
   */
  private generateState(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  /**
   * Create encrypted session token
   */
  private async createSessionToken(userInfo: MicrosoftUserInfo): Promise<string> {
    const sessionData = {
      login: userInfo.id,
      name: userInfo.displayName,
      email: userInfo.mail || userInfo.userPrincipalName,
      timestamp: Date.now(),
    };

    // Encrypt session data (simplified - in production use proper JWT or encryption)
    return btoa(JSON.stringify(sessionData));
  }

  /**
   * Verify and decode session token
   */
  static async verifySessionToken(token: string): Promise<{
    login: string;
    name: string;
    email: string;
    timestamp: number;
  } | null> {
    try {
      const decoded = JSON.parse(atob(token));
      
      // Check if token is not too old (24 hours)
      if (Date.now() - decoded.timestamp > 86400000) {
        return null;
      }

      return decoded;
    } catch {
      return null;
    }
  }
} 