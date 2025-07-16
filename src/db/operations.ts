import { nanoid } from "nanoid";
import type {
  UserSession,
  ToolCredential,
  AuditLog,
  CreateUserSessionInput,
  CreateToolCredentialInput,
  CreateAuditLogInput,
  UpdateUserSessionInput,
  UpdateToolCredentialInput,
} from "./types";

// User Sessions Operations
export class UserSessionsRepository {
  constructor(private db: D1Database) {}

  async create(input: CreateUserSessionInput): Promise<UserSession> {
    const session: UserSession = {
      id: nanoid(),
      ...input,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    };

    await this.db
      .prepare(
        `INSERT INTO user_sessions (id, user_id, email, name, access_token, refresh_token, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        session.id,
        session.user_id,
        session.email,
        session.name,
        session.access_token,
        session.refresh_token,
        session.expires_at,
        session.created_at,
        session.updated_at
      )
      .run();

    return session;
  }

  async findByUserId(userId: string): Promise<UserSession | null> {
    const result = await this.db
      .prepare("SELECT * FROM user_sessions WHERE user_id = ?")
      .bind(userId)
      .first<UserSession>();
    
    return result || null;
  }

  async update(userId: string, input: UpdateUserSessionInput): Promise<void> {
    const updates: string[] = [];
    const bindings: any[] = [];

    if (input.access_token) {
      updates.push("access_token = ?");
      bindings.push(input.access_token);
    }
    if (input.refresh_token !== undefined) {
      updates.push("refresh_token = ?");
      bindings.push(input.refresh_token);
    }
    if (input.expires_at) {
      updates.push("expires_at = ?");
      bindings.push(input.expires_at);
    }

    if (updates.length > 0) {
      updates.push("updated_at = ?");
      bindings.push(Math.floor(Date.now() / 1000));
      bindings.push(userId);

      await this.db
        .prepare(`UPDATE user_sessions SET ${updates.join(", ")} WHERE user_id = ?`)
        .bind(...bindings)
        .run();
    }
  }

  async delete(userId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM user_sessions WHERE user_id = ?")
      .bind(userId)
      .run();
  }
}

// Tool Credentials Operations
export class ToolCredentialsRepository {
  constructor(private db: D1Database) {}

  async create(input: CreateToolCredentialInput): Promise<ToolCredential> {
    const credential: ToolCredential = {
      id: nanoid(),
      user_id: input.user_id,
      provider: input.provider,
      access_token: input.access_token,
      refresh_token: input.refresh_token,
      expires_at: input.expires_at,
      scopes: input.scopes ? JSON.stringify(input.scopes) : undefined,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    };

    await this.db
      .prepare(
        `INSERT OR REPLACE INTO tool_credentials 
         (id, user_id, provider, access_token, refresh_token, expires_at, scopes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        credential.id,
        credential.user_id,
        credential.provider,
        credential.access_token,
        credential.refresh_token,
        credential.expires_at,
        credential.scopes,
        credential.created_at,
        credential.updated_at
      )
      .run();

    return credential;
  }

  async findByUserAndProvider(userId: string, provider: string): Promise<ToolCredential | null> {
    console.log(`🔍 [DB] Looking up credential for user: ${userId}, provider: ${provider}`);
    
    const result = await this.db
      .prepare("SELECT * FROM tool_credentials WHERE user_id = ? AND provider = ?")
      .bind(userId, provider)
      .first<ToolCredential>();
    
    console.log(`🔍 [DB] Query result:`, {
      found: !!result,
      userId,
      provider,
      hasAccessToken: result ? !!result.access_token : false,
      expiresAt: result?.expires_at,
      currentTime: Math.floor(Date.now() / 1000)
    });
    
    return result || null;
  }

  async findByUser(userId: string): Promise<ToolCredential[]> {
    const results = await this.db
      .prepare("SELECT * FROM tool_credentials WHERE user_id = ? ORDER BY provider")
      .bind(userId)
      .all<ToolCredential>();
    
    return results.results || [];
  }

  async update(userId: string, provider: string, input: UpdateToolCredentialInput): Promise<void> {
    const updates: string[] = [];
    const bindings: any[] = [];

    if (input.access_token) {
      updates.push("access_token = ?");
      bindings.push(input.access_token);
    }
    if (input.refresh_token !== undefined) {
      updates.push("refresh_token = ?");
      bindings.push(input.refresh_token);
    }
    if (input.expires_at !== undefined) {
      updates.push("expires_at = ?");
      bindings.push(input.expires_at);
    }
    if (input.scopes) {
      updates.push("scopes = ?");
      bindings.push(JSON.stringify(input.scopes));
    }

    if (updates.length > 0) {
      updates.push("updated_at = ?");
      bindings.push(Math.floor(Date.now() / 1000));
      bindings.push(userId, provider);

      await this.db
        .prepare(`UPDATE tool_credentials SET ${updates.join(", ")} WHERE user_id = ? AND provider = ?`)
        .bind(...bindings)
        .run();
    }
  }

  async delete(userId: string, provider: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM tool_credentials WHERE user_id = ? AND provider = ?")
      .bind(userId, provider)
      .run();
  }
}

// Audit Logs Operations
export class AuditLogsRepository {
  constructor(private db: D1Database) {}

  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    const log: AuditLog = {
      id: nanoid(),
      user_id: input.user_id,
      event_type: input.event_type,
      provider: input.provider || null,
      tool_name: input.tool_name || null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      ip_address: input.ip_address || null,
      user_agent: input.user_agent || null,
      created_at: Math.floor(Date.now() / 1000),
    };

    await this.db
      .prepare(
        `INSERT INTO audit_logs 
         (id, user_id, event_type, provider, tool_name, metadata, ip_address, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        log.id,
        log.user_id,
        log.event_type,
        log.provider,
        log.tool_name,
        log.metadata,
        log.ip_address,
        log.user_agent,
        log.created_at
      )
      .run();

    return log;
  }

  async findByUser(userId: string, limit = 50): Promise<AuditLog[]> {
    const results = await this.db
      .prepare("SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .bind(userId, limit)
      .all<AuditLog>();
    
    return results.results || [];
  }
}

// Convenience factory for creating repositories
export function createRepositories(db: D1Database) {
  return {
    userSessions: new UserSessionsRepository(db),
    toolCredentials: new ToolCredentialsRepository(db),
    auditLogs: new AuditLogsRepository(db),
  };
} 