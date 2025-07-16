import { loadConfig } from "../config/loader";
import type { Env } from "../types";

export interface AuthResult {
  authenticated: boolean;
  request?: Request;
  error?: Response;
}

/**
 * Middleware to handle Bearer token authentication for MCP endpoints.
 * Validates tokens and enriches requests with user context.
 */
export async function authenticateRequest(
  request: Request,
  env: Env
): Promise<AuthResult> {
  const config = loadConfig(env);
  
  // Skip authentication if OAuth is disabled
  if (!config.oauth.enabled) {
    return { authenticated: true, request };
  }

  // Check for Bearer token authentication
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      authenticated: false,
      error: new Response(
        JSON.stringify({
          error: "authentication_required",
          error_description: "Bearer token required to access MCP server"
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": `Bearer realm="mcp"`,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, mcp-protocol-version, Authorization"
          }
        }
      )
    };
  }

  // Validate the Bearer token
  const token = authHeader.substring(7);
  const tokenData = await env.OAUTH_KV.get(`token:${token}`);
  if (!tokenData) {
    return {
      authenticated: false,
      error: new Response(
        JSON.stringify({
          error: "invalid_token",
          error_description: "Invalid or expired access token"
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": `Bearer realm="mcp", error="invalid_token"`,
            "Access-Control-Allow-Origin": "*"
          }
        }
      )
    };
  }

  // Parse token data with error handling
  let parsedToken;
  try {
    parsedToken = JSON.parse(tokenData);
  } catch (error) {
    console.error("Failed to parse token data:", error);
    return {
      authenticated: false,
      error: new Response(
        JSON.stringify({
          error: "server_error",
          error_description: "Token data corrupted"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      )
    };
  }

  // Fetch and parse user session with error handling
  const userSession = await env.OAUTH_KV.get(`user_session:${parsedToken.user_id}`);
  if (userSession) {
    try {
      const userData = JSON.parse(userSession);
      const headers = new Headers(request.headers);
      headers.set("X-User-Login", userData.userId || "");
      headers.set("X-User-Name", userData.name || "");
      headers.set("X-User-Email", userData.email || "");
      
      request = new Request(request, { headers });
    } catch (error) {
      console.error("Failed to parse user session data:", error);
      // Continue with request but log the error
    }
  }

  return { authenticated: true, request };
}