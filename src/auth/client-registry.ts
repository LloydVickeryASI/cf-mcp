/**
 * OAuth Client Registry
 * 
 * Manages registered OAuth clients and validates client credentials.
 * In production, this should be backed by a database (D1).
 * For now, we use a static configuration with environment variable overrides.
 */

export interface RegisteredClient {
	clientId: string;
	clientName: string;
	redirectUris: string[];
	allowedScopes: string[];
	requirePkce: boolean;
	active: boolean;
}

// Default clients for development and testing
const DEFAULT_CLIENTS: RegisteredClient[] = [
	{
		clientId: 'mcp-inspector',
		clientName: 'MCP Inspector',
		redirectUris: [
			'http://localhost:*',
			'https://localhost:*',
			'https://inspector.modelcontextprotocol.io/callback',
			'http://localhost:*/auth/callback',
			'http://localhost:*/callback',
			'http://localhost:6277/auth/callback',
			'http://localhost:6277/callback',
			'http://localhost:3000/test-oauth-flow.html',
			'http://127.0.0.1:*/auth/callback',
			'http://127.0.0.1:*/callback'
		],
		allowedScopes: ['mcp:tools', 'profile', 'openid'],
		requirePkce: true,
		active: true
	}
];

export class ClientRegistry {
	private clients: Map<string, RegisteredClient>;
	private env: Env;

	constructor(env: Env) {
		this.clients = new Map();
		this.env = env;
		
		// Load default clients
		DEFAULT_CLIENTS.forEach(client => {
			this.clients.set(client.clientId, client);
		});

		// Load additional clients from environment if available
		if (env.OAUTH_REGISTERED_CLIENTS) {
			try {
				const envClients = JSON.parse(env.OAUTH_REGISTERED_CLIENTS) as RegisteredClient[];
				envClients.forEach(client => {
					this.clients.set(client.clientId, client);
				});
			} catch (error) {
				console.error('Failed to parse OAUTH_REGISTERED_CLIENTS:', error);
			}
		}
	}

	/**
	 * Get client from static registry or KV storage
	 */
	private async getClientFromKVOrRegistry(clientId: string): Promise<RegisteredClient | null> {
		// Check static registry first
		let client = this.clients.get(clientId);
		
		// If not in static registry, check KV for dynamically registered client
		if (!client && this.env) {
			const kvData = await this.env.OAUTH_KV.get(`oauth_client:${clientId}`);
			if (kvData) {
				try {
					client = JSON.parse(kvData) as RegisteredClient;
				} catch (e) {
					console.error('Failed to parse client data from KV:', e);
					return null;
				}
			}
		}
		
		return client || null;
	}

	/**
	 * Validate a client_id and redirect_uri combination
	 */
	async validateClient(clientId: string, redirectUri: string): Promise<{ valid: boolean; error?: string }> {
		const client = await this.getClientFromKVOrRegistry(clientId);
		
		if (!client) {
			console.error('Client not found:', clientId, 'Available clients:', Array.from(this.clients.keys()));
			return { valid: false, error: 'Invalid client_id' };
		}

		if (!client.active) {
			return { valid: false, error: 'Client is inactive' };
		}

		// Check if redirect URI matches any registered patterns
		const isValidRedirect = client.redirectUris.some(pattern => {
			// Handle wildcard ports (e.g., http://localhost:*)
			if (pattern.includes(':*')) {
				try {
					// Parse the pattern and redirect URI as URLs for proper comparison
					const patternUrl = new URL(pattern.replace(':*', ':9999')); // Temp port for parsing
					const redirectUrl = new URL(redirectUri);
					
					// Check protocol and hostname match
					if (patternUrl.protocol !== redirectUrl.protocol || 
						patternUrl.hostname !== redirectUrl.hostname) {
						return false;
					}
					
					// Check if path matches (if specified in pattern)
					const patternPath = pattern.substring(pattern.indexOf('/', pattern.indexOf(':*') + 2));
					if (patternPath && patternPath !== '/') {
						return redirectUrl.pathname === patternPath;
					}
					
					// Pattern matches any path if no specific path is given
					return true;
				} catch (e) {
					// If URL parsing fails, fall back to exact match
					return false;
				}
			}
			// Exact match
			return redirectUri === pattern;
		});

		if (!isValidRedirect) {
			console.error('Redirect URI validation failed:', {
				clientId,
				requestedRedirectUri: redirectUri,
				registeredRedirectUris: client.redirectUris
			});
			return { valid: false, error: 'Invalid redirect_uri for this client' };
		}

		return { valid: true };
	}

	/**
	 * Validate requested scopes against allowed scopes for a client
	 */
	async validateScopes(clientId: string, requestedScopes: string[]): Promise<{ valid: boolean; error?: string }> {
		const client = await this.getClientFromKVOrRegistry(clientId);
		
		if (!client) {
			return { valid: false, error: 'Invalid client_id' };
		}

		// Check if all requested scopes are allowed
		const invalidScopes = requestedScopes.filter(scope => 
			!client.allowedScopes.includes(scope)
		);

		if (invalidScopes.length > 0) {
			return { 
				valid: false, 
				error: `Invalid scopes requested: ${invalidScopes.join(', ')}` 
			};
		}

		return { valid: true };
	}

	/**
	 * Check if PKCE is required for a client
	 */
	async isPkceRequired(clientId: string): Promise<boolean> {
		const client = await this.getClientFromKVOrRegistry(clientId);
		return client?.requirePkce ?? true; // Default to requiring PKCE
	}

	/**
	 * Get client information (for display purposes)
	 */
	async getClient(clientId: string): Promise<RegisteredClient | undefined> {
		const client = await this.getClientFromKVOrRegistry(clientId);
		return client || undefined;
	}

	/**
	 * Register a new client dynamically (for future use)
	 */
	async registerClient(client: RegisteredClient, env: Env): Promise<void> {
		// In production, this would persist to D1 database
		this.clients.set(client.clientId, client);
		
		// TODO: Persist to D1 database
		// await env.MCP_DB.prepare(`
		//   INSERT INTO oauth_clients (client_id, client_name, redirect_uris, allowed_scopes, require_pkce, active)
		//   VALUES (?, ?, ?, ?, ?, ?)
		// `).bind(
		//   client.clientId,
		//   client.clientName,
		//   JSON.stringify(client.redirectUris),
		//   JSON.stringify(client.allowedScopes),
		//   client.requirePkce ? 1 : 0,
		//   client.active ? 1 : 0
		// ).run();
	}
}