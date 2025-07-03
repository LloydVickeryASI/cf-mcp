// Database types matching the schema.sql

export interface UserSession {
  id: string;
  user_id: string;
  email: string;
  name: string;
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

export interface ToolCredential {
  id: string;
  user_id: string;
  provider: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scopes?: string; // JSON array
  created_at: number;
  updated_at: number;
}

export interface AuditLog {
  id: string;
  user_id: string;
  event_type: 'auth_grant' | 'tool_call' | 'token_refresh' | 'auth_revoke';
  provider?: string;
  tool_name?: string;
  metadata?: string; // JSON object
  ip_address?: string;
  user_agent?: string;
  created_at: number;
}

// Input types for creating records
export interface CreateUserSessionInput {
  user_id: string;
  email: string;
  name: string;
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

export interface CreateToolCredentialInput {
  user_id: string;
  provider: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scopes?: string[];
}

export interface CreateAuditLogInput {
  user_id: string;
  event_type: AuditLog['event_type'];
  provider?: string;
  tool_name?: string;
  metadata?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
}

// Update types
export interface UpdateUserSessionInput {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

export interface UpdateToolCredentialInput {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  scopes?: string[];
} 