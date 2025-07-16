/**
 * Autotask MCP Tools
 * 
 * Professional services automation (PSA)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPConfig } from "../../config/mcp.defaults";
import { isOperationEnabled } from "../../config/loader";

/**
 * Register all Autotask tools with the MCP server
 */
export function registerTools(server: McpServer, config: MCPConfig, agentContext: any) {
  const toolConfig = config.tools.autotask;
  
  if (!toolConfig.enabled) {
    return;
  }

  // Register individual Autotask tools based on configuration
  if (isOperationEnabled(config, "autotask", "createTicket")) {
    // TODO: Import and register createTicket tool
    console.log("🎫 Autotask createTicket tool enabled");
  }

  if (isOperationEnabled(config, "autotask", "updateTicket")) {
    // TODO: Import and register updateTicket tool  
    console.log("🎫 Autotask updateTicket tool enabled");
  }
}

// Tool implementations will be added here:
// export { createTicket } from "./tickets/create";
// export { updateTicket } from "./tickets/update"; 