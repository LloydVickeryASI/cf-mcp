/**
 * MCP Server with modular architecture
 * 
 * This replaces the simple server in index.ts with a more sophisticated
 * system that uses the configuration and tool registration patterns
 */

import * as Sentry from "@sentry/cloudflare";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { loadConfig, isOperationEnabled } from "./config/loader";
import { createRepositories } from "./db/operations";
import { ToolAuthHelper } from "./auth";
import { registerAllTools } from "./tools";
import { getSentryConfig, handleError, setSentryUser } from "./sentry";
import type { ToolContext, DatabaseHelper } from "./types";

// User context from the OAuth process
type Props = {
  login: string;
  name: string;
  email: string;
  accessToken?: string;
};

/**
 * Build OAuth URL for direct tool responses
 * Routes through our OAuth endpoint to preserve user context
 */
function buildDirectOAuthUrl(provider: string, config: any, baseUrl: string, userId: string = "anonymous"): string {
  // Route through our OAuth endpoint with user_id parameter
  // This ensures the user context is preserved through the OAuth flow
  return `${baseUrl}/auth/${provider}?user_id=${encodeURIComponent(userId)}`;
}

class ModularMCPBase extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "ASI Multi-Tool MCP Gateway",
    version: "0.2.0",
  });

  private serverInfo = {
    name: "ASI Multi-Tool MCP Gateway",
    version: "0.2.0",
  };

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle SSE endpoint for MCP Inspector
    if (url.pathname === "/sse") {
      return this.handleSSE(request);
    }

    // Handle regular MCP requests
    if (url.pathname === "/mcp") {
      return this.handleMCP(request);
    }

    // Default handler
    return new Response("Not Found", { status: 404 });
  }

  /**
   * Handle Server-Sent Events connection for MCP Inspector
   */
  private async handleSSE(request: Request): Promise<Response> {
    try {
      // Extract user context from headers (set by main worker)
      const userLogin = request.headers.get("X-User-Login") || "anonymous";
      const userName = request.headers.get("X-User-Name") || "Anonymous User";
      const userEmail = request.headers.get("X-User-Email") || "anonymous@localhost";

      // Initialize the server with user context
      await this.initializeWithUser({
        login: userLogin,
        name: userName,
        email: userEmail,
      });

      // Create a simple SSE response that sends a heartbeat
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Send initial connection established message
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        type: "connection",
        status: "established",
        serverInfo: this.serverInfo
      })}\n\n`));

      // Send periodic heartbeat to keep connection alive
      const heartbeatInterval = setInterval(async () => {
        try {
          await writer.write(encoder.encode(`data: ${JSON.stringify({
            type: "heartbeat",
            timestamp: new Date().toISOString()
          })}\n\n`));
        } catch (error) {
          console.error("Heartbeat error:", error);
          clearInterval(heartbeatInterval);
        }
      }, 30000); // 30 second heartbeat

      // Handle connection cleanup
      const closeHandler = () => {
        clearInterval(heartbeatInterval);
        writer.close().catch(console.error);
      };

      // Set up connection close detection
      setTimeout(closeHandler, 300000); // 5 minute timeout

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });

    } catch (error) {
      console.error("SSE handler error:", error);
      const errorMessage = handleError(error instanceof Error ? error : new Error(String(error)), {
        handler: "handleSSE",
        userLogin: request.headers.get("X-User-Login")
      });
    }
  }

  /**
   * Handle regular MCP requests (non-SSE)
   */
  private async handleMCP(request: Request): Promise<Response> {
    try {
      // Handle preflight CORS requests
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400",
          },
        });
      }

      // Extract user context from headers
      const userLogin = request.headers.get("X-User-Login") || "anonymous";
      const userName = request.headers.get("X-User-Name") || "Anonymous User";
      const userEmail = request.headers.get("X-User-Email") || "anonymous@localhost";

      // Initialize the server with user context
      const userContext = {
        login: userLogin,
        name: userName,
        email: userEmail,
      };
      
      await this.initializeWithUser(userContext);
      
      // Set Sentry user context
      setSentryUser({
        id: userLogin,
        login: userLogin,
        name: userName,
        email: userEmail,
      });

      if (request.method === "POST") {
        const message = await request.json();
        const response = await this.handleMCPMessage(message);
        
        return new Response(JSON.stringify(response), {
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        });
      }

      // Return server info for GET requests
      return new Response(JSON.stringify({
        name: this.serverInfo.name,
        version: this.serverInfo.version,
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        }
      }), {
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });

    } catch (error) {
      console.error("MCP handler error:", error);
      const errorMessage = handleError(error instanceof Error ? error : new Error(String(error)), {
        handler: "handleMCP",
        method: request.method,
        userLogin: request.headers.get("X-User-Login")
      });
      return new Response(errorMessage, { 
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }
  }

  /**
   * Handle individual MCP protocol messages
   */
  private async handleMCPMessage(message: any): Promise<any> {
    try {
      // Handle different MCP message types
      switch (message.method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: {
                  listChanged: true
                },
                resources: {
                  subscribe: false,
                  listChanged: false
                },
                prompts: {
                  listChanged: false
                },
                logging: {}
              },
              serverInfo: {
                name: this.serverInfo.name,
                version: this.serverInfo.version,
              }
            }
          };

        case "tools/list":
          const tools = this.getAvailableTools();
          return {
            jsonrpc: "2.0",
            id: message.id,
            result: { tools }
          };

        case "tools/call":
          const result = await this.callTool(message.params.name, message.params.arguments);
          return {
            jsonrpc: "2.0",
            id: message.id,
            result
          };

        default:
          return {
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32601,
              message: "Method not found"
            }
          };
      }
    } catch (error) {
      console.error("MCP message handling error:", error);
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32603,
          message: "Internal error"
        }
      };
    }
  }

  /**
   * Get list of available tools
   */
  private getAvailableTools(): any[] {
    // Return configured tools based on enabled providers
    const config = loadConfig(this.env);
    const tools: any[] = [];

    // Add health check tool
    tools.push({
      name: "health",
      description: "Check the health of the MCP gateway and configured tools",
      inputSchema: {
        type: "object",
        properties: {},
      }
    });

    // Add user info tool
    tools.push({
      name: "userInfo", 
      description: "Get current user information and authentication status",
      inputSchema: {
        type: "object",
        properties: {},
      }
    });

    // Add PandaDoc tools if enabled
    if (config.tools.pandadoc?.enabled) {
      if (isOperationEnabled(config, "pandadoc", "listDocuments")) {
        tools.push({
          name: "pandadoc-list-documents",
          description: "List all PandaDoc documents",
          inputSchema: {
            type: "object",
            properties: {
              status: { 
                type: "string", 
                description: "Filter by document status (optional)",
                enum: ["document.draft", "document.sent", "document.viewed", "document.completed", "document.declined"]
              },
              count: { 
                type: "number", 
                description: "Number of documents to return (default: 20, max: 100)"
              }
            }
          }
        });
      }

      if (isOperationEnabled(config, "pandadoc", "listTemplates")) {
        tools.push({
          name: "pandadoc-list-templates",
          description: "List all available PandaDoc templates",
          inputSchema: {
            type: "object",
            properties: {}
          }
        });
      }

      if (isOperationEnabled(config, "pandadoc", "sendDocument")) {
        tools.push({
          name: "pandadoc-send-document",
          description: "Create and send a PandaDoc document using a template",
          inputSchema: {
            type: "object",
            properties: {
              templateId: { type: "string", description: "Template ID to use" },
              recipientEmail: { type: "string", description: "Recipient email address" },
              recipientFirstName: { type: "string", description: "Recipient first name" },
              recipientLastName: { type: "string", description: "Recipient last name" },
              documentName: { type: "string", description: "Name for the document" },
              message: { type: "string", description: "Optional message to include" },
              subject: { type: "string", description: "Optional email subject" },
            },
            required: ["templateId", "recipientEmail", "recipientFirstName", "recipientLastName", "documentName"]
          }
        });
      }

      if (isOperationEnabled(config, "pandadoc", "getStatus")) {
        tools.push({
          name: "pandadoc-get-status",
          description: "Get the status of a PandaDoc document",
          inputSchema: {
            type: "object",
            properties: {
              documentId: { type: "string", description: "Document ID to check" }
            },
            required: ["documentId"]
          }
        });
      }
    }

    // Add provider-specific example tools
    Object.entries(config.tools).forEach(([provider, providerConfig]) => {
      if (providerConfig.enabled) {
        tools.push({
          name: `${provider}-example`,
          description: `Example tool for ${provider} integration`,
          inputSchema: {
            type: "object",
            properties: {
              action: {
                type: "string",
                description: "Action to perform"
              }
            },
            required: ["action"]
          }
        });
      }
    });

    return tools;
  }

  /**
   * Call a specific tool
   */
  private async callTool(toolName: string, args: any): Promise<any> {
    try {
      if (toolName === "health") {
        const config = loadConfig(this.env);
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
              user: this.props,
              timestamp: new Date().toISOString(),
            }, null, 2)
          }],
        };
      }

      if (toolName === "userInfo") {
        return {
          content: [{
            type: "text", 
            text: JSON.stringify({
              user: this.props,
              authenticatedProviders: [], // TODO: Get from database
              timestamp: new Date().toISOString(),
            }, null, 2)
          }],
        };
      }

      // Handle PandaDoc tools
      if (toolName === "pandadoc-list-documents") {
        const config = loadConfig(this.env);
        const baseUrl = this.env.BASE_URL || "https://cf-mcp.asi-cloud.workers.dev";
        const directOAuthUrl = buildDirectOAuthUrl("pandadoc", config, baseUrl, this.props.login);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              requiresAuth: true,
              provider: "pandadoc",
              authUrl: directOAuthUrl,
              message: "Please authenticate with PandaDoc to use this tool",
              note: "Click the authUrl to authenticate, then retry this tool",
              mockData: {
                toolName: "pandadoc-list-documents",
                args: args,
                timestamp: new Date().toISOString()
              }
            }, null, 2)
          }]
        };
      }

      if (toolName === "pandadoc-list-templates") {
        const config = loadConfig(this.env);
        const baseUrl = this.env.BASE_URL || "https://cf-mcp.asi-cloud.workers.dev";
        const directOAuthUrl = buildDirectOAuthUrl("pandadoc", config, baseUrl, this.props.login);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              requiresAuth: true,
              provider: "pandadoc",
              message: "Please authenticate with PandaDoc to use this tool",
              authUrl: directOAuthUrl,
              note: "Click the authUrl to authenticate, then retry this tool"
            }, null, 2)
          }]
        };
      }

      if (toolName === "pandadoc-send-document") {
        const config = loadConfig(this.env);
        const baseUrl = this.env.BASE_URL || "https://cf-mcp.asi-cloud.workers.dev";
        const directOAuthUrl = buildDirectOAuthUrl("pandadoc", config, baseUrl, this.props.login);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              requiresAuth: true,
              provider: "pandadoc",
              message: "Please authenticate with PandaDoc to use this tool",
              authUrl: directOAuthUrl,
              note: "Click the authUrl to authenticate, then retry this tool"
            }, null, 2)
          }]
        };
      }

      if (toolName === "pandadoc-get-status") {
        const config = loadConfig(this.env);
        const baseUrl = this.env.BASE_URL || "https://cf-mcp.asi-cloud.workers.dev";
        const directOAuthUrl = buildDirectOAuthUrl("pandadoc", config, baseUrl, this.props.login);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              requiresAuth: true,
              provider: "pandadoc",
              message: "Please authenticate with PandaDoc to use this tool",
              authUrl: directOAuthUrl,
              note: "Click the authUrl to authenticate, then retry this tool"
            }, null, 2)
          }]
        };
      }

      // Handle provider-specific tools
      if (toolName.includes("-example")) {
        const provider = toolName.replace("-example", "");
        return {
          content: [{
            type: "text",
            text: `Example response from ${provider} provider with action: ${args.action || "none"}`
          }],
        };
      }

      throw new Error(`Tool not found: ${toolName}`);

    } catch (error) {
      console.error(`Tool call error for ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Initialize server with user context
   */
  private async initializeWithUser(userProps: Props): Promise<void> {
    // Set user properties
    this.props = userProps;

    // Initialize if not already done
    if (!this._initialized) {
      await this.init();
      this._initialized = true;
    }
  }

  private _initialized = false;

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
        this.env.BASE_URL || "https://cf-mcp.asi-cloud.workers.dev"
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

// Export the class with Sentry instrumentation if available
export const ModularMCP = (() => {
  // Return the base class instrumented with Sentry if configured
  try {
    return Sentry.instrumentDurableObjectWithSentry(
      getSentryConfig,
      ModularMCPBase
    );
  } catch (error) {
    // Fall back to base class if Sentry instrumentation fails
    console.warn("Failed to instrument with Sentry, using base class:", error);
    return ModularMCPBase;
  }
})(); 