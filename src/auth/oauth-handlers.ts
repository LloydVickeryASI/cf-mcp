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

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

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
 */
export async function handleOAuthAuthorize(
  provider: string,
  request: Request,
  env: Env,
  config: MCPConfig
): Promise<Response> {
  try {
    // Extract user context from the authenticated request (with session validation)
    const userContext = await extractUserContext(request, env);
    
    if (!userContext) {
      return new Response(JSON.stringify({
        error: "authentication_required",
        error_description: "User must be authenticated to authorize provider access"
      }), { 
        status: 401,
        headers: { 
          "Content-Type": "application/json"
        }
      });
    }

    const state = generateState(userContext.id, provider);
    
    console.log(`🔍 OAuth authorize for ${provider}, user: ${userContext.id} (${userContext.source})`);
    console.log(`🔍 State generated with userId:`, userContext.id);

    // Store state in database for validation (skip audit for anonymous users)
    const repositories = createRepositories(env.MCP_DB);
    if (userContext.id !== "anonymous") {
      try {
        await repositories.auditLogs.create({
          user_id: userContext.id,
          event_type: "auth_grant",
          provider,
          metadata: { 
            state, 
            step: "authorize_start",
            user_source: userContext.source
          }
        });
        console.log(`✅ Audit log created for ${userContext.id}:${provider}`);
      } catch (auditError) {
        console.error(`❌ Audit log creation failed for ${userContext.id}:${provider}:`, auditError);
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

    // Return success page
    return new Response(createSuccessPage(provider), {
      headers: { "Content-Type": "text/html" }
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
 * Get provider-specific OAuth configuration
 */
function getProviderConfig(provider: string, config: MCPConfig) {
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
 * Build authorization URL for each provider
 */
function buildAuthUrl(
  provider: string,
  config: any,
  state: string,
  requestUrl: string
): string {
  const redirectUri = new URL(requestUrl).origin + `/auth/${provider}/callback`;
  
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
 * Get OAuth scopes for each provider
 */
function getProviderScopes(provider: string): string[] {
  switch (provider) {
    case Provider.PANDADOC:
      return ["read+write"];
    case Provider.HUBSPOT:
      return [
        "crm.objects.contacts.read",
        "crm.objects.contacts.write", 
        "crm.objects.deals.read"
      ];
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
function getProviderAuthUrl(provider: string): string {
  switch (provider) {
    case Provider.PANDADOC:
      return "https://app.pandadoc.com/oauth2/authorize";
    case Provider.HUBSPOT:
      return "https://app.hubspot.com/oauth/authorize";
    case Provider.XERO:
      return "https://login.xero.com/identity/connect/authorize";
    case Provider.NETSUITE:
      return "https://system.netsuite.com/pages/customerlogin.jsp";
    case Provider.AUTOTASK:
      return "https://ww14.autotask.net/atservicesrest/oauth/authorize";
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Get OAuth token URLs for each provider
 */
function getProviderTokenUrl(provider: string): string {
  switch (provider) {
    case Provider.PANDADOC:
      return "https://api.pandadoc.com/oauth2/access_token";
    case Provider.HUBSPOT:
      return "https://api.hubapi.com/oauth/v1/token";
    case Provider.XERO:
      return "https://identity.xero.com/connect/token";
    case Provider.NETSUITE:
      return "https://system.netsuite.com/rest/roles/oauth2/token";
    case Provider.AUTOTASK:
      return "https://ww14.autotask.net/atservicesrest/oauth/token";
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Generate cryptographically secure state parameter
 */
function generateState(userId: string, provider: string): string {
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
function validateState(state: string, provider: string): { userId: string; isValid: boolean } {
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

/**
 * Create success page HTML
 */
function createSuccessPage(provider: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Authentication Successful</title>
  <style>
    body { 
      font-family: system-ui, -apple-system, sans-serif; 
      max-width: 500px; 
      margin: 50px auto; 
      padding: 20px; 
      text-align: center;
    }
    .success { color: #059669; }
    .provider { text-transform: capitalize; font-weight: bold; }
  </style>
</head>
<body>
  <h1 class="success">✅ Authentication Successful</h1>
  <p>You have successfully connected <span class="provider">${provider}</span> to your MCP server.</p>
  <p>You can now close this window and retry your tool request.</p>
</body>
</html>
  `.trim();
} 