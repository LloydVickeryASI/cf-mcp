// Shared types and enums for the MCP system

// Re-export config types for convenience
export type { MCPConfig } from "../config/mcp.defaults";
export { loadConfig, getToolConfig, isToolEnabled, isOperationEnabled } from "../config/loader";

export enum Provider {
  PANDADOC = "pandadoc",
  HUBSPOT = "hubspot", 
  XERO = "xero",
  NETSUITE = "netsuite",
  AUTOTASK = "autotask",
}

export enum EventType {
  AUTH_GRANT = "auth_grant",
  TOOL_CALL = "tool_call", 
  TOKEN_REFRESH = "token_refresh",
  AUTH_REVOKE = "auth_revoke",
}

// Tool execution context passed to all MCP tools
export interface ToolContext {
  env: Env;
  request: Request;
  waitUntil: (promise: Promise<any>) => void;
  auth: AuthHelper;
  db: DatabaseHelper;
  config: import("../config/mcp.defaults").MCPConfig;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

// Auth helper interface for tool authentication
export interface AuthHelper {
  getToken(provider: Provider | string): Promise<string | null>;
  requiresAuth(provider: Provider | string): Promise<{ authUrl: string } | null>;
}

// Database helper interface for tool data access
export interface DatabaseHelper {
  userSessions: import("../db/operations").UserSessionsRepository;
  toolCredentials: import("../db/operations").ToolCredentialsRepository;
  auditLogs: import("../db/operations").AuditLogsRepository;
}

// Rate limiting configuration
export interface RateLimitConfig {
  max: number;
  period: string; // "1m", "1h", "1d", etc.
}

// Tool response types
export interface ToolResponse {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
  }>;
  isError?: boolean;
  requiresAuth?: boolean;
  authUrl?: string;
  metadata?: Record<string, any>;
}

// Tool execution error
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number,
    public readonly provider?: string
  ) {
    super(message);
    this.name = "ToolError";
  }
}

// Auth requirement error for tools that need authentication
export class AuthRequiredError extends ToolError {
  constructor(
    public readonly provider: string,
    public readonly authUrl: string,
    message = `Authentication required for ${provider}`
  ) {
    super(message, "AUTH_REQUIRED", 401, provider);
    this.name = "AuthRequiredError";
  }
} 