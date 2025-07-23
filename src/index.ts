/// <reference types="../worker-configuration" />

import { McpAgent } from "agents/mcp";
import { ModularMCPServer as ModularMCP } from "./mcpServer";
import { ClientRegistry } from "./auth/client-registry";
import { TokenEncryption } from "./auth/crypto";
import { RateLimiter } from "./auth/rate-limiter";

// Create MCP route handlers using static methods
const mcpSSEHandler = McpAgent.serveSSE("/sse", {
	binding: "MCP_OBJECT",
	corsOptions: {
		origin: "*",
		headers: "Content-Type, mcp-session-id, mcp-protocol-version, Authorization",
		methods: "GET, POST, OPTIONS"
	}
});

const mcpStreamableHandler = McpAgent.serve("/mcp", {
	binding: "MCP_OBJECT", 
	corsOptions: {
		origin: "*",
		headers: "Content-Type, mcp-session-id, mcp-protocol-version, Authorization",
		methods: "GET, POST, OPTIONS"
	}
});

// Helper to generate PKCE code verifier and challenge
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const verifier = crypto.randomUUID() + crypto.randomUUID(); // 72 chars
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	
	// Convert to base64url
	const hashArray = new Uint8Array(hashBuffer);
	const challenge = btoa(String.fromCharCode(...hashArray))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');
	
	return { verifier, challenge };
}

// Helper function to hash user ID
async function hashUserId(email: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(email.toLowerCase());
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper function to exchange code for tokens with PKCE
async function exchangeCodeForTokens(code: string, verifier: string, env: Env, request: Request): Promise<Response> {
	const tokenUrl = `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
	
	const body = new URLSearchParams({
		client_id: env.MICROSOFT_CLIENT_ID,
		client_secret: env.MICROSOFT_CLIENT_SECRET,
		code: code,
		code_verifier: verifier,
		grant_type: "authorization_code",
		redirect_uri: new URL("/oauth/callback/microsoft", new URL(request.url).origin).toString(),
		scope: "openid profile email User.Read offline_access"
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

// Helper function to get user info from Microsoft Graph
async function getUserInfo(accessToken: string): Promise<any> {
	const response = await fetch("https://graph.microsoft.com/v1.0/me", {
		headers: {
			"Authorization": `Bearer ${accessToken}`,
			"Accept": "application/json"
		}
	});

	if (!response.ok) {
		throw new Error("Failed to get user info");
	}

	return await response.json();
}

// Helper function to refresh Microsoft access token
async function refreshMicrosoftToken(refreshToken: string, env: Env): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
	token_type: string;
}> {
	const tokenUrl = `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
	
	const body = new URLSearchParams({
		client_id: env.MICROSOFT_CLIENT_ID,
		client_secret: env.MICROSOFT_CLIENT_SECRET,
		refresh_token: refreshToken,
		grant_type: "refresh_token",
		scope: "openid profile email User.Read offline_access"
	});

	const response = await fetch(tokenUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"Accept": "application/json"
		},
		body: body.toString()
	});

	if (!response.ok) {
		throw new Error("Failed to refresh token");
	}

	return await response.json();
}

// Helper function to get valid Microsoft token (refreshes if needed)
async function getValidMicrosoftToken(userId: string, env: Env): Promise<string | null> {
	const userData = await env.OAUTH_KV.get(`user:${userId}`);
	if (!userData) return null;
	
	const user = JSON.parse(userData);
	const now = Date.now();
	
	// Check if token is expired or about to expire (5 min buffer)
	if (user.microsoftTokens.expiresAt - now < 5 * 60 * 1000) {
		try {
			// Decrypt refresh token
			const tokenEncryption = new TokenEncryption(env.COOKIE_ENCRYPTION_KEY);
			const refreshToken = await tokenEncryption.decrypt(user.microsoftTokens.refreshToken);
			
			// Refresh the token
			const newTokens = await refreshMicrosoftToken(refreshToken, env);
			
			// Encrypt new tokens
			const encryptedAccessToken = await tokenEncryption.encrypt(newTokens.access_token);
			const encryptedRefreshToken = await tokenEncryption.encrypt(newTokens.refresh_token);
			
			// Update stored tokens
			user.microsoftTokens = {
				accessToken: encryptedAccessToken,
				refreshToken: encryptedRefreshToken,
				expiresAt: now + (newTokens.expires_in * 1000),
				encrypted: true
			};
			
			await env.OAUTH_KV.put(`user:${userId}`, JSON.stringify(user), {
				expirationTtl: 86400 // 24 hours
			});
			
			return newTokens.access_token;
		} catch (error) {
			console.error("Failed to refresh Microsoft token:", error);
			return null;
		}
	}
	
	// Token is still valid, decrypt and return
	const tokenEncryption = new TokenEncryption(env.COOKIE_ENCRYPTION_KEY);
	return await tokenEncryption.decrypt(user.microsoftTokens.accessToken);
}

