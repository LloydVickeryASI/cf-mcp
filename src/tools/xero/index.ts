/**
 * Xero MCP Tools
 * 
 * Accounting and financial management
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPConfig } from "../../config/mcp.defaults";
import { isOperationEnabled } from "../../config/loader";

/**
 * Register all Xero tools with the MCP server
 */
export function registerTools(server: McpServer, config: MCPConfig, agentContext: any) {
  const toolConfig = config.tools.xero;
  
  if (!toolConfig.enabled) {
    return;
  }

  // Register individual Xero tools based on configuration
  if (isOperationEnabled(config, "xero", "createInvoice")) {
    // TODO: Import and register createInvoice tool
    console.log("💰 Xero createInvoice tool enabled");
  }

  if (isOperationEnabled(config, "xero", "listContacts")) {
    // TODO: Import and register listContacts tool  
    console.log("💰 Xero listContacts tool enabled");
  }
}

// Tool implementations will be added here:
// export { createInvoice } from "./invoices/create";
// export { listContacts } from "./contacts/list"; 