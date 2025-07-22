/**
 * Type definitions for Agent Context used throughout the tools system
 */

import type { MCPConfig } from "@/config/types";
import type { ModularMCPProps } from "@/types";

/**
 * Environment bindings with proper types
 */
export interface TypedEnv extends Cloudflare.Env {
  // OAuth settings
  OAUTH_ENABLED: string; // "true" | "false"
  
  // Numeric settings
  SENTRY_SAMPLE_RATE: string; // Should be parsed to number
  
  // Optional settings
  BASE_URL?: string;
  OAUTH_REGISTERED_CLIENTS?: string; // JSON string of registered clients
}

/**
 * User properties passed through the agent context
 */
export interface UserProps {
  id: string;
  name: string;
  email: string;
  source: string;
}

/**
 * Complete agent context with properly typed properties
 */
export interface AgentContext {
  /**
   * Cloudflare environment bindings (KV, D1, Durable Objects, etc.)
   */
  env: TypedEnv;
  
  /**
   * User properties from the MCP session
   */
  props: ModularMCPProps;
  
  /**
   * Base URL for OAuth redirects and API endpoints
   */
  baseUrl: string;
  
  /**
   * Optional configuration object
   */
  config?: MCPConfig;
}

/**
 * Enhanced context provided to tools via withOAuth wrapper
 */
export interface ToolContext<TArgs = any> {
  /**
   * Tool arguments passed from the client
   */
  args: TArgs;
  
  /**
   * Valid access token for the provider
   */
  accessToken: string;
  
  /**
   * Original agent context
   */
  agentContext: AgentContext;
}

/**
 * Type guard to check if a value is a valid AgentContext
 */
export function isAgentContext(value: unknown): value is AgentContext {
  if (!value || typeof value !== 'object') return false;
  
  const ctx = value as any;
  return (
    typeof ctx.env === 'object' &&
    typeof ctx.props === 'object' &&
    typeof ctx.baseUrl === 'string'
  );
}

/**
 * Type guard to check if props contain user information
 */
export function hasUserProps(props: unknown): props is ModularMCPProps {
  if (!props || typeof props !== 'object') return false;
  
  const p = props as any;
  return (
    typeof p.user_id === 'string' &&
    typeof p.user_name === 'string' &&
    typeof p.user_email === 'string'
  );
}