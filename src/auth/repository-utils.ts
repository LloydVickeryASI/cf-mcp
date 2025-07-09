/**
 * Shared utilities for common repository operations
 * Reduces boilerplate across auth-related files
 */

import { createRepositories } from "../db/operations";

/**
 * Create repositories helper that can be used across auth files
 * Centralizes the pattern of creating repositories from D1Database
 */
export function createAuthRepositories(db: D1Database) {
  return createRepositories(db);
}

/**
 * Common audit logging helper for OAuth-related events
 */
export async function logAuthEvent(
  db: D1Database,
  userId: string,
  eventType: "auth_grant" | "token_refresh" | "tool_call",
  provider: string,
  metadata?: Record<string, any>
) {
  const repositories = createAuthRepositories(db);
  
  // Skip audit logging for anonymous users
  if (userId === "anonymous") {
    return;
  }
  
  try {
    await repositories.auditLogs.create({
      user_id: userId,
      event_type: eventType,
      provider,
      metadata,
    });
  } catch (error) {
    console.error(`Failed to log auth event for ${userId}:${provider}:`, error);
    // Don't throw - audit logging failures shouldn't break the auth flow
  }
}

/**
 * Common tool credentials helper
 */
export async function getToolCredentials(
  db: D1Database,
  userId: string,
  provider: string
) {
  const repositories = createAuthRepositories(db);
  return await repositories.toolCredentials.findByUserAndProvider(userId, provider);
}

/**
 * Common tool credentials update helper
 */
export async function updateToolCredentials(
  db: D1Database,
  userId: string,
  provider: string,
  updates: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  }
) {
  const repositories = createAuthRepositories(db);
  return await repositories.toolCredentials.update(userId, provider, updates);
}

/**
 * Common tool credentials creation helper
 */
export async function createToolCredentials(
  db: D1Database,
  credentials: {
    user_id: string;
    provider: string;
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
    scopes?: string[];
  }
) {
  const repositories = createAuthRepositories(db);
  return await repositories.toolCredentials.create(credentials);
} 