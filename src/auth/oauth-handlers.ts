/**
 * OAuth 2.0 authorization handlers for all supported providers
 * 
 * Handles the OAuth flow for each SaaS provider:
 * 1. Redirect to provider's authorization endpoint
 * 2. Handle the callback with authorization code
 * 3. Exchange code for access/refresh tokens
 * 4. Store tokens in D1 database
 */

import { createRepositories } from "../db/operations";
import { Provider } from "../types";
import type { MCPConfig } from "../config/mcp.defaults";
import { extractUserContext, type UserContext } from "../middleware/user-context";
import { getProviderConfig, buildAuthUrl, generateState, validateState } from "./provider-config";
import type { OAuthTokenResponse } from "./types";

/**
 * Set user session cookie in response
 */
function setUserSessionCookie(response: Response, sessionId: string): Response {
  const newResponse = new Response(response.body, response);
  newResponse.headers.append("Set-Cookie", 
    `user_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${24 * 60 * 60}`
  );
  return newResponse;
}

/**
 * Handle OAuth authorization request - redirect to provider
 * User ID should be passed as a query parameter from the MCP tool
 */
export async function handleOAuthAuthorize(
  provider: string,
  request: Request,
  env: Env,
  config: MCPConfig
): Promise<Response> {
  try {
    // Extract user ID from query parameters (passed by MCP tool)
    const url = new URL(request.url);
    const userId = url.searchParams.get("user_id");
    
    if (!userId) {
      return new Response(JSON.stringify({
        error: "missing_user_id",
        error_description: "user_id parameter is required for OAuth authorization"
      }), { 
        status: 400,
        headers: { 
          "Content-Type": "application/json"
        }
      });
    }

    const state = generateState(userId, provider);
    
    console.log(`🔍 OAuth authorize for ${provider}, user: ${userId} (from query param)`);
    console.log(`🔍 State generated with userId:`, userId);

    // Store state in database for validation (skip audit for anonymous users)
    const repositories = createRepositories(env.MCP_DB);
    if (userId !== "anonymous") {
      try {
        await repositories.auditLogs.create({
          user_id: userId,
          event_type: "auth_grant",
          provider,
          metadata: { 
            state, 
            step: "authorize_start",
            user_source: "oauth_url_param"
          }
        });
        console.log(`✅ Audit log created for ${userId}:${provider}`);
      } catch (auditError) {
        console.error(`❌ Audit log creation failed for ${userId}:${provider}:`, auditError);
        // Continue with OAuth flow even if audit logging fails
      }
    }

    const providerConfig = getProviderConfig(provider, config);
    const authUrl = buildAuthUrl(provider, providerConfig, state, request.url);

    return Response.redirect(authUrl);
    
  } catch (error) {
    console.error(`OAuth authorize error for ${provider}:`, error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`OAuth error: ${message}`, { status: 400 });
  }
}

/**
 * Handle OAuth callback - exchange code for tokens
 */
export async function handleOAuthCallback(
  provider: string,
  request: Request,
  env: Env,
  config: MCPConfig
): Promise<Response> {
  try {
    // Handle HEAD requests (browser preflight/resource checks) without processing OAuth
    if (request.method === "HEAD") {
      return new Response(null, { 
        status: 200,
        headers: { "Content-Type": "text/html" }
      });
    }

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return new Response(`OAuth error: ${error}`, { status: 400 });
    }

    if (!code || !state) {
      return new Response("Missing code or state parameter", { status: 400 });
    }

    // Validate state and extract user ID
    const { userId, isValid } = validateState(state, provider);
    
    console.log(`🔍 OAuth callback for ${provider}, extracted userId from state: ${userId}, isValid: ${isValid}`);
    
    if (!isValid) {
      return new Response("Invalid state parameter", { status: 400 });
    }

    // Exchange authorization code for tokens
    const providerConfig = getProviderConfig(provider, config);
    const tokens = await exchangeCodeForTokens(
      provider,
      code,
      providerConfig,
      request.url
    );

    // Store tokens in database (only for real users, not anonymous)
    console.log(`Storing tokens for user ${userId}, provider ${provider}`);
    const repositories = createRepositories(env.MCP_DB);
    if (userId !== "anonymous") {
      try {
        await repositories.toolCredentials.create({
          user_id: userId,
          provider,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: tokens.expires_in 
            ? Math.floor(Date.now() / 1000) + tokens.expires_in
            : undefined,
          scopes: tokens.scope ? tokens.scope.split(' ') : undefined,
        });
        console.log(`✅ Tokens stored successfully for ${userId}:${provider}`);
      } catch (dbError) {
        console.error(`❌ Failed to store tokens for ${userId}:${provider}:`, dbError);
        throw dbError;
      }
    } else {
      console.log(`⚠️ Skipping token storage for anonymous user`);
    }

    // Log successful authentication (skip audit for anonymous users)
    if (userId !== "anonymous") {
      await repositories.auditLogs.create({
        user_id: userId,
        event_type: "auth_grant",
        provider,
        metadata: { 
          scope: tokens.scope,
          expires_in: tokens.expires_in,
          step: "callback_success"
        }
      });
    }

    // Return success page with redirect to status endpoint
    const successHtml = createSuccessPage(provider, userId);
    return new Response(successHtml, {
      headers: { 
        "Content-Type": "text/html",
        "Cache-Control": "no-cache"
      }
    });

  } catch (error) {
    console.error(`OAuth callback error for ${provider}:`, error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`OAuth error: ${message}`, { status: 400 });
  }
}

