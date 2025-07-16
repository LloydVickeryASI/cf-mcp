/**
 * NetSuite MCP Tools
 * 
 * Enterprise resource planning (ERP)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPConfig } from "../../config/mcp.defaults";
import { isOperationEnabled } from "../../config/loader";

/**
 * Register all NetSuite tools with the MCP server
 */
export function registerTools(server: McpServer, config: MCPConfig, agentContext: any) {
  const toolConfig = config.tools.netsuite;
  
  if (!toolConfig.enabled) {
    return;
  }

  // Register individual NetSuite tools based on configuration
  if (isOperationEnabled(config, "netsuite", "createSalesOrder")) {
    // TODO: Import and register createSalesOrder tool
    console.log("📊 NetSuite createSalesOrder tool enabled");
  }

  if (isOperationEnabled(config, "netsuite", "searchCustomers")) {
    // TODO: Import and register searchCustomers tool  
    console.log("📊 NetSuite searchCustomers tool enabled");
  }
}

// Tool implementations will be added here:
// export { createSalesOrder } from "./salesOrders/create";
// export { searchCustomers } from "./customers/search"; 