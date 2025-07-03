/**
 * PandaDoc MCP Tools
 * 
 * Document creation, e-signature, and template management
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPConfig } from "../../config/mcp.defaults";
import { isOperationEnabled } from "../../config/loader";

// Register PandaDoc tools if enabled
export function registerTools(server: McpServer, config: MCPConfig) {
  const toolConfig = config.tools.pandadoc;
  
  if (!toolConfig?.enabled) {
    console.log("PandaDoc tools disabled");
    return;
  }

  console.log("Registering PandaDoc tools");

  // List Templates tool
  if (isOperationEnabled(config, "pandadoc", "listTemplates")) {
    server.tool(
      "pandadoc-list-templates",
      "List all available PandaDoc templates",
      {},
      async () => {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                requiresAuth: true,
                provider: "pandadoc",
                message: "Please authenticate with PandaDoc to use this tool",
                authUrl: "/auth/pandadoc"
              }, null, 2),
            },
          ],
        };
      }
    );
    console.log("📄 PandaDoc listTemplates tool enabled");
  }

  // Send Document tool
  if (isOperationEnabled(config, "pandadoc", "sendDocument")) {
    server.tool(
      "pandadoc-send-document",
      "Create and send a PandaDoc document using a template",
      {
        templateId: { type: "string", description: "Template ID to use" },
        recipientEmail: { type: "string", description: "Recipient email address" },
        recipientFirstName: { type: "string", description: "Recipient first name" },
        recipientLastName: { type: "string", description: "Recipient last name" },
        documentName: { type: "string", description: "Name for the document" },
        message: { type: "string", description: "Optional message to include" },
        subject: { type: "string", description: "Optional email subject" },
      },
      async (args) => {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                requiresAuth: true,
                provider: "pandadoc",
                message: "Please authenticate with PandaDoc to use this tool",
                authUrl: "/auth/pandadoc",
                note: "This tool will create and send a document once authenticated"
              }, null, 2),
            },
          ],
        };
      }
    );
    console.log("📄 PandaDoc sendDocument tool enabled");
  }

  // Get Status tool
  if (isOperationEnabled(config, "pandadoc", "getStatus")) {
    server.tool(
      "pandadoc-get-status",
      "Get the status of a PandaDoc document",
      {
        documentId: { type: "string", description: "Document ID to check" },
      },
      async (args) => {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                requiresAuth: true,
                provider: "pandadoc",
                message: "Please authenticate with PandaDoc to use this tool",
                authUrl: "/auth/pandadoc",
                note: "This tool will check document status once authenticated"
              }, null, 2),
            },
          ],
        };
      }
    );
    console.log("📄 PandaDoc getStatus tool enabled");
  }
}

// Tool implementations will be added here:
// export { sendDocument } from "./sendDocument";
// export { getStatus } from "./getStatus"; 
// export { listTemplates } from "./listTemplates"; 