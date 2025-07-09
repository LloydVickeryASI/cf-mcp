/**
 * Cloudflare Worker - ASI MCP Gateway
 * 
 * Multi-provider MCP server with Microsoft OAuth and per-tool authentication
 * Compliant with MCP Specification June 18, 2025 and RFC 9728/8414
 */

import * as Sentry from "@sentry/cloudflare";
import { MicrosoftOAuthHandler } from "./auth/microsoft";
import { ModularMCP } from "./mcpServer";
import { createRepositories } from "./db/operations";
import { loadConfig } from "./config/loader";
import { handleOAuthAuthorize, handleOAuthCallback } from "./auth/oauth-handlers";
import { Provider } from "./types";
import { getSentryConfig, handleError } from "./sentry";
import "./tools"; // Register all tools

export { ModularMCP as MCP };

const worker = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			const url = new URL(request.url);
			
			// Health check
			if (url.pathname === "/health") {
				return new Response("OK", { status: 200 });
			}

			// RFC 9728: OAuth 2.0 Protected Resource Metadata (REQUIRED by MCP 2025-06-18)
			if (url.pathname === "/.well-known/oauth-protected-resource") {
				return new Response(JSON.stringify({
					resource: url.origin,
					authorization_servers: [url.origin], // MCP servers can act as their own AS
					scopes_supported: [
						"mcp:tools",
						"mcp:resources", 
						"mcp:prompts",
						"openid",
						"profile",
						"offline_access"
					],
					bearer_methods_supported: ["header"],
					resource_documentation: `${url.origin}/docs`,
					resource_policy_uri: `${url.origin}/policy`,
					revocation_endpoint: `${url.origin}/revoke`,
					introspection_endpoint: `${url.origin}/introspect`
				}), {
					headers: { 
						"Content-Type": "application/json",
						"Cache-Control": "public, max-age=3600" // Cache for 1 hour per RFC 9728
					},
				});
			}

			// RFC 8414: OAuth 2.0 Authorization Server Metadata (REQUIRED by MCP 2025-06-18)
			if (url.pathname === "/.well-known/oauth-authorization-server") {
				return await handleAuthorizationServerMetadata(url);
			}

			// RFC 9728: Resource-specific Authorization Server Metadata (MCP Inspector compatibility)
			if (url.pathname.startsWith("/.well-known/oauth-authorization-server/")) {
				return await handleAuthorizationServerMetadata(url);
			}

			// JWKS endpoint for token verification
			if (url.pathname === "/.well-known/jwks.json") {
				return await handleJWKS(env);
			}

			// MCP SSE endpoint for Inspector
			if (url.pathname === "/sse") {
				return await handleMcpSSE(request, env, ctx);
			}

			// OAuth Authorization endpoint (RFC 6749 + PKCE)
			if (url.pathname === "/authorize") {
				const oauthHandler = new MicrosoftOAuthHandler(env);
				return await oauthHandler.handleAuthorize(request);
			}

			// OAuth callback endpoint 
			if (url.pathname === "/.auth/callback") {
				const oauthHandler = new MicrosoftOAuthHandler(env);
				return await oauthHandler.handleCallback(request);
			}

			// RFC 7591: Dynamic Client Registration endpoint
			if (url.pathname === "/register") {
				return await handleClientRegistration(request, env);
			}

			// OAuth Token endpoint (RFC 6749)
			if (url.pathname === "/token") {
				return await handleTokenRequest(request, env);
			}

			// Token revocation endpoint (RFC 7009)
			if (url.pathname === "/revoke") {
				return await handleTokenRevocation(request, env);
			}

			// Token introspection endpoint (RFC 7662)
			if (url.pathname === "/introspect") {
				return await handleTokenIntrospection(request, env);
			}

			// Per-tool OAuth authorization endpoints
			const authMatch = url.pathname.match(/^\/auth\/(\w+)$/);
			if (authMatch) {
				const provider = authMatch[1];
				// Validate provider is supported
				if (Object.values(Provider).includes(provider as Provider)) {
					const config = loadConfig(env);
					return await handleOAuthAuthorize(provider, request, env, config);
				}
			}

			// Per-tool OAuth callback endpoints
			const callbackMatch = url.pathname.match(/^\/auth\/(\w+)\/callback$/);
			if (callbackMatch) {
				const provider = callbackMatch[1];
				// Validate provider is supported
				if (Object.values(Provider).includes(provider as Provider)) {
					const config = loadConfig(env);
					return await handleOAuthCallback(provider, request, env, config);
				}
			}

			// MCP endpoint - optionally protected by OAuth 2.1 Bearer tokens
			if (url.pathname === "/mcp") {
				return await handleMcpRequest(request, env, ctx);
			}

			// Root handling - different behavior for GET vs POST
			if (url.pathname === "/") {
				// For POST requests (like MCP Inspector), return proper JSON-RPC error
				if (request.method === "POST") {
					return new Response(JSON.stringify({
						jsonrpc: "2.0",
						id: null,
						error: {
							code: -32601,
							message: "Method not found. Use /mcp endpoint for MCP requests."
						}
					}), {
						status: 200,
						headers: { "Content-Type": "application/json" }
					});
				}
				
				// For GET requests, redirect based on OAuth configuration
				const config = loadConfig(env);
				if (config.oauth.enabled) {
					// OAuth enabled: redirect to authorization endpoint
					return Response.redirect(new URL("/authorize", url.origin).toString(), 302);
				} else {
					// OAuth disabled: redirect directly to MCP endpoint
					return Response.redirect(new URL("/mcp", url.origin).toString(), 302);
				}
			}

			return new Response("Not Found", { status: 404 });

		} catch (error) {
			console.error("Worker error:", error);
      const errorMessage = handleError(error instanceof Error ? error : new Error(String(error)), {
        pathname: new URL(request.url).pathname,
        method: request.method
      });
		}
	},
};