// Audit logging helper
async function logAuditEvent(env: Env, event: any, request?: Request): Promise<void> {
	if (!env.MCP_DB) return;
	
	try {
		const id = crypto.randomUUID();
		const metadata = {
			...event,
			timestamp: event.timestamp || new Date().toISOString()
		};
		
		await env.MCP_DB.prepare(`
			INSERT INTO audit_logs (id, user_id, event_type, provider, tool_name, metadata, ip_address, user_agent)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`).bind(
			id,
			event.userId || 'system',
			event.type,
			event.provider || null,
			event.toolName || null,
			JSON.stringify(metadata),
			request?.headers.get('CF-Connecting-IP') || null,
			request?.headers.get('User-Agent') || null
		).run();
	} catch (error) {
		console.error("Failed to log audit event:", error);
	}
}

// API handler for authenticated MCP requests
const apiHandler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// The OAuth provider will add user info to the request
		console.log("Authenticated MCP request");
		
		// Forward to MCP handler with user context
		return mcpStreamableHandler.fetch(request, env, ctx);
	}
};

// Handle OAuth authorization server metadata (RFC 8414)
async function handleAuthorizationServerMetadata(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	
	const metadata = {
		issuer: url.origin,
		authorization_endpoint: url.origin + "/authorize",
		token_endpoint: url.origin + "/token",
		revocation_endpoint: url.origin + "/oauth/revoke",
		introspection_endpoint: url.origin + "/oauth/introspect",
		registration_endpoint: url.origin + "/oauth/register",
		jwks_uri: url.origin + "/oauth/jwks",
		scopes_supported: ["mcp:tools", "profile", "openid", "offline_access"],
		response_types_supported: ["code"],
		response_modes_supported: ["query"],
		grant_types_supported: ["authorization_code", "refresh_token"],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
		service_documentation: url.origin + "/docs",
		ui_locales_supported: ["en-US"],
		op_policy_uri: url.origin + "/policy",
		op_tos_uri: url.origin + "/tos"
	};
	
	return new Response(JSON.stringify(metadata), {
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=3600",
			"Access-Control-Allow-Origin": "*"
		}
	});
}

// Handle OAuth protected resource metadata (RFC 9728)
async function handleProtectedResourceMetadata(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	
	const metadata = {
		resource: url.origin + "/mcp",
		authorization_servers: [url.origin],
		scopes_supported: ["mcp:tools", "profile", "openid"],
		bearer_methods_supported: ["header"],
		resource_documentation: url.origin + "/docs",
		resource_policy_uri: url.origin + "/policy"
	};
	
	return new Response(JSON.stringify(metadata), {
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=3600",
			"Access-Control-Allow-Origin": "*"
		}
	});
}

