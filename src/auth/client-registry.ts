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
			'https://inspector.modelcontextprotocol.io/callback'
		],
		allowedScopes: ['mcp:tools', 'profile', 'openid'],
		requirePkce: true,
		active: true
	}
];

export class ClientRegistry {
	private clients: Map<string, RegisteredClient>;

	constructor(env: Env) {
		this.clients = new Map();
		
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
	 * Validate a client_id and redirect_uri combination
	 */
	async validateClient(clientId: string, redirectUri: string): Promise<{ valid: boolean; error?: string }> {
		const client = this.clients.get(clientId);
		
		if (!client) {
			return { valid: false, error: 'Invalid client_id' };
		}

		if (!client.active) {
			return { valid: false, error: 'Client is inactive' };
		}

		// Check if redirect URI matches any registered patterns
		const isValidRedirect = client.redirectUris.some(pattern => {
			// Handle wildcard ports (e.g., http://localhost:*)
			if (pattern.includes(':*')) {
				const basePattern = pattern.replace(':*', '');
				const baseRedirect = redirectUri.replace(/:\d+/, '');
				return baseRedirect.startsWith(basePattern);
			}
			// Exact match
			return redirectUri === pattern;
		});

		if (!isValidRedirect) {
			return { valid: false, error: 'Invalid redirect_uri for this client' };
		}

		return { valid: true };
	}

	/**
	 * Validate requested scopes against allowed scopes for a client
	 */
	async validateScopes(clientId: string, requestedScopes: string[]): Promise<{ valid: boolean; error?: string }> {
		const client = this.clients.get(clientId);
		
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
	isPkceRequired(clientId: string): boolean {
		const client = this.clients.get(clientId);
		return client?.requirePkce ?? true; // Default to requiring PKCE
	}

	/**
	 * Get client information (for display purposes)
	 */
	getClient(clientId: string): RegisteredClient | undefined {
		return this.clients.get(clientId);
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