// Export worker with or without Sentry instrumentation based on configuration
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const sentryConfig = getSentryConfig(env);
		
		if (sentryConfig) {
			// Wrap with Sentry if configured
			return await Sentry.withSentry(
				() => sentryConfig,
				worker
			).fetch(request, env, ctx);
		} else {
			// Use worker directly if Sentry not configured
			return await worker.fetch(request, env, ctx);
		}
	}
};

/**
 * Handle OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * Supports both global and resource-specific metadata endpoints per RFC 9728
 */
async function handleAuthorizationServerMetadata(url: URL): Promise<Response> {
	return new Response(JSON.stringify({
		issuer: url.origin,
		authorization_endpoint: `${url.origin}/authorize`,
		token_endpoint: `${url.origin}/token`, 
		registration_endpoint: `${url.origin}/register`, // RFC 7591 Dynamic Client Registration
		revocation_endpoint: `${url.origin}/revoke`,
		introspection_endpoint: `${url.origin}/introspect`,
		jwks_uri: `${url.origin}/.well-known/jwks.json`,
		
		// OAuth 2.1 requirements - Authorization Code + PKCE only
		response_types_supported: ["code"],
		response_modes_supported: ["query", "fragment"],
		grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
		
		// PKCE is MANDATORY for public clients in OAuth 2.1
		code_challenge_methods_supported: ["S256"],
		
		// Scopes for MCP tools and resources
		scopes_supported: [
			"mcp:tools",
			"mcp:resources", 
			"mcp:prompts",
			"openid",
			"profile",
			"offline_access"
		],
		
		// Token endpoint authentication methods
		token_endpoint_auth_methods_supported: [
			"client_secret_post", 
			"client_secret_basic",
			"private_key_jwt", // For confidential clients
			"none" // For public clients with PKCE
		],
		token_endpoint_auth_signing_alg_values_supported: ["RS256", "ES256"],
		
		// RFC 8707: Resource Indicators support
		resource_parameter_supported: true,
		
		// Refresh token rotation (OAuth 2.1 requirement)
		refresh_token_rotation_supported: true,
		
		// DPoP support for sender-constraining (RFC 9449)
		dpop_signing_alg_values_supported: ["RS256", "ES256"],
		
		// Claims and token features
		claims_supported: ["sub", "aud", "iss", "exp", "iat", "scope", "client_id"],
		request_parameter_supported: false,
		request_uri_parameter_supported: false,
		require_request_uri_registration: false,
		
		// Service documentation
		service_documentation: `${url.origin}/docs`,
		op_policy_uri: `${url.origin}/policy`,
		op_tos_uri: `${url.origin}/terms`
	}), {
		headers: { 
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=3600" // Cache for 1 hour per RFC 8414
		},
	});
}