// Microsoft OAuth callback handler
async function handleMicrosoftCallback(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const stateKey = url.searchParams.get("state");
	const error = url.searchParams.get("error");

	if (error) {
		return new Response(`OAuth Error: ${error}`, { status: 400 });
	}

	if (!code || !stateKey) {
		return new Response("Authorization code or state missing", { status: 400 });
	}

	try {
		// Retrieve and validate OAuth state
		const oauthStateData = await env.OAUTH_KV.get(`oauth_state:${stateKey}`);
		if (!oauthStateData) {
			return new Response("Invalid or expired state", { status: 400 });
		}
		const oauthState = JSON.parse(oauthStateData);
		
		// Retrieve PKCE verifier
		const pkceData = await env.OAUTH_KV.get(`pkce:${stateKey}`);
		if (!pkceData) {
			return new Response("PKCE data not found", { status: 400 });
		}
		const { verifier } = JSON.parse(pkceData);
		
		// Exchange code for tokens with Microsoft using PKCE
		const tokenResponse = await exchangeCodeForTokens(code, verifier, env, request);
		if (!tokenResponse.ok) {
			const errorText = await tokenResponse.text();
			console.error("Token exchange failed:", errorText);
			throw new Error("Token exchange failed");
		}

		const tokens = await tokenResponse.json() as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
			token_type: string;
		};

		// Get user info from Microsoft Graph
		const userInfo = await getUserInfo(tokens.access_token);
		
		// Create a unique user ID by hashing email
		const userId = await hashUserId(userInfo.mail || userInfo.userPrincipalName);
		
		// Encrypt Microsoft tokens before storage
		const tokenEncryption = new TokenEncryption(env.COOKIE_ENCRYPTION_KEY);
		const encryptedAccessToken = await tokenEncryption.encrypt(tokens.access_token);
		const encryptedRefreshToken = await tokenEncryption.encrypt(tokens.refresh_token);
		
		// Store user data with encrypted tokens
		await env.OAUTH_KV.put(
			`user:${userId}`,
			JSON.stringify({
				userId: userId,
				email: userInfo.mail || userInfo.userPrincipalName,
				name: userInfo.displayName,
				microsoftTokens: {
					accessToken: encryptedAccessToken,
					refreshToken: encryptedRefreshToken,
					expiresAt: Date.now() + (tokens.expires_in * 1000),
					encrypted: true
				}
			}),
			{ expirationTtl: 86400 } // 24 hours
		);
		
		// Log successful authentication
		await logAuditEvent(env, {
			type: 'auth_grant',
			userId: userId,
			email: userInfo.mail || userInfo.userPrincipalName,
			clientId: oauthState.clientId,
			timestamp: new Date().toISOString()
		}, request);
		
		// Clean up temporary state
		await env.OAUTH_KV.delete(`oauth_state:${stateKey}`);
		await env.OAUTH_KV.delete(`pkce:${stateKey}`);
		
		// The OAuth provider library expects to handle the authorization code generation
		// We need to complete the OAuth flow by calling the authorize endpoint with the user ID
		const authorizeUrl = new URL('/oauth/authorize/complete', url.origin);
		authorizeUrl.searchParams.set('client_id', oauthState.clientId);
		authorizeUrl.searchParams.set('redirect_uri', oauthState.redirectUri);
		authorizeUrl.searchParams.set('state', oauthState.originalState || '');
		authorizeUrl.searchParams.set('scope', oauthState.scope);
		authorizeUrl.searchParams.set('user_id', userId);
		
		// Store completion data
		const completionKey = crypto.randomUUID();
		await env.OAUTH_KV.put(
			`completion:${completionKey}`,
			JSON.stringify({
				userId,
				clientId: oauthState.clientId,
				redirectUri: oauthState.redirectUri,
				scope: oauthState.scope,
				codeChallenge: oauthState.codeChallenge,
				originalState: oauthState.originalState
			}),
			{ expirationTtl: 300 } // 5 minutes
		);
		
		// Redirect to complete authorization
		authorizeUrl.searchParams.set('completion_key', completionKey);
		return Response.redirect(authorizeUrl.toString(), 302);

	} catch (error) {
		console.error("OAuth callback error:", error);
		await logAuditEvent(env, {
			type: 'auth_grant',
			userId: 'unknown',
			error: error instanceof Error ? error.message : 'Unknown error',
			stateKey: stateKey,
			timestamp: new Date().toISOString()
		}, request);
		return new Response("Authentication failed", { status: 500 });
	}
}

