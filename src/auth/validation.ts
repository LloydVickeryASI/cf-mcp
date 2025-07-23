/**
 * Input validation utilities for OAuth endpoints
 */

/**
 * Validate a URL string
 */
export function isValidUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		// Allow http/https for development, custom schemes for apps
		return ['http:', 'https:', 'com.app:', 'app:'].some(scheme => 
			parsed.protocol === scheme || parsed.protocol.startsWith(scheme.split(':')[0] + '.')
		);
	} catch {
		return false;
	}
}

/**
 * Validate client_name
 */
export function validateClientName(name: string): { valid: boolean; error?: string } {
	if (!name || typeof name !== 'string') {
		return { valid: false, error: 'client_name is required and must be a string' };
	}
	
	if (name.length < 3) {
		return { valid: false, error: 'client_name must be at least 3 characters long' };
	}
	
	if (name.length > 100) {
		return { valid: false, error: 'client_name must not exceed 100 characters' };
	}
	
	// Check for basic alphanumeric + common punctuation
	if (!/^[\w\s\-._]+$/.test(name)) {
		return { valid: false, error: 'client_name contains invalid characters' };
	}
	
	return { valid: true };
}

/**
 * Validate redirect URIs
 */
export function validateRedirectUris(uris?: string[]): { valid: boolean; error?: string } {
	if (!uris || uris.length === 0) {
		// Optional field, can be empty
		return { valid: true };
	}
	
	if (!Array.isArray(uris)) {
		return { valid: false, error: 'redirect_uris must be an array' };
	}
	
	if (uris.length > 10) {
		return { valid: false, error: 'Too many redirect_uris (max 10)' };
	}
	
	for (const uri of uris) {
		if (typeof uri !== 'string') {
			return { valid: false, error: 'All redirect_uris must be strings' };
		}
		
		// Special case for out-of-band
		if (uri === 'urn:ietf:wg:oauth:2.0:oob') {
			continue;
		}
		
		if (!isValidUrl(uri)) {
			return { valid: false, error: `Invalid redirect_uri: ${uri}` };
		}
	}
	
	return { valid: true };
}

/**
 * Validate grant types
 */
export function validateGrantTypes(types?: string[]): { valid: boolean; error?: string } {
	const allowedGrantTypes = ['authorization_code', 'refresh_token'];
	
	if (!types || types.length === 0) {
		// Optional, will use defaults
		return { valid: true };
	}
	
	if (!Array.isArray(types)) {
		return { valid: false, error: 'grant_types must be an array' };
	}
	
	for (const type of types) {
		if (!allowedGrantTypes.includes(type)) {
			return { valid: false, error: `Unsupported grant_type: ${type}` };
		}
	}
	
	return { valid: true };
}

/**
 * Validate response types
 */
export function validateResponseTypes(types?: string[]): { valid: boolean; error?: string } {
	const allowedResponseTypes = ['code'];
	
	if (!types || types.length === 0) {
		// Optional, will use defaults
		return { valid: true };
	}
	
	if (!Array.isArray(types)) {
		return { valid: false, error: 'response_types must be an array' };
	}
	
	for (const type of types) {
		if (!allowedResponseTypes.includes(type)) {
			return { valid: false, error: `Unsupported response_type: ${type}` };
		}
	}
	
	return { valid: true };
}

/**
 * Validate scopes
 */
export function validateScopes(scope?: string): { valid: boolean; error?: string } {
	const allowedScopes = ['mcp:tools', 'profile', 'openid', 'offline_access'];
	
	if (!scope) {
		// Optional
		return { valid: true };
	}
	
	if (typeof scope !== 'string') {
		return { valid: false, error: 'scope must be a string' };
	}
	
	const requestedScopes = scope.split(' ').filter(s => s);
	for (const s of requestedScopes) {
		if (!allowedScopes.includes(s)) {
			return { valid: false, error: `Unsupported scope: ${s}` };
		}
	}
	
	return { valid: true };
}