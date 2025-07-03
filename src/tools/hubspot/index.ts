/**
 * HubSpot MCP Tools
 * 
 * CRM and marketing automation
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPConfig } from "../../config/mcp.defaults";
import { isOperationEnabled } from "../../config/loader";

/**
 * Register all HubSpot tools with the MCP server
 */
export function registerTools(server: McpServer, config: MCPConfig) {
  const toolConfig = config.tools.hubspot;
  
  if (!toolConfig.enabled) {
    return;
  }

  // Register individual HubSpot tools based on configuration
  if (isOperationEnabled(config, "hubspot", "searchContacts")) {
    // TODO: Import and register searchContacts tool
    console.log("🏢 HubSpot searchContacts tool enabled");
  }

  if (isOperationEnabled(config, "hubspot", "createContact")) {
    // TODO: Import and register createContact tool  
    console.log("🏢 HubSpot createContact tool enabled");
  }

  if (isOperationEnabled(config, "hubspot", "listDeals")) {
    // TODO: Import and register listDeals tool
    console.log("🏢 HubSpot listDeals tool enabled");
  }
}

// Tool implementations will be added here:
// export { searchContacts } from "./contacts/search";
// export { createContact } from "./contacts/create"; 
// export { listDeals } from "./deals/list"; 