// Complete authorization after Microsoft login
async function handleOAuthAuthorizeComplete(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const completionKey = url.searchParams.get('completion_key');
	
	if (!completionKey) {
		return new Response('Missing completion key', { status: 400 });
	}
	
	// Get completion data
	const completionData = await env.OAUTH_KV.get(`completion:${completionKey}`);
	if (!completionData) {
		return new Response('Invalid or expired completion key', { status: 400 });
	}
	
	const data = JSON.parse(completionData);
	await env.OAUTH_KV.delete(`completion:${completionKey}`);
	
	// Generate authorization code
	const authCode = crypto.randomUUID();
	
	// Store auth code data for token exchange
	await env.OAUTH_KV.put(
		`auth_code:${authCode}`,
		JSON.stringify({
			userId: data.userId,
			clientId: data.clientId,
			redirectUri: data.redirectUri,
			scope: data.scope,
			codeChallenge: data.codeChallenge
		}),
		{ expirationTtl: 600 } // 10 minutes
	);
	
	// Redirect back to client with auth code
	const redirectUrl = new URL(data.redirectUri);
	redirectUrl.searchParams.set('code', authCode);
	if (data.originalState) {
		redirectUrl.searchParams.set('state', data.originalState);
	}
	
	return Response.redirect(redirectUrl.toString(), 302);
}

// Custom authorization handler that integrates with Microsoft
async function handleOAuthAuthorize(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const clientId = url.searchParams.get('client_id');
	const redirectUri = url.searchParams.get('redirect_uri');
	const scope = url.searchParams.get('scope') || '';
	const state = url.searchParams.get('state');
	const codeChallenge = url.searchParams.get('code_challenge');
	const codeChallengeMethod = url.searchParams.get('code_challenge_method');
	
	// Validate PKCE is present (mandatory per MCP spec)
	if (!codeChallenge || codeChallengeMethod !== 'S256') {
		return new Response('PKCE required: code_challenge and code_challenge_method=S256 must be provided', { 
			status: 400 
		});
	}
	
	// Validate client_id and redirect_uri
	if (!clientId || !redirectUri) {
		return new Response('Missing required parameters', { status: 400 });
	}
	
	// Validate client_id against registered clients
	const clientRegistry = new ClientRegistry(env);
	const clientValidation = await clientRegistry.validateClient(clientId, redirectUri);
	
	if (!clientValidation.valid) {
		console.error('Client validation failed:', {
			clientId,
			redirectUri,
			error: clientValidation.error
		});
		return new Response(clientValidation.error || 'Invalid client', { status: 400 });
	}
	
	// Validate requested scopes
	const requestedScopes = scope.split(' ').filter(s => s);
	const scopeValidation = await clientRegistry.validateScopes(clientId, requestedScopes);
	
	if (!scopeValidation.valid) {
		return new Response(scopeValidation.error || 'Invalid scope', { status: 400 });
	}
	
	// Generate a secure state parameter that includes the original OAuth params
	const oauthState = {
		originalState: state,
		clientId,
		redirectUri,
		scope,
		codeChallenge,
		codeChallengeMethod,
		timestamp: Date.now(),
		nonce: crypto.randomUUID()
	};
	
	// Store OAuth state securely
	const stateKey = crypto.randomUUID();
	await env.OAUTH_KV.put(
		`oauth_state:${stateKey}`, 
		JSON.stringify(oauthState),
		{ expirationTtl: 600 } // 10 minutes
	);
	
	// Generate Microsoft OAuth URL with PKCE
	const microsoftPKCE = await generatePKCE();
	await env.OAUTH_KV.put(
		`pkce:${stateKey}`,
		JSON.stringify({
			verifier: microsoftPKCE.verifier,
			challenge: microsoftPKCE.challenge
		}),
		{ expirationTtl: 600 }
	);
	
	const microsoftAuthUrl = new URL(`https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`);
	microsoftAuthUrl.searchParams.set('client_id', env.MICROSOFT_CLIENT_ID);
	microsoftAuthUrl.searchParams.set('response_type', 'code');
	microsoftAuthUrl.searchParams.set('redirect_uri', url.origin + '/oauth/callback/microsoft');
	microsoftAuthUrl.searchParams.set('scope', 'openid profile email User.Read offline_access');
	microsoftAuthUrl.searchParams.set('state', stateKey);
	microsoftAuthUrl.searchParams.set('code_challenge', microsoftPKCE.challenge);
	microsoftAuthUrl.searchParams.set('code_challenge_method', 'S256');
	microsoftAuthUrl.searchParams.set('prompt', 'select_account');
	
	// Redirect to Microsoft
	return Response.redirect(microsoftAuthUrl.toString(), 302);
}

