/**
 * MCP Server using Cloudflare's standard transport methods
 * 
 * This implements the standard Cloudflare MCP pattern with SSE and Streamable HTTP
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "./config/loader.js";
import { registerAllTools } from "./tools/index.js";
import { instrumentDurableObjectWithSentry } from "@sentry/cloudflare";

// Define the Props interface as a Record<string, unknown> to satisfy the constraint
interface Props extends Record<string, unknown> {
  id: string;
  name: string;
  email: string;
  source: string;
}

// Define the Env interface with all required properties
interface Env {
  MCP_DB: D1Database;
  CONFIG_KV: KVNamespace;
  MICROSOFT_CLIENT_ID: string;
  MICROSOFT_CLIENT_SECRET: string;
  MICROSOFT_TENANT_ID: string;
  PANDADOC_CLIENT_ID: string;
  PANDADOC_CLIENT_SECRET: string;
  PANDADOC_API_KEY: string;
  HUBSPOT_CLIENT_ID: string;
  HUBSPOT_CLIENT_SECRET: string;
  XERO_CLIENT_ID: string;
  XERO_CLIENT_SECRET: string;
  NETSUITE_CLIENT_ID: string;
  NETSUITE_CLIENT_SECRET: string;
  AUTOTASK_CLIENT_ID: string;
  AUTOTASK_CLIENT_SECRET: string;
  SENTRY_DSN: string;
  COOKIE_ENCRYPTION_KEY: string;
  AUTH_HEADER_SECRET?: string;
}

/**
 * Cloudflare MCP Server implementation using McpAgent
 * This follows the standard Cloudflare MCP pattern with SSE and Streamable HTTP transport
 */
export class ModularMCPServer extends McpAgent<Env, {}, Props> {
  server = new McpServer({
    name: "ASI MCP Gateway",
    version: "0.2.0",
  });

  /**
   * Override fetch to handle authentication, then delegate to McpAgent
   */
  async fetch(request: Request): Promise<Response> {
    console.log(`🌐 ModularMCPServer.fetch: ${request.method} ${request.url}`);
    
    // Ensure props is initialized
    if (!this.props) {
      this.props = {
        id: "anonymous",
        name: "Anonymous User",
        email: "anonymous@localhost",
        source: "unknown"
      };
    }
    
    // Handle authentication if present
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      console.log("🔐 Request with auth token:", token);
      
      // Extract user info from token format: lloyd-mcp-dev-...
      if (token.startsWith("lloyd-")) {
        this.props.id = "lloyd";
        this.props.name = "Lloyd Vickery";
        this.props.email = "lloyd@asi.co.nz";
        this.props.source = "header-auth";
      }
    }
    
    // Let McpAgent handle all transport protocols automatically
    return super.fetch(request);
  }

  /**
   * Initialize the MCP server with tools
   */
  async init() {
    console.log("🚀 Initializing MCP Server");
    
    // Initialize props if not already set
    if (!this.props) {
      this.props = {
        id: "anonymous",
        name: "Anonymous User",
        email: "anonymous@localhost",
        source: "init"
      };
    }
    
    // Load configuration
    const config = loadConfig(this.env);
    console.log("📝 Configuration loaded:", {
      enabledTools: Object.entries(config.tools)
        .filter(([, toolConfig]: [string, any]) => toolConfig.enabled)
        .map(([name]) => name)
    });

    // Register built-in tools
    this.registerBuiltInTools(config);

    // Register all provider tools with agent context
    await registerAllTools(this.server, config, {
      env: this.env,
      props: this.props,
      baseUrl: "https://cf-mcp.asi-cloud.workers.dev" // TODO: Get from request or config
    });

    console.log("✅ MCP Server initialized successfully");
  }

  /**
   * Register built-in system tools
   */
  private registerBuiltInTools(config: any) {
    // Health check tool
    this.server.registerTool(
      "health",
      {
        title: "Health Check",
        description: "Check the health status of the MCP server",
        inputSchema: {}
      },
      async () => {
        const enabledTools = Object.entries(config.tools)
          .filter(([, toolConfig]: [string, any]) => toolConfig.enabled)
          .map(([name]) => name);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "healthy",
              version: "0.2.0",
              enabledProviders: enabledTools,
              user: this.props,
              timestamp: new Date().toISOString(),
            }, null, 2)
          }]
        };
      }
    );

    // User info tool
    this.server.registerTool(
      "userInfo",
      {
        title: "User Information",
        description: "Get information about the current authenticated user",
        inputSchema: {}
      },
      async () => {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              user: this.props,
              timestamp: new Date().toISOString(),
            }, null, 2)
          }]
        };
      }
    );
  }
}

// Apply Sentry instrumentation to the Durable Object
export const MCP = instrumentDurableObjectWithSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 1.0,
  }),
  ModularMCPServer as any  // Use type assertion to work around constructor visibility
); 