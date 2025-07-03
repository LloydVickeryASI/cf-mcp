/**
 * Database migration utility
 * 
 * Run this to set up the D1 database schema:
 * wrangler d1 execute <database-name> --file=./src/db/schema.sql --local
 * wrangler d1 execute <database-name> --file=./src/db/schema.sql --remote
 */

export async function runMigrations(db: D1Database): Promise<void> {
  console.log("Running database migrations...");

  try {
    // Check if user_sessions table exists
    const tables = await db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('user_sessions', 'tool_credentials', 'audit_logs')
    `).all();

    const existingTables = new Set(tables.results.map((row: any) => row.name));
    
    if (existingTables.size === 3) {
      console.log("✅ All database tables already exist");
      return;
    }

    console.log("📝 Creating missing tables...");

    // Run the schema creation (this is idempotent due to IF NOT EXISTS)
    const schema = `
      -- User sessions table
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
      CREATE TABLE IF NOT EXISTS tool_credentials (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          expires_at INTEGER,
          scopes TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(user_id, provider),
          FOREIGN KEY (user_id) REFERENCES user_sessions(user_id)
      );

      -- Audit logs table
      CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          provider TEXT,
          tool_name TEXT,
          metadata TEXT,
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
    `;

    // Split and execute each statement
    const statements = schema.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        await db.prepare(statement.trim()).run();
      }
    }

    console.log("✅ Database migrations completed successfully");

  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  }
}

// Helper function to check database connectivity
export async function checkDatabaseConnection(db: D1Database): Promise<boolean> {
  try {
    await db.prepare("SELECT 1").first();
    return true;
  } catch (error) {
    console.error("Database connection failed:", error);
    return false;
  }
} 