// Custom token handler that validates PKCE
async function handleOAuthToken(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response('Method not allowed', { status: 405 });
	}
	
	const contentType = request.headers.get('content-type');
	if (!contentType?.includes('application/x-www-form-urlencoded')) {
		return new Response('Invalid content type', { status: 400 });
	}
	
	const body = await request.text();
	const params = new URLSearchParams(body);
	
	const grantType = params.get('grant_type');
	const code = params.get('code');
	const redirectUri = params.get('redirect_uri');
	let clientId = params.get('client_id');
	const codeVerifier = params.get('code_verifier');
	
	if (grantType !== 'authorization_code') {
		return new Response('Unsupported grant type', { status: 400 });
	}
	
	// Check for client authentication via Authorization header (client_secret_basic)
	const authHeader = request.headers.get('authorization');
	if (authHeader?.startsWith('Basic ')) {
		const credentials = atob(authHeader.slice(6));
		const [basicClientId, clientSecret] = credentials.split(':');
		
		// If client_id is in the Authorization header, use it
		if (basicClientId) {
			clientId = basicClientId;
			
			// Validate client secret for dynamically registered clients
			const storedSecret = await env.OAUTH_KV.get(`client_secret:${clientId}`);
			if (storedSecret && storedSecret !== clientSecret) {
				return new Response('Invalid client credentials', { status: 401 });
			}
		}
	}
	
	if (!code || !redirectUri || !clientId || !codeVerifier) {
		return new Response('Missing required parameters', { status: 400 });
	}
	
	// Get auth code data
	const authCodeData = await env.OAUTH_KV.get(`auth_code:${code}`);
	if (!authCodeData) {
		return new Response('Invalid authorization code', { status: 400 });
	}
	
	const authData = JSON.parse(authCodeData);
	
	// Validate client_id and redirect_uri
	if (authData.clientId !== clientId || authData.redirectUri !== redirectUri) {
		return new Response('Invalid client or redirect URI', { status: 400 });
	}
	
	// Validate PKCE
	const encoder = new TextEncoder();
	const data = encoder.encode(codeVerifier);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = new Uint8Array(hashBuffer);
	const computedChallenge = btoa(String.fromCharCode(...hashArray))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');
	
	if (computedChallenge !== authData.codeChallenge) {
		return new Response('Invalid code verifier', { status: 400 });
	}
	
	// Delete used auth code
	await env.OAUTH_KV.delete(`auth_code:${code}`);
	
	// Get user data
	const userData = await env.OAUTH_KV.get(`user:${authData.userId}`);
	if (!userData) {
		return new Response('User data not found', { status: 400 });
	}
	
	const user = JSON.parse(userData);
	
	// Generate tokens
	const accessToken = crypto.randomUUID();
	const refreshToken = crypto.randomUUID();
	
	// Store token data
	await env.OAUTH_KV.put(
		`access_token:${accessToken}`,
		JSON.stringify({
			userId: authData.userId,
			clientId: authData.clientId,
			scope: authData.scope,
			email: user.email,
			name: user.name
		}),
		{ expirationTtl: 3600 } // 1 hour
	);
	
	await env.OAUTH_KV.put(
		`refresh_token:${refreshToken}`,
		JSON.stringify({
			userId: authData.userId,
			clientId: authData.clientId,
			scope: authData.scope
		}),
		{ expirationTtl: 2592000 } // 30 days
	);
	
	// Log token issuance
	await logAuditEvent(env, {
		type: 'token_refresh',
		userId: authData.userId,
		clientId: authData.clientId,
		scope: authData.scope,
		timestamp: new Date().toISOString()
	}, request);
	
	// Return tokens
	return new Response(JSON.stringify({
		access_token: accessToken,
		token_type: 'Bearer',
		expires_in: 3600,
		refresh_token: refreshToken,
		scope: authData.scope
	}), {
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			'Pragma': 'no-cache',
			'Access-Control-Allow-Origin': '*'
		}
	});
}

