/**
 * Main tools registry - imports and re-exports all MCP tools
 * This is where tools get registered with the MCP server based on configuration
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPConfig } from "../config/mcp.defaults";
import { isToolEnabled, isOperationEnabled } from "../config/loader";

// Import all provider tool modules
import * as pandadoc from "./pandadoc";
import * as hubspot from "./hubspot";  
import * as xero from "./xero";
import * as netsuite from "./netsuite";
import * as autotask from "./autotask";

// Agent context interface
export interface AgentContext {
  env: any;
  props: any;
  baseUrl: string;
}

/**
 * Register all enabled tools with the MCP server
 */
export function registerAllTools(server: McpServer, config: MCPConfig, agentContext: AgentContext) {
  console.log("Registering MCP tools...");

  // PandaDoc tools
  if (isToolEnabled(config, "pandadoc")) {
    console.log("Registering PandaDoc tools");
    pandadoc.registerTools(server, config, agentContext);
  }

  // HubSpot tools  
  if (isToolEnabled(config, "hubspot")) {
    console.log("Registering HubSpot tools");
    hubspot.registerTools(server, config, agentContext);
  }

  // Xero tools
  if (isToolEnabled(config, "xero")) {
    console.log("Registering Xero tools");
    xero.registerTools(server, config, agentContext);
  }

  // NetSuite tools
  if (isToolEnabled(config, "netsuite")) {
    console.log("Registering NetSuite tools");
    netsuite.registerTools(server, config, agentContext);
  }

  // Autotask tools
  if (isToolEnabled(config, "autotask")) {
    console.log("Registering Autotask tools");
    autotask.registerTools(server, config, agentContext);
  }

  console.log("✅ Tool registration complete");
}

// Re-export individual provider modules for direct access if needed
export { pandadoc, hubspot, xero, netsuite, autotask }; 