/**
 * Handle JWKS endpoint for JWT token verification
 */
async function handleJWKS(env: Env): Promise<Response> {
	// In production, this would return actual public keys for JWT verification
	// For now, return empty key set (tokens are stored as opaque strings in KV)
	return new Response(JSON.stringify({
		keys: []
	}), {
		headers: { 
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=86400" // Cache for 24 hours
		},
	});
}

/**
 * Handle MCP Server-Sent Events for Inspector
 */
async function handleMcpSSE(
	request: Request,
	env: Env, 
	ctx: ExecutionContext
): Promise<Response> {
	// Create MCP Durable Object
	const mcpId = env.MCP_OBJECT.idFromName("mcp-server");
	const mcpObject = env.MCP_OBJECT.get(mcpId);

	// Forward to the Durable Object which handles the SSE connection
	return await mcpObject.fetch(request);
}

/**
 * RFC 7591: Dynamic Client Registration for MCP Inspector
 */
async function handleClientRegistration(
	request: Request,
	env: Env
): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", { status: 405 });
	}

	try {
		const registrationData = await request.json() as {
			redirect_uris: string[];
			client_name?: string;
			client_uri?: string;
			scope?: string;
			grant_types?: string[];
			response_types?: string[];
		};

		// Validate required fields per RFC 7591
		if (!registrationData.redirect_uris || registrationData.redirect_uris.length === 0) {
			return new Response(JSON.stringify({
				error: "invalid_redirect_uri",
				error_description: "redirect_uris is required and must not be empty"
			}), { 
				status: 400,
				headers: { "Content-Type": "application/json" }
			});
		}

		// Generate client credentials
		const clientId = crypto.randomUUID();
		const clientSecret = crypto.randomUUID(); // Only for confidential clients

		// Determine client type based on redirect URIs
		const isPublicClient = registrationData.redirect_uris.some(uri => 
			uri.startsWith("http://localhost") || uri.includes("127.0.0.1")
		);

		// Store client registration with OAuth 2.1 compliant settings
		await env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify({
			client_id: clientId,
			client_secret: isPublicClient ? undefined : clientSecret, // Public clients don't get secrets
			client_name: registrationData.client_name || "MCP Client",
			client_uri: registrationData.client_uri,
			redirect_uris: registrationData.redirect_uris,
			grant_types: registrationData.grant_types || ["authorization_code", "refresh_token"],
			response_types: registrationData.response_types || ["code"],
			scope: registrationData.scope || "mcp:tools mcp:resources",
			token_endpoint_auth_method: isPublicClient ? "none" : "client_secret_post",
			require_pkce: true, // MANDATORY for OAuth 2.1
			created_at: Date.now()
		}), { expirationTtl: 86400 }); // 24 hours

		const response: any = {
			client_id: clientId,
			client_id_issued_at: Math.floor(Date.now() / 1000),
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			redirect_uris: registrationData.redirect_uris,
			token_endpoint_auth_method: isPublicClient ? "none" : "client_secret_post",
			require_pkce: true
		};

		// Only include client_secret for confidential clients
		if (!isPublicClient) {
			response.client_secret = clientSecret;
			response.client_secret_expires_at = 0; // Never expires
		}

		return new Response(JSON.stringify(response), {
			headers: { "Content-Type": "application/json" },
		});

	} catch (error) {
		console.error("Client registration error:", error);
		return new Response(JSON.stringify({
			error: "invalid_client_metadata",
			error_description: "Invalid registration request"
		}), { 
			status: 400,
			headers: { "Content-Type": "application/json" }
		});
	}
}

/**
 * OAuth 2.1 Token endpoint with PKCE support
 */
