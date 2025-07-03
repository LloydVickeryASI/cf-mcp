/**
 * PandaDoc MCP Tools
 * 
 * Electronic signature and document automation
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPConfig } from "../../config/mcp.defaults";
import { isOperationEnabled } from "../../config/loader";

/**
 * Register all PandaDoc tools with the MCP server
 */
export function registerTools(server: McpServer, config: MCPConfig) {
  const toolConfig = config.tools.pandadoc;
  
  if (!toolConfig.enabled) {
    return;
  }

  // Register individual PandaDoc tools based on configuration
  if (isOperationEnabled(config, "pandadoc", "sendDocument")) {
    // TODO: Import and register sendDocument tool
    console.log("📄 PandaDoc sendDocument tool enabled");
  }

  if (isOperationEnabled(config, "pandadoc", "getStatus")) {
    // TODO: Import and register getStatus tool  
    console.log("📄 PandaDoc getStatus tool enabled");
  }

  if (isOperationEnabled(config, "pandadoc", "listTemplates")) {
    // TODO: Import and register listTemplates tool
    console.log("📄 PandaDoc listTemplates tool enabled");
  }
}

// Tool implementations will be added here:
// export { sendDocument } from "./sendDocument";
// export { getStatus } from "./getStatus"; 
// export { listTemplates } from "./listTemplates"; 