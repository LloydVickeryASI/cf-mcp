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
  accessToken?: string;
};

export class ModularMCP extends McpAgent<Env, Record<string, never>, Props> {
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

      // Create SSE response
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();

      // Handle MCP protocol via SSE
      const encoder = new TextEncoder();
      
      // Send initial connection message
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        jsonrpc: "2.0",
        method: "initialized",
        params: {}
      })}\n\n`));

      // Handle incoming messages from the client
      if (request.body) {
        const reader = request.body.getReader();
        
        // Read and process messages
        const processMessages = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const decoder = new TextDecoder();
              const message = decoder.decode(value);
              
              try {
                const jsonMessage = JSON.parse(message);
                const response = await this.handleMCPMessage(jsonMessage);
                
                if (response) {
                  await writer.write(encoder.encode(`data: ${JSON.stringify(response)}\n\n`));
                }
              } catch (parseError) {
                console.error("Failed to parse MCP message:", parseError);
              }
            }
          } catch (error) {
            console.error("Error processing SSE messages:", error);
          } finally {
            await writer.close();
          }
        };

        // Start processing messages in the background
        processMessages().catch(console.error);
      }

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
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  /**
   * Handle regular MCP requests (non-SSE)
   */
  private async handleMCP(request: Request): Promise<Response> {
    try {
      // Extract user context from headers
      const userLogin = request.headers.get("X-User-Login") || "anonymous";
      const userName = request.headers.get("X-User-Name") || "Anonymous User";
      const userEmail = request.headers.get("X-User-Email") || "anonymous@localhost";

      // Initialize the server with user context
      await this.initializeWithUser({
        login: userLogin,
        name: userName,
        email: userEmail,
      });

      if (request.method === "POST") {
        const message = await request.json();
        const response = await this.handleMCPMessage(message);
        
        return new Response(JSON.stringify(response), {
          headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
      });

    } catch (error) {
      console.error("MCP handler error:", error);
      return new Response("Internal Server Error", { status: 500 });
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
              capabilities: {
                tools: {},
                resources: {},
                prompts: {},
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

    // Add provider-specific tools based on configuration
    Object.entries(config.tools).forEach(([provider, providerConfig]) => {
      if (providerConfig.enabled) {
        // Add example tools for each enabled provider
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