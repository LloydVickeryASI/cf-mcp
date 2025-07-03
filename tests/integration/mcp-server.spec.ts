/**
 * Integration tests for MCP Server
 * 
 * Tests the complete MCP protocol flow including OAuth and tool execution
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ModularMCP } from "../../src/mcpServer";
import { oauthServer } from "../setup/vitest.setup";

describe("MCP Server Integration", () => {
  let env: Env;
  let mcpServer: ModularMCP;

  beforeEach(() => {
    // Mock Cloudflare Worker environment
    env = {
      MICROSOFT_CLIENT_ID: "test-client-id",
      MICROSOFT_CLIENT_SECRET: "test-client-secret",
      MICROSOFT_TENANT_ID: "test-tenant-id",
      PANDADOC_CLIENT_ID: "pandadoc-client-id", 
      PANDADOC_CLIENT_SECRET: "pandadoc-client-secret",
      HUBSPOT_CLIENT_ID: "hubspot-client-id",
      HUBSPOT_CLIENT_SECRET: "hubspot-client-secret",
      
      // Mock Cloudflare bindings
      MCP_OBJECT: {
        idFromName: () => ({ toString: () => "test-id" }),
        get: () => ({
          fetch: async (request: Request) => {
            // Mock Durable Object response
            return new Response("OK");
          }
        })
      } as any,
      MCP_DB: {} as any,
      OAUTH_KV: {
        get: async () => null,
        put: async () => {},
        delete: async () => {}
      } as any,
      AI: {} as any
    } as Env;

    mcpServer = new ModularMCP(env, {});
  });

  describe("Server-Sent Events", () => {
    it("should handle SSE connection establishment", async () => {
      const request = new Request("http://localhost:8788/sse", {
        headers: {
          "X-User-Login": "test-user",
          "X-User-Name": "Test User", 
          "X-User-Email": "test@example.com"
        }
      });

      const response = await mcpServer.fetch(request);
      
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      expect(response.headers.get("Connection")).toBe("keep-alive");
    });

    it("should handle CORS preflight requests", async () => {
      const request = new Request("http://localhost:8788/mcp", {
        method: "OPTIONS"
      });

      const response = await mcpServer.fetch(request);
      
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });
  });

  describe("MCP Protocol", () => {
    it("should handle initialize request", async () => {
      const initRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" }
        }
      };

      const request = new Request("http://localhost:8788/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Login": "test-user",
          "X-User-Name": "Test User",
          "X-User-Email": "test@example.com"
        },
        body: JSON.stringify(initRequest)
      });

      const response = await mcpServer.fetch(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.jsonrpc).toBe("2.0");
      expect(result.id).toBe(1);
      expect(result.result.protocolVersion).toBe("2024-11-05");
      expect(result.result.serverInfo.name).toBe("ASI Multi-Tool MCP Gateway");
      expect(result.result.capabilities).toBeDefined();
    });

    it("should handle tools/list request", async () => {
      const listRequest = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list"
      };

      const request = new Request("http://localhost:8788/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Login": "test-user",
          "X-User-Name": "Test User",
          "X-User-Email": "test@example.com"
        },
        body: JSON.stringify(listRequest)
      });

      const response = await mcpServer.fetch(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.jsonrpc).toBe("2.0");
      expect(result.id).toBe(2);
      expect(result.result.tools).toBeInstanceOf(Array);
      
      // Should include health check tool
      const healthTool = result.result.tools.find((tool: any) => tool.name === "health");
      expect(healthTool).toBeDefined();
      expect(healthTool.description).toContain("health");
    });

    it("should handle tools/call for health tool", async () => {
      const callRequest = {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "health",
          arguments: {}
        }
      };

      const request = new Request("http://localhost:8788/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Login": "test-user",
          "X-User-Name": "Test User", 
          "X-User-Email": "test@example.com"
        },
        body: JSON.stringify(callRequest)
      });

      const response = await mcpServer.fetch(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.jsonrpc).toBe("2.0");
      expect(result.id).toBe(3);
      expect(result.result.content).toBeInstanceOf(Array);
      
      const content = result.result.content[0];
      expect(content.type).toBe("text");
      
      const healthData = JSON.parse(content.text);
      expect(healthData.status).toBe("healthy");
      expect(healthData.version).toBe("0.2.0");
      expect(healthData.user.login).toBe("test-user");
    });

    it("should handle invalid method", async () => {
      const invalidRequest = {
        jsonrpc: "2.0",
        id: 4,
        method: "invalid/method"
      };

      const request = new Request("http://localhost:8788/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Login": "test-user",
          "X-User-Name": "Test User",
          "X-User-Email": "test@example.com"
        },
        body: JSON.stringify(invalidRequest)
      });

      const response = await mcpServer.fetch(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.jsonrpc).toBe("2.0");
      expect(result.id).toBe(4);
      expect(result.error.code).toBe(-32601);
      expect(result.error.message).toBe("Method not found");
    });
  });

  describe("Tool Authentication", () => {
    it("should return auth required for PandaDoc tools", async () => {
      const callRequest = {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "pandadoc-list-documents",
          arguments: {}
        }
      };

      const request = new Request("http://localhost:8788/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Login": "test-user",
          "X-User-Name": "Test User",
          "X-User-Email": "test@example.com"
        },
        body: JSON.stringify(callRequest)
      });

      const response = await mcpServer.fetch(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      
      const content = result.result.content[0];
      const authData = JSON.parse(content.text);
      
      expect(authData.requiresAuth).toBe(true);
      expect(authData.provider).toBe("pandadoc");
      expect(authData.authUrl).toContain("/auth/pandadoc");
      expect(authData.message).toContain("authenticate with PandaDoc");
    });
  });
});