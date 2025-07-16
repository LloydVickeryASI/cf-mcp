/**
 * HubSpot Search Contacts Tool
 */

import { z } from "zod";
import { HubSpotClient } from "./client";
import type { ToolResponse } from "../../types";

export const searchContactsSchema = z.object({
  query: z.string().min(1).describe("Search query (email, name, or company)"),
  limit: z.number().int().min(1).max(100).default(10).describe("Maximum number of results to return"),
});

export type SearchContactsInput = z.infer<typeof searchContactsSchema>;

export const searchContactsTool = async ({ args, accessToken }: { args: SearchContactsInput; accessToken: string }): Promise<ToolResponse> => {
    const { query, limit } = args;
    
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
          type: "text",
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
};