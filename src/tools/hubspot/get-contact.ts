/**
 * HubSpot Get Contact Tool
 */

import { z } from "zod";
import { HubSpotClient } from "./client";
import type { ToolResponse } from "../../types";

export const getContactSchema = z.object({
  contactId: z.string().min(1).describe("HubSpot contact ID"),
});

export type GetContactInput = z.infer<typeof getContactSchema>;

export const getContactTool = async ({ args, accessToken }: { args: GetContactInput; accessToken: string }): Promise<ToolResponse> => {
    const { contactId } = args;
    
    const client = new HubSpotClient(accessToken);
    
    try {
      const contact = await client.getContact(contactId);
      
      return {
        content: [
          {
            type: "text",
            text: `📇 Contact Details:

ID: ${contact.id}
Email: ${contact.properties.email || "N/A"}
Name: ${contact.properties.firstname || ""} ${contact.properties.lastname || ""}
Company: ${contact.properties.company || "N/A"}
Job Title: ${contact.properties.jobtitle || "N/A"}
Phone: ${contact.properties.phone || "N/A"}

Created: ${contact.properties.createdate ? new Date(contact.properties.createdate).toLocaleString() : "N/A"}
Last Modified: ${contact.properties.lastmodifieddate ? new Date(contact.properties.lastmodifieddate).toLocaleString() : "N/A"}`,
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Contact with ID ${contactId} not found.`,
            },
          ],
        };
      }
      throw error;
    }
};