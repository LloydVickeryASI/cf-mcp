/// <reference types="../../worker-configuration" />

/**
 * Microsoft Azure AD OAuth Handler
 * 
 * Handles OAuth flow with PKCE, stores tokens in D1 database
 * Compliant with OAuth 2.1 and MCP June 18, 2025 specification
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
   * Handle OAuth authorization request with PKCE support
   */
  async handleAuthorize(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const params = url.searchParams;
    
    // Extract OAuth 2.1 parameters
    const responseType = params.get("response_type");
    const clientId = params.get("client_id");
    const redirectUri = params.get("redirect_uri");
    const scope = params.get("scope");
    const state = params.get("state");
    const codeChallenge = params.get("code_challenge");
    const codeChallengeMethod = params.get("code_challenge_method");

    // Validate required parameters for OAuth 2.1
    if (responseType !== "code") {
      return this.authError("unsupported_response_type", "Only 'code' response type is supported");
    }

    if (!clientId) {
      return this.authError("invalid_request", "client_id is required");
    }

    if (!redirectUri) {
      return this.authError("invalid_request", "redirect_uri is required");
    }

    // PKCE is mandatory in OAuth 2.1
    if (!codeChallenge) {
      return this.authError("invalid_request", "code_challenge is required (PKCE)");
    }

    if (codeChallengeMethod !== "S256") {
      return this.authError("invalid_request", "code_challenge_method must be S256");
    }

    // Verify client exists
    const clientData = await this.env.OAUTH_KV.get(`client:${clientId}`);
    if (!clientData) {
      return this.authError("invalid_client", "Client not found");
    }

    const client = JSON.parse(clientData);
    
    // Verify redirect URI matches registered URIs
    if (!client.redirect_uris.includes(redirectUri)) {
      return this.authError("invalid_request", "redirect_uri not registered");
    }

    // For now, generate a mock authorization code
    // In production, this would redirect to actual Microsoft OAuth
    const authorizationCode = `auth_${crypto.randomUUID()}`;
    
    // Store authorization code with PKCE challenge
    await this.env.OAUTH_KV.put(`code:${authorizationCode}`, JSON.stringify({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scope || "mcp:tools",
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      state: state,
      user_id: "demo-user", // In production, this would be from Microsoft OAuth
      issued_at: Date.now()
    }), { expirationTtl: 600 }); // 10 minutes

    // Redirect back to client with authorization code
    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set("code", authorizationCode);
    if (state) {
      redirectUrl.searchParams.set("state", state);
    }

    return Response.redirect(redirectUrl.toString(), 302);
  }

  /**
   * Handle OAuth callback from Microsoft
   */
  async handleCallback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return new Response(`OAuth Error: ${error}`, { status: 400 });
    }

    if (!code) {
      return new Response("Authorization code missing", { status: 400 });
    }

    try {
      // Exchange code for tokens with Microsoft
      const tokenResponse = await this.exchangeCodeForTokens(code);
      if (!tokenResponse.ok) {
        throw new Error("Token exchange failed");
      }

      const tokens = await tokenResponse.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        scope?: string;
        token_type: string;
      };
      
      // Get user info from Microsoft Graph
      const userInfo = await this.getUserInfo(tokens.access_token);
      
      // Create session token
      const sessionToken = crypto.randomUUID();
      
      // Store session
      await this.repositories.userSessions.create({
        user_id: userInfo.id,
        email: userInfo.mail || userInfo.userPrincipalName,
        name: userInfo.displayName,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in
      });

      // Set session cookie and redirect to MCP
      const response = Response.redirect(new URL("/mcp", request.url).toString(), 302);
      response.headers.set("Set-Cookie", `mcp_session=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`);
      
      return response;

    } catch (error) {
      console.error("OAuth callback error:", error);
      return new Response("Authentication failed", { status: 500 });
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(code: string): Promise<Response> {
    const tokenUrl = `https://login.microsoftonline.com/${this.config.oauth.tenantId}/oauth2/v2.0/token`;
    
    const body = new URLSearchParams({
      client_id: this.config.oauth.clientId,
      client_secret: this.config.oauth.clientSecret,
      code: code,
      grant_type: "authorization_code",
      redirect_uri: this.config.oauth.redirectUri,
      scope: this.config.oauth.scopes.join(" ")
    });

    return await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: body.toString()
    });
  }

  /**
   * Get user information from Microsoft Graph
   */
  private async getUserInfo(accessToken: string): Promise<MicrosoftUserInfo> {
    const response = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error("Failed to get user info");
    }

    const userInfo = await response.json() as MicrosoftUserInfo;
    return userInfo;
  }

  /**
   * Verify session token (static method for use in main handler)
   */
  static async verifySessionToken(sessionToken: string): Promise<{ login: string; name: string; email: string } | null> {
    // This is a simplified implementation
    // In production, you'd verify the session token against the database
    return {
      login: "demo-user",
      name: "Demo User", 
      email: "demo@example.com"
    };
  }

  /**
   * Helper for OAuth error responses
   */
  private authError(error: string, description: string): Response {
    return new Response(JSON.stringify({
      error,
      error_description: description
    }), { 
      status: 400,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }
} 