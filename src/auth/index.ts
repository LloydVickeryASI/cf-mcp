/**
 * Authentication module barrel export
 */

export { ToolAuthHelper } from "./tool-auth";
export { withOAuth } from "./withOAuth";
export { handleOAuthAuthorize, handleOAuthCallback } from "./oauth-handlers";
export type { 
  OAuthConfig, 
  TokenSet, 
  AuthorizationRequest, 
  AuthorizationCallback,
  MicrosoftOAuthConfig,
  MicrosoftUserInfo,
  ProviderOAuthConfigs 
} from "./types";
export type { OAuthContext, AuthRequiredResponse, ToolHandler } from "./withOAuth"; 