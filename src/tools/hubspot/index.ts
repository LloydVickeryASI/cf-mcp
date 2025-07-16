/**
 * HubSpot MCP Tools
 * 
 * CRM and marketing automation
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPConfig } from "../../config/mcp.defaults";
import { isOperationEnabled } from "../../config/loader";
import { withOAuth } from "../../auth/withOAuth";
import { HubSpotClient } from "./client";

// Import tool implementations
import { searchContactsTool, searchContactsSchema } from "./search-contacts";
import { createContactTool, createContactSchema } from "./create-contact";
import { getContactTool, getContactSchema } from "./get-contact";
import { updateContactTool, updateContactSchema } from "./update-contact";

/**
 * Register all HubSpot tools with the MCP server
 */
export function registerTools(server: McpServer, config: MCPConfig, agentContext: any) {
  const toolConfig = config.tools.hubspot;
  
  if (!toolConfig.enabled) {
    return;
  }

  // Register individual HubSpot tools based on configuration
  if (isOperationEnabled(config, "hubspot", "searchContacts")) {
    server.registerTool(
      "hubspot-search-contacts",
      {
        title: "Search HubSpot Contacts",
        description: "Search for contacts in HubSpot CRM by email, name, or company",
        inputSchema: searchContactsSchema.shape,
      },
      withOAuth("hubspot", async ({ args, accessToken }) => {
        const { query, limit = 10 } = args as { query: string; limit?: number };
        
        const client = new HubSpotClient(accessToken);
        const results = await client.searchContacts(query, limit);
        
        const contacts = results.results.map((contact) => ({
          id: contact.id,
          email: contact.properties.email,
          firstName: contact.properties.firstname,
          lastName: contact.properties.lastname,
          phone: contact.properties.phone,
          company: contact.properties.company,
          jobTitle: contact.properties.jobtitle,
          createdAt: contact.properties.createdate,
          updatedAt: contact.properties.lastmodifieddate,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${contacts.length} contacts matching "${query}":

${contacts
  .map(
    (contact) =>
      `• ${contact.firstName} ${contact.lastName} (${contact.email})
  Company: ${contact.company || "N/A"}
  Job Title: ${contact.jobTitle || "N/A"}
  Phone: ${contact.phone || "N/A"}
  ID: ${contact.id}`
  )
  .join("\n\n")}

${results.paging?.next ? `\n⚠️  More results available. Use pagination to get additional contacts.` : ""}`
            },
          ],
        };
      }, agentContext)
    );
    console.log("🏢 HubSpot searchContacts tool registered");
  }

  if (isOperationEnabled(config, "hubspot", "createContact")) {
    server.registerTool(
      "hubspot-create-contact",
      {
        title: "Create HubSpot Contact",
        description: "Create a new contact in HubSpot CRM",
        inputSchema: createContactSchema.shape,
      },
      withOAuth("hubspot", async ({ args, accessToken }) => {
        return await createContactTool({ args, accessToken });
      }, agentContext)
    );
    console.log("🏢 HubSpot createContact tool registered");
  }

  if (isOperationEnabled(config, "hubspot", "getContact")) {
    server.registerTool(
      "hubspot-get-contact",
      {
        title: "Get HubSpot Contact",
        description: "Retrieve a specific contact from HubSpot CRM by ID",
        inputSchema: getContactSchema.shape,
      },
      withOAuth("hubspot", async ({ args, accessToken }) => {
        return await getContactTool({ args, accessToken });
      }, agentContext)
    );
    console.log("🏢 HubSpot getContact tool registered");
  }

  if (isOperationEnabled(config, "hubspot", "updateContact")) {
    server.registerTool(
      "hubspot-update-contact",
      {
        title: "Update HubSpot Contact",
        description: "Update an existing contact in HubSpot CRM",
        inputSchema: updateContactSchema.shape,
      },
      withOAuth("hubspot", async ({ args, accessToken }) => {
        return await updateContactTool({ args, accessToken });
      }, agentContext)
    );
    console.log("🏢 HubSpot updateContact tool registered");
  }
}

// Export tool implementations
export { searchContactsTool } from "./search-contacts";
export { createContactTool } from "./create-contact";
export { getContactTool } from "./get-contact";
export { updateContactTool } from "./update-contact"; 