async function handleTokenRequest(
	request: Request,
	env: Env
): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", { status: 405 });
	}

	try {
		const formData = await request.formData();
		const grantType = formData.get("grant_type") as string;
		const clientId = formData.get("client_id") as string;
		const clientSecret = formData.get("client_secret") as string;

		// Verify client exists
		const clientData = await env.OAUTH_KV.get(`client:${clientId}`);
		if (!clientData) {
			return tokenError("invalid_client", "Client not found");
		}

		const client = JSON.parse(clientData);

		// Verify client authentication based on type
		if (client.token_endpoint_auth_method !== "none" && client.client_secret !== clientSecret) {
			return tokenError("invalid_client", "Invalid client credentials");
		}

		switch (grantType) {
			case "authorization_code":
				return await handleAuthorizationCodeGrant(formData, client, env);
			
			case "refresh_token":
				return await handleRefreshTokenGrant(formData, client, env);
			
			case "client_credentials":
				return await handleClientCredentialsGrant(client, env);
			
			default:
				return tokenError("unsupported_grant_type", `Grant type '${grantType}' is not supported`);
		}

	} catch (error) {
		console.error("Token request error:", error);
		return tokenError("server_error", "Internal server error");
	}
}

/**
 * Handle Authorization Code Grant with PKCE verification
 */