/**
 * Exchange authorization code for access/refresh tokens
 */
async function exchangeCodeForTokens(
  provider: string,
  code: string,
  config: any,
  requestUrl: string
): Promise<OAuthTokenResponse> {
  const redirectUri = new URL(requestUrl).origin + `/auth/${provider}/callback`;
  
  const requestBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
  });

  // Debug logging
  console.log(`Token exchange for ${provider}:`, {
    tokenUrl: config.tokenUrl,
    redirectUri,
    clientId: config.clientId,
    // Don't log the actual code or secret for security
    hasCode: !!code,
    hasSecret: !!config.clientSecret
  });
  
  console.log(`Making token request to ${config.tokenUrl}...`);
  
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: requestBody,
  });

  console.log(`Token response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Token exchange failed for ${provider}:`, {
      status: response.status,
      error: errorText,
      redirectUri,
      tokenUrl: config.tokenUrl
    });
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }

  const tokens = await response.json() as OAuthTokenResponse;
  console.log(`Token exchange successful for ${provider}:`, {
    hasAccessToken: !!tokens.access_token,
    hasRefreshToken: !!tokens.refresh_token,
    expiresIn: tokens.expires_in
  });
  
  return tokens;
}



/**
 * Create success page HTML
 */
function createSuccessPage(provider: string, userId: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>OAuth Authentication Successful</title>
  <style>
    body { 
      font-family: system-ui, -apple-system, sans-serif; 
      max-width: 600px; 
      margin: 50px auto; 
      padding: 20px; 
      text-align: center;
      line-height: 1.6;
    }
    .success { color: #059669; margin-bottom: 20px; }
    .provider { text-transform: capitalize; font-weight: bold; color: #2563eb; }
    .user-id { font-family: monospace; background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
    .instructions { 
      background: #f0f9ff; 
      border: 1px solid #bae6fd; 
      border-radius: 8px; 
      padding: 20px; 
      margin: 20px 0;
      text-align: left;
    }
    .code { font-family: monospace; background: #1f2937; color: #f9fafb; padding: 10px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1 class="success">✅ OAuth Authentication Successful</h1>
  <p>Successfully connected <span class="provider">${provider}</span> for user <span class="user-id">${userId}</span></p>
  
  <div class="instructions">
    <h3>Next Steps:</h3>
    <ol>
      <li><strong>Close this browser window</strong></li>
      <li><strong>Return to your MCP client</strong> (Claude Desktop, MCP Inspector, etc.)</li>
      <li><strong>Retry your ${provider} tool request</strong> - it should now work with your authenticated account</li>
    </ol>
  </div>

  <p><small>If you continue to have issues, check your MCP client logs or contact support.</small></p>
  
  <script>
    // Auto-close after 10 seconds if possible
    setTimeout(() => {
      try {
        window.close();
      } catch (e) {
        // Ignore if can't close window
      }
    }, 10000);
  </script>
</body>
</html>
  `.trim();
} 