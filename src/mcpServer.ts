/**
 * MCP Server with modular architecture
 * 
 * This replaces the simple server in index.ts with a more sophisticated
 * system that uses the configuration and tool registration patterns
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { loadConfig } from "./config/loader";
import { createRepositories } from "./db/operations";
import { ToolAuthHelper } from "./auth";
import { registerAllTools } from "./tools";
import type { ToolContext, DatabaseHelper } from "./types";

// User context from the OAuth process
type Props = {
  login: string;
  name: string;
  email: string;
  accessToken: string;
};

export class ModularMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "ASI Multi-Tool MCP Gateway",
    version: "0.2.0",
  });

  async init() {
    try {
      // Load configuration from environment
      const config = loadConfig(this.env);
      
      // Set up database repositories
      const repositories = createRepositories(this.env.MCP_DB);
      
      // Create database helper
      const dbHelper: DatabaseHelper = {
        userSessions: repositories.userSessions,
        toolCredentials: repositories.toolCredentials,
        auditLogs: repositories.auditLogs,
      };

      // Create auth helper for this user
      const authHelper = new ToolAuthHelper(
        this.env.MCP_DB,
        config,
        this.props.login, // Using login as user ID for now
        "https://mcp.asi.co.nz" // TODO: Get from environment
      );

      // Create tool context
      const toolContext: Partial<ToolContext> = {
        env: this.env,
        auth: authHelper,
        db: dbHelper,
        config,
        user: {
          id: this.props.login,
          email: this.props.email,
          name: this.props.name,
        },
      };

      // Register all enabled tools
      registerAllTools(this.server, config);

      // Add a simple health check tool
      this.server.tool(
        "health",
        "Check the health of the MCP gateway and configured tools",
        {},
        async () => {
          const enabledTools = Object.entries(config.tools)
            .filter(([, toolConfig]) => toolConfig.enabled)
            .map(([name]) => name);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "healthy",
                version: "0.2.0",
                enabledProviders: enabledTools,
                user: toolContext.user,
                timestamp: new Date().toISOString(),
              }, null, 2)
            }],
          };
        }
      );

      // Add user info tool (similar to original userInfoOctokit)
      this.server.tool(
        "userInfo",
        "Get current user information and authentication status",
        {},
        async () => {
          return {
            content: [{
              type: "text", 
              text: JSON.stringify({
                user: toolContext.user,
                authenticatedProviders: [], // TODO: Get from database
                timestamp: new Date().toISOString(),
              }, null, 2)
            }],
          };
        }
      );

      console.log("✅ Modular MCP server initialized successfully");

    } catch (error) {
      console.error("❌ Failed to initialize MCP server:", error);
      throw error;
    }
  }
} 