async function handleAuthorizationCodeGrant(
	formData: FormData, 
	client: any, 
	env: Env
): Promise<Response> {
	const code = formData.get("code") as string;
	const codeVerifier = formData.get("code_verifier") as string;
	const redirectUri = formData.get("redirect_uri") as string;

	// PKCE is MANDATORY in OAuth 2.1
	if (!codeVerifier) {
		return tokenError("invalid_request", "code_verifier is required");
	}

	// Verify authorization code and PKCE challenge
	const codeData = await env.OAUTH_KV.get(`code:${code}`);
	if (!codeData) {
		return tokenError("invalid_grant", "Invalid or expired authorization code");
	}

	const authData = JSON.parse(codeData);
	
	// Verify PKCE code_verifier matches code_challenge
	const challengeBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
	const computedChallenge = btoa(String.fromCharCode(...new Uint8Array(challengeBuffer)))
		.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

	if (computedChallenge !== authData.code_challenge) {
		return tokenError("invalid_grant", "PKCE verification failed");
	}

	// Generate tokens with OAuth 2.1 refresh token rotation
	const accessToken = `mcp_at_${crypto.randomUUID()}`;
	const refreshToken = `mcp_rt_${crypto.randomUUID()}`;

	// Store tokens
	await env.OAUTH_KV.put(`token:${accessToken}`, JSON.stringify({
		client_id: client.client_id,
		scope: authData.scope || "mcp:tools",
		user_id: authData.user_id || "anonymous",
		issued_at: Date.now(),
		token_type: "Bearer"
	}), { expirationTtl: 3600 }); // 1 hour

	await env.OAUTH_KV.put(`refresh:${refreshToken}`, JSON.stringify({
		client_id: client.client_id,
		scope: authData.scope || "mcp:tools",
		user_id: authData.user_id || "anonymous",
		issued_at: Date.now()
	}), { expirationTtl: 86400 * 30 }); // 30 days

	// Clean up authorization code (single use)
	await env.OAUTH_KV.delete(`code:${code}`);

	return new Response(JSON.stringify({
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: 3600,
		refresh_token: refreshToken,
		scope: authData.scope || "mcp:tools"
	}), {
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Handle Refresh Token Grant with token rotation
 */
async function handleRefreshTokenGrant(
	formData: FormData,
	client: any,
	env: Env  
): Promise<Response> {
	const refreshToken = formData.get("refresh_token") as string;
	
	const refreshData = await env.OAUTH_KV.get(`refresh:${refreshToken}`);
	if (!refreshData) {
		return tokenError("invalid_grant", "Invalid refresh token");
	}

	const tokenData = JSON.parse(refreshData);
	
	// Generate new tokens (refresh token rotation per OAuth 2.1)
	const newAccessToken = `mcp_at_${crypto.randomUUID()}`;
	const newRefreshToken = `mcp_rt_${crypto.randomUUID()}`;

	// Store new tokens
	await env.OAUTH_KV.put(`token:${newAccessToken}`, JSON.stringify({
		client_id: client.client_id,
		scope: tokenData.scope,
		user_id: tokenData.user_id,
		issued_at: Date.now(),
		token_type: "Bearer"
	}), { expirationTtl: 3600 });

	await env.OAUTH_KV.put(`refresh:${newRefreshToken}`, JSON.stringify({
		client_id: client.client_id,
		scope: tokenData.scope,
		user_id: tokenData.user_id,
		issued_at: Date.now()
	}), { expirationTtl: 86400 * 30 });

	// Revoke old refresh token (rotation)
	await env.OAUTH_KV.delete(`refresh:${refreshToken}`);

	return new Response(JSON.stringify({
		access_token: newAccessToken,
		token_type: "Bearer", 
		expires_in: 3600,
		refresh_token: newRefreshToken,
		scope: tokenData.scope
	}), {
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Handle Client Credentials Grant  
 */
async function handleClientCredentialsGrant(
	client: any,
	env: Env
): Promise<Response> {
	const accessToken = `mcp_at_${crypto.randomUUID()}`;
	
	await env.OAUTH_KV.put(`token:${accessToken}`, JSON.stringify({
		client_id: client.client_id,
		scope: client.scope || "mcp:tools",
		issued_at: Date.now(),
		token_type: "Bearer"
	}), { expirationTtl: 3600 });

	return new Response(JSON.stringify({
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: 3600,
		scope: client.scope || "mcp:tools"
	}), {
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * RFC 7009: Token Revocation endpoint
 */
async function handleTokenRevocation(
	request: Request,
	env: Env
): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", { status: 405 });
	}

	const formData = await request.formData();
	const token = formData.get("token") as string;
	const tokenTypeHint = formData.get("token_type_hint") as string;

	if (!token) {
		return new Response("", { status: 400 });
	}

	// Try to revoke as both access and refresh token
	await env.OAUTH_KV.delete(`token:${token}`);
	await env.OAUTH_KV.delete(`refresh:${token}`);

	return new Response("", { status: 200 });
}

/**
 * RFC 7662: Token Introspection endpoint
 */
async function handleTokenIntrospection(
	request: Request,
	env: Env
): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", { status: 405 });
	}

	const formData = await request.formData();
	const token = formData.get("token") as string;

	const tokenData = await env.OAUTH_KV.get(`token:${token}`);
	if (!tokenData) {
		return new Response(JSON.stringify({ active: false }), {
			headers: { "Content-Type": "application/json" },
		});
	}

	const data = JSON.parse(tokenData);
	const expiresAt = data.issued_at + 3600000; // 1 hour in ms

	return new Response(JSON.stringify({
		active: Date.now() < expiresAt,
		client_id: data.client_id,
		scope: data.scope,
		token_type: data.token_type,
		exp: Math.floor(expiresAt / 1000),
		iat: Math.floor(data.issued_at / 1000),
		sub: data.user_id
	}), {
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Helper function for token error responses
 */
function tokenError(error: string, description: string): Response {
	return new Response(JSON.stringify({
		error,
		error_description: description
	}), { 
		status: 400,
		headers: { "Content-Type": "application/json" }
	});
}

/**
 * Handle MCP requests with optional OAuth 2.1 Bearer token authentication
 */
async function handleMcpRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	try {
		// Load configuration to check if OAuth is enabled
		const config = loadConfig(env);
		
		// If OAuth is disabled, require valid Authorization header
		if (!config.oauth.enabled) {
			// When OAuth is disabled, we REQUIRE a valid Authorization header
			if (!config.oauth.allowHeaderAuth || !config.oauth.headerSecret) {
				return new Response(JSON.stringify({
					error: "authentication_required",
					error_description: "OAuth is disabled and header authentication is not configured. Access denied.",
				}), { 
					status: 401,
					headers: { 
						"Content-Type": "application/json",
						"WWW-Authenticate": `Bearer realm="mcp", error="authentication_required"`
					}
				});
			}

			const authHeader = request.headers.get("Authorization");
			if (!authHeader?.startsWith("Bearer ")) {
				return new Response(JSON.stringify({
					error: "invalid_token",
					error_description: "Authorization header required. Format: 'Authorization: Bearer lloyd-{secret}'",
				}), { 
					status: 401,
					headers: { 
						"Content-Type": "application/json",
						"WWW-Authenticate": `Bearer realm="mcp", error="invalid_token", error_description="Authorization header required"`
					}
				});
			}

			const authValue = authHeader.substring(7).trim();
			
			// Validate format: lloyd-{secret}
			if (!authValue.startsWith("lloyd-")) {
				return new Response(JSON.stringify({
					error: "invalid_token",
					error_description: "Authorization header must be in format 'Bearer lloyd-{secret}'",
				}), { 
					status: 401,
					headers: { 
						"Content-Type": "application/json",
						"WWW-Authenticate": `Bearer realm="mcp", error="invalid_token", error_description="Invalid token format"`
					}
				});
			}

			const providedSecret = authValue.substring(6); // Remove "lloyd-"
			if (providedSecret !== config.oauth.headerSecret) {
				console.log(`❌ Invalid Authorization header secret provided`);
				return new Response(JSON.stringify({
					error: "invalid_token",
					error_description: "Invalid authorization secret",
				}), { 
					status: 401,
					headers: { 
						"Content-Type": "application/json",
						"WWW-Authenticate": `Bearer realm="mcp", error="invalid_token", error_description="Invalid secret"`
					}
				});
			}

			// Valid authorization - proceed with authenticated user context
			console.log(`🔐 Valid Authorization header for user: lloyd`);
			
			// Create or update user session in D1 database
			const repositories = createRepositories(env.MCP_DB);
			
			// Check if user session already exists
			let userSession = await repositories.userSessions.findByUserId("lloyd");
			
			if (!userSession) {
				// Create a new user session with dummy OAuth tokens
				console.log(`📝 Creating new user session for lloyd`);
				userSession = await repositories.userSessions.create({
					user_id: "lloyd",
					email: "lloyd@asi.co.nz",
					name: "Lloyd Vickery",
					access_token: `bearer_${crypto.randomUUID()}`, // Dummy token for Bearer auth
					refresh_token: null, // Use null instead of undefined for D1 compatibility
					expires_at: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year
				});
			} else {
				// Update the session timestamp
				console.log(`🔄 Updating existing user session for lloyd`);
				await repositories.userSessions.update("lloyd", {
					expires_at: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // Extend for 1 year
				});
			}
			
			// Also store in KV for quick access (optional)
			const sessionId = crypto.randomUUID();
			const sessionData = {
				userId: "lloyd",
				email: "lloyd@asi.co.nz", 
				name: "Lloyd Vickery",
				created: Date.now(),
				expires: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
			};
			
			await env.OAUTH_KV.put(`user_session:${sessionId}`, JSON.stringify(sessionData), {
				expirationTtl: 24 * 60 * 60 // 24 hours
			});
			
			console.log(`💾 Stored user session ${sessionId} for user lloyd`);
			
			const mcpId = env.MCP_OBJECT.idFromName("mcp-server");
			const mcpObject = env.MCP_OBJECT.get(mcpId);

			const headers = new Headers(request.headers);
			headers.set("X-User-Login", "lloyd");
			headers.set("X-User-Name", "Lloyd Vickery");
			headers.set("X-User-Email", "lloyd@asi.co.nz");

			const enhancedRequest = new Request(request, {
				headers: headers,
			});

			const response = await mcpObject.fetch(enhancedRequest);
			
			// Set session cookie in response
			const newResponse = new Response(response.body, response);
			newResponse.headers.append("Set-Cookie", 
				`user_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${24 * 60 * 60}`
			);
			
			return newResponse;
		}

		// OAuth is enabled - proceed with authentication
		
		// Check for Bearer token (MCP Inspector & OAuth 2.1 clients)
		const authHeader = request.headers.get("Authorization");
		if (authHeader?.startsWith("Bearer ")) {
			const token = authHeader.substring(7);
			const tokenData = await env.OAUTH_KV.get(`token:${token}`);
			
			if (tokenData) {
				const data = JSON.parse(tokenData);
				
				// Verify token hasn't expired
				const expiresAt = data.issued_at + 3600000; // 1 hour
				if (Date.now() >= expiresAt) {
					return new Response(JSON.stringify({
						error: "invalid_token",
						error_description: "Token has expired"
					}), { 
						status: 401,
						headers: { "Content-Type": "application/json" }
					});
				}

				// Create MCP Durable Object with token context
				const mcpId = env.MCP_OBJECT.idFromName("mcp-server");
				const mcpObject = env.MCP_OBJECT.get(mcpId);

				const headers = new Headers(request.headers);
				headers.set("X-User-Login", data.user_id || "oauth-client");
				headers.set("X-User-Name", `OAuth Client (${data.client_id})`);
				headers.set("X-User-Email", "oauth@localhost");
				headers.set("X-OAuth-Scope", data.scope);
				headers.set("X-Client-ID", data.client_id);

				const enhancedRequest = new Request(request, {
					headers: headers,
				});

				return await mcpObject.fetch(enhancedRequest);
			}
		}

		    // Fall back to session-based auth for browser clients
    const cookies = request.headers.get("Cookie");
    const sessionToken = cookies
      ?.split(";")
      .find((c) => c.trim().startsWith("mcp_session="))
      ?.split("=")[1];

    if (!sessionToken) {
      // For API clients (like MCP Inspector), return 401 with OAuth error
      // For browser clients, redirect to authorization endpoint
      const userAgent = request.headers.get("User-Agent") || "";
      const isApiClient = !userAgent.includes("Mozilla") || request.headers.get("Accept")?.includes("application/json");
      
      if (isApiClient) {
        return new Response(JSON.stringify({
          error: "invalid_token",
          error_description: "Bearer token required. Use OAuth 2.0 authorization code flow.",
          authorization_endpoint: `${new URL(request.url).origin}/authorize`,
          token_endpoint: `${new URL(request.url).origin}/token`,
          registration_endpoint: `${new URL(request.url).origin}/register`
        }), { 
          status: 401,
          headers: { 
            "Content-Type": "application/json",
            "WWW-Authenticate": `Bearer realm="mcp", error="invalid_token", error_description="Bearer token required"`
          }
        });
      }
      
      return Response.redirect(new URL("/authorize", request.url).toString(), 302);
    }

    // Verify session token
    const session = await MicrosoftOAuthHandler.verifySessionToken(sessionToken);
    if (!session) {
      // Same logic for expired sessions
      const userAgent = request.headers.get("User-Agent") || "";
      const isApiClient = !userAgent.includes("Mozilla") || request.headers.get("Accept")?.includes("application/json");
      
      if (isApiClient) {
        return new Response(JSON.stringify({
          error: "invalid_token", 
          error_description: "Session expired. Use OAuth 2.0 authorization code flow.",
          authorization_endpoint: `${new URL(request.url).origin}/authorize`,
          token_endpoint: `${new URL(request.url).origin}/token`,
          registration_endpoint: `${new URL(request.url).origin}/register`
        }), { 
          status: 401,
          headers: { 
            "Content-Type": "application/json",
            "WWW-Authenticate": `Bearer realm="mcp", error="invalid_token", error_description="Session expired"`
          }
        });
      }
      
      return Response.redirect(new URL("/authorize", request.url).toString(), 302);
    }

		// Create MCP Durable Object
		const mcpId = env.MCP_OBJECT.idFromName("mcp-server");
		const mcpObject = env.MCP_OBJECT.get(mcpId);

		// Forward the request to the MCP Durable Object with user context
		const headers = new Headers(request.headers);
		headers.set("X-User-Login", session.login);
		headers.set("X-User-Name", session.name);
		headers.set("X-User-Email", session.email);

		const enhancedRequest = new Request(request, {
			headers: headers,
		});

		return await mcpObject.fetch(enhancedRequest);

	} catch (error) {
		console.error("MCP request error:", error);
		return new Response("Internal Server Error", { status: 500 });
	}
}

/**
 * Export Durable Object classes for Cloudflare binding
 */
export { ModularMCP } from "./mcpServer";
