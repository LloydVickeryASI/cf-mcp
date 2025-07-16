/**
 * HubSpot Create Contact Tool
 */

import { z } from "zod";
import { HubSpotClient } from "./client";
import type { ToolResponse } from "../../types";

export const createContactSchema = z.object({
  email: z.string().email().describe("Contact's email address (required)"),
  firstName: z.string().min(1).describe("Contact's first name"),
  lastName: z.string().optional().describe("Contact's last name"),
  phone: z.string().optional().describe("Contact's phone number"),
  company: z.string().optional().describe("Contact's company name"),
  jobTitle: z.string().optional().describe("Contact's job title"),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

export const createContactTool = async ({ args, accessToken }: { args: CreateContactInput; accessToken: string }): Promise<ToolResponse> => {
    const { email, firstName, lastName, phone, company, jobTitle } = args;
    
    const client = new HubSpotClient(accessToken);
    
    // Check if contact already exists
    const existingContact = await client.getContactByEmail(email);
    if (existingContact) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Contact with email ${email} already exists:

ID: ${existingContact.id}
Name: ${existingContact.properties.firstname} ${existingContact.properties.lastname}
Company: ${existingContact.properties.company || "N/A"}
Job Title: ${existingContact.properties.jobtitle || "N/A"}

Use the update-contact tool to modify existing contacts.`,
          },
        ],
      };
    }
    
    // Create new contact
    const contactData = {
      properties: {
        email,
        firstname: firstName,
        ...(lastName && { lastname: lastName }),
        ...(phone && { phone }),
        ...(company && { company }),
        ...(jobTitle && { jobtitle: jobTitle }),
      },
    };
    
    const newContact = await client.createContact(contactData);
    
    return {
      content: [
        {
          type: "text",
          text: `✅ Successfully created contact:

ID: ${newContact.id}
Email: ${newContact.properties.email}
Name: ${newContact.properties.firstname} ${newContact.properties.lastname || ""}
Company: ${newContact.properties.company || "N/A"}
Job Title: ${newContact.properties.jobtitle || "N/A"}
Phone: ${newContact.properties.phone || "N/A"}

Created: ${new Date(newContact.properties.createdate || "").toLocaleString()}`,
        },
      ],
    };
};