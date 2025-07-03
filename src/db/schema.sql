-- User sessions table
-- Stores OAuth tokens and user profile data from Microsoft
CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Tool credentials table  
-- Stores per-user, per-tool OAuth tokens
CREATE TABLE IF NOT EXISTS tool_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL, -- 'pandadoc', 'hubspot', 'xero', etc.
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at INTEGER,
    scopes TEXT, -- JSON array of granted scopes
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, provider),
    FOREIGN KEY (user_id) REFERENCES user_sessions(user_id)
);

-- Audit logs table
-- Tracks tool usage and auth events for security/compliance
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL, -- 'auth_grant', 'tool_call', 'token_refresh'
    provider TEXT, -- null for system events
    tool_name TEXT, -- null for auth events  
    metadata TEXT, -- JSON with request details
    ip_address TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES user_sessions(user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_tool_credentials_user_provider ON tool_credentials(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_tool_credentials_expires_at ON tool_credentials(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type); 