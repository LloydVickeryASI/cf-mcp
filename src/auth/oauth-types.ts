/**
 * OAuth Client Registration Request per RFC 7591
 */
export interface ClientRegistrationRequest {
	// Required
	client_name: string;
	
	// Optional
	redirect_uris?: string[];
	grant_types?: string[];
	response_types?: string[];
	scope?: string;
	contacts?: string[];
	logo_uri?: string;
	client_uri?: string;
	policy_uri?: string;
	tos_uri?: string;
	jwks_uri?: string;
	jwks?: any; // JSON Web Key Set
	software_id?: string;
	software_version?: string;
}

/**
 * OAuth Client Registration Response per RFC 7591
 */
export interface ClientRegistrationResponse {
	client_id: string;
	client_secret?: string;
	client_id_issued_at: number;
	client_secret_expires_at?: number;
	client_name: string;
	redirect_uris?: string[];
	grant_types: string[];
	response_types: string[];
	token_endpoint_auth_method: string;
	scope?: string;
	application_type?: string;
	subject_type?: string;
}