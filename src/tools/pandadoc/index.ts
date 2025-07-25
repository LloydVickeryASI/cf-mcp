/**
 * PandaDoc MCP Tools
 * 
 * Document creation, e-signature, and template management
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPConfig } from "../../config/mcp.defaults";
import type { AgentContext } from "../index";
import { isOperationEnabled } from "../../config/loader";
import { PandaDocClient } from "./client";
import { registerToolWithTracing } from "../../sentry";
import { withOAuth } from "../../auth/withOAuth";

// Register PandaDoc tools if enabled
export function registerTools(server: McpServer, config: MCPConfig, agentContext: AgentContext) {
  const toolConfig = config.tools.pandadoc;
  
  if (!toolConfig?.enabled) {
    console.log("PandaDoc tools disabled");
    return;
  }

  console.log("Registering PandaDoc tools");

  // List Documents tool - Live API integration
  if (isOperationEnabled(config, "pandadoc", "listDocuments")) {
    registerToolWithTracing(
      server,
      "pandadoc-list-documents",
      "List all PandaDoc documents",
      {
        status: { 
          type: "string", 
          description: "Filter by document status (optional)",
          enum: ["document.draft", "document.sent", "document.viewed", "document.completed", "document.declined"]
        },
        count: { 
          type: "number", 
          description: "Number of documents to return (default: 20, max: 100)"
        },
        page: {
          type: "number",
          description: "Page number for pagination (default: 1)"
        }
      },
      withOAuth("pandadoc", async ({ args, accessToken }) => {
        const client = new PandaDocClient(accessToken);
        
        const params: {
          status?: string;
          count?: number;
          page?: number;
        } = {};
        
        if (args.status) params.status = args.status as string;
        if (args.count) params.count = args.count as number;
        if (args.page) params.page = args.page as number;
        
        const documents = await client.listDocuments(params);
        
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                documents: documents,
                count: documents.length,
                filters: params,
                timestamp: new Date().toISOString()
              }, null, 2),
            },
          ],
        };
      }, { ...agentContext, config })
    );
    console.log("📄 PandaDoc listDocuments tool enabled (Live API)");
  }

  // Keep the other tools as stubs for now
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
    console.log("📄 PandaDoc listTemplates tool enabled (stub)");
  }

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
    console.log("📄 PandaDoc sendDocument tool enabled (stub)");
  }

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
    console.log("📄 PandaDoc getStatus tool enabled (stub)");
  }
}

// Tool implementations will be added here:
// export { sendDocument } from "./sendDocument";
// export { getStatus } from "./getStatus"; 
// export { listTemplates } from "./listTemplates"; 