// Handler for OAuth Dynamic Client Registration (RFC 7591)
async function handleOAuthRegister(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response('Method not allowed', { status: 405 });
	}

	try {
		const contentType = request.headers.get('content-type');
		if (!contentType?.includes('application/json')) {
			return new Response(JSON.stringify({
				error: 'invalid_request',
				error_description: 'Content-Type must be application/json'
			}), { 
				status: 400,
				headers: { 
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*'
				}
			});
		}

		const registrationRequest = await request.json() as any;
		
		// Validate required fields per RFC 7591
		if (!registrationRequest.client_name) {
			return new Response(JSON.stringify({
				error: 'invalid_client_metadata',
				error_description: 'client_name is required'
			}), { 
				status: 400,
				headers: { 
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*'
				}
			});
		}

		// Validate redirect_uris if provided
		if (registrationRequest.redirect_uris && !Array.isArray(registrationRequest.redirect_uris)) {
			return new Response(JSON.stringify({
				error: 'invalid_client_metadata',
				error_description: 'redirect_uris must be an array'
			}), { 
				status: 400,
				headers: { 
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*'
				}
			});
		}

		// Generate client credentials
		const clientId = crypto.randomUUID();
		const clientSecret = crypto.randomUUID() + crypto.randomUUID(); // Longer secret
		
		// Create the registered client
		const clientRegistry = new ClientRegistry(env);
		const newClient = {
			clientId,
			clientName: registrationRequest.client_name,
			redirectUris: registrationRequest.redirect_uris || ['urn:ietf:wg:oauth:2.0:oob'],
			allowedScopes: ['mcp:tools', 'profile', 'openid'], // Default scopes
			requirePkce: true, // Always require PKCE for security
			active: true
		};
		
		// Store the full client data in KV (temporary until D1 implementation)
		await env.OAUTH_KV.put(
			`oauth_client:${clientId}`,
			JSON.stringify(newClient),
			{ expirationTtl: 31536000 } // 1 year
		);
		
		// Store client secret separately
		await env.OAUTH_KV.put(
			`client_secret:${clientId}`,
			clientSecret,
			{ expirationTtl: 31536000 } // 1 year
		);
		
		// Return registration response per RFC 7591
		const response = {
			client_id: clientId,
			client_secret: clientSecret,
			client_id_issued_at: Math.floor(Date.now() / 1000),
			client_secret_expires_at: 0, // Never expires
			client_name: registrationRequest.client_name,
			redirect_uris: newClient.redirectUris,
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'client_secret_basic',
			scope: newClient.allowedScopes.join(' '),
			application_type: 'native', // Assuming native app
			subject_type: 'public'
		};
		
		return new Response(JSON.stringify(response), {
			status: 201,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
				'Access-Control-Allow-Origin': '*'
			}
		});
		
	} catch (error) {
		console.error('Client registration error:', error);
		return new Response(JSON.stringify({
			error: 'server_error',
			error_description: 'Failed to register client'
		}), { 
			status: 500,
			headers: { 
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*'
			}
		});
	}
}

// Default handler for non-OAuth routes
const defaultHandler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		// Health check
		if (url.pathname === "/health") {
			return new Response("OK", { status: 200 });
		}

		// Handle SSE MCP routes (unauthenticated for now)
		if (url.pathname.startsWith("/sse")) {
			return mcpSSEHandler.fetch(request, env, ctx);
		}

		// OAuth protected resource metadata endpoints (RFC 9728)
		if (url.pathname === "/.well-known/oauth-protected-resource" || 
		    url.pathname === "/.well-known/oauth-protected-resource/mcp") {
			// Handle CORS preflight
			if (request.method === "OPTIONS") {
				return new Response(null, {
					status: 200,
					headers: {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "GET, OPTIONS",
						"Access-Control-Allow-Headers": "Content-Type",
						"Access-Control-Max-Age": "86400"
					}
				});
			}
			return handleProtectedResourceMetadata(request, env);
		}

		// OAuth authorization server metadata (RFC 8414)
		if (url.pathname === "/.well-known/oauth-authorization-server" || 
		    url.pathname === "/.well-known/oauth-authorization-server/mcp") {
			// Handle CORS preflight
			if (request.method === "OPTIONS") {
				return new Response(null, {
					status: 200,
					headers: {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "GET, OPTIONS",
						"Access-Control-Allow-Headers": "Content-Type",
						"Access-Control-Max-Age": "86400"
					}
				});
			}
			return handleAuthorizationServerMetadata(request, env);
		}

		// Microsoft OAuth callback
		if (url.pathname === "/oauth/callback/microsoft") {
			return handleMicrosoftCallback(request, env, ctx);
		}

		// OAuth authorize completion
		if (url.pathname === "/oauth/authorize/complete") {
			return handleOAuthAuthorizeComplete(request, env, ctx);
		}

		// Handle both /authorize and /oauth/authorize
		if (url.pathname === "/authorize") {
			// Redirect to /oauth/authorize with all query params
			const newUrl = new URL(request.url);
			newUrl.pathname = "/oauth/authorize";
			return Response.redirect(newUrl.toString(), 302);
		}

		// Handle /token endpoint
		if (url.pathname === "/token") {
			// Forward to /oauth/token
			const newUrl = new URL(request.url);
			newUrl.pathname = "/oauth/token";
			return await handleOAuthToken(request, env, ctx);
		}

		// Custom OAuth authorize handler
		if (url.pathname === "/oauth/authorize") {
			// Handle CORS preflight
			if (request.method === "OPTIONS") {
				return new Response(null, {
					status: 200,
					headers: {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
						"Access-Control-Allow-Headers": "Content-Type, Authorization",
						"Access-Control-Max-Age": "86400"
					}
				});
			}
			return handleOAuthAuthorize(request, env, ctx);
		}

		// Custom OAuth token handler with PKCE validation
		if (url.pathname === "/oauth/token") {
			// Handle CORS preflight
			if (request.method === "OPTIONS") {
				return new Response(null, {
					status: 200,
					headers: {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "POST, OPTIONS",
						"Access-Control-Allow-Headers": "Content-Type",
						"Access-Control-Max-Age": "86400"
					}
				});
			}
			return handleOAuthToken(request, env, ctx);
		}

		// OAuth Dynamic Client Registration handler
		if (url.pathname === "/oauth/register") {
			// Handle CORS preflight
			if (request.method === "OPTIONS") {
				return new Response(null, {
					status: 200,
					headers: {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "POST, OPTIONS",
						"Access-Control-Allow-Headers": "Content-Type",
						"Access-Control-Max-Age": "86400"
					}
				});
			}
			return handleOAuthRegister(request, env, ctx);
		}

		// Show OAuth login page for MCP route
		if (url.pathname.startsWith("/mcp") && !request.headers.get('authorization')) {
			return new Response("Authentication required", { 
				status: 401,
				headers: {
					"WWW-Authenticate": `Bearer realm="${url.origin}", error="invalid_token"`
				}
			});
		}

		// Default 404
		return new Response("Not Found", { status: 404 });
	}
};

// Export the Durable Object class
export { ModularMCP };

// Export a simple worker that handles all OAuth flows manually
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const rateLimiter = new RateLimiter();
		
		// Check for authenticated MCP routes
		if (url.pathname.startsWith("/mcp") && request.headers.get('authorization')) {
			// Validate the bearer token
			const auth = request.headers.get('authorization');
			const token = auth?.replace('Bearer ', '');
			
			if (token) {
				const tokenData = await env.OAUTH_KV.get(`access_token:${token}`);
				if (tokenData) {
					// Parse token data to get user ID
					const tokenInfo = JSON.parse(tokenData);
					
					// Apply rate limiting
					const rateLimitResponse = await rateLimiter.limitRequest(env, request, tokenInfo.userId);
					if (rateLimitResponse) {
						return rateLimitResponse;
					}
					
					// Token is valid, forward to MCP handler
					return apiHandler.fetch(request, env, ctx);
				}
			}
			
			return new Response("Invalid token", { 
				status: 401,
				headers: {
					"WWW-Authenticate": `Bearer realm="${url.origin}", error="invalid_token"`
				}
			});
		}
		
		// Apply IP-based rate limiting for all other routes
		const rateLimitResponse = await rateLimiter.limitRequest(env, request);
		if (rateLimitResponse) {
			return rateLimitResponse;
		}
		
		// All other routes go through default handler
		return defaultHandler.fetch(request, env, ctx);
	}
};