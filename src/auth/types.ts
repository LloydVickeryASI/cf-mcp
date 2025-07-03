// Authentication types and interfaces

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  authUrl: string;
  tokenUrl: string;
  redirectUri?: string;
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scope?: string;
  token_type?: string;
}

export interface AuthorizationRequest {
  provider: string;
  userId: string;
  state: string;
  codeVerifier?: string; // For PKCE
  redirectUri: string;
}

export interface AuthorizationCallback {
  code: string;
  state: string;
  provider: string;
}

// Microsoft OAuth specific types
export interface MicrosoftOAuthConfig extends OAuthConfig {
  tenantId?: string;
  resource?: string;
}

export interface MicrosoftUserInfo {
  id: string;
  displayName: string;
  userPrincipalName: string;
  mail?: string;
  givenName?: string;
  surname?: string;
}

// Tool-specific OAuth provider configurations
export interface ProviderOAuthConfigs {
  pandadoc: OAuthConfig;
  hubspot: OAuthConfig;
  xero: OAuthConfig;
  netsuite: OAuthConfig;
  autotask: OAuthConfig;
} 