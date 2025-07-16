/**
 * HubSpot Update Contact Tool
 */

import { z } from "zod";
import { HubSpotClient } from "./client";
import type { ToolResponse } from "../../types";

export const updateContactSchema = z.object({
  contactId: z.string().min(1).describe("HubSpot contact ID"),
  email: z.string().email().optional().describe("New email address"),
  firstName: z.string().min(1).optional().describe("New first name"),
  lastName: z.string().optional().describe("New last name"),
  phone: z.string().optional().describe("New phone number"),
  company: z.string().optional().describe("New company name"),
  jobTitle: z.string().optional().describe("New job title"),
});

export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const updateContactTool = async ({ args, accessToken }: { args: UpdateContactInput; accessToken: string }): Promise<ToolResponse> => {
    const { contactId, email, firstName, lastName, phone, company, jobTitle } = args;
    
    const client = new HubSpotClient(accessToken);
    
    // Check if contact exists
    try {
      await client.getContact(contactId);
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
    
    // Build update object with only provided fields
    const updates: any = {
      properties: {},
    };
    
    if (email !== undefined) updates.properties.email = email;
    if (firstName !== undefined) updates.properties.firstname = firstName;
    if (lastName !== undefined) updates.properties.lastname = lastName;
    if (phone !== undefined) updates.properties.phone = phone;
    if (company !== undefined) updates.properties.company = company;
    if (jobTitle !== undefined) updates.properties.jobtitle = jobTitle;
    
    // Check if any updates were provided
    if (Object.keys(updates.properties).length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `❌ No fields provided to update. Please specify at least one field to update.`,
          },
        ],
      };
    }
    
    // Update contact
    const updatedContact = await client.updateContact(contactId, updates);
    
    // List the fields that were updated
    const updatedFields = Object.keys(updates.properties).map((key) => {
      const fieldName = key === "firstname" ? "First Name" : 
                       key === "lastname" ? "Last Name" :
                       key === "jobtitle" ? "Job Title" :
                       key.charAt(0).toUpperCase() + key.slice(1);
      return `• ${fieldName}: ${updates.properties[key]}`;
    }).join("\n");
    
    return {
      content: [
        {
          type: "text",
          text: `✅ Successfully updated contact ${contactId}:

${updatedFields}

Current Contact Details:
ID: ${updatedContact.id}
Email: ${updatedContact.properties.email || "N/A"}
Name: ${updatedContact.properties.firstname || ""} ${updatedContact.properties.lastname || ""}
Company: ${updatedContact.properties.company || "N/A"}
Job Title: ${updatedContact.properties.jobtitle || "N/A"}
Phone: ${updatedContact.properties.phone || "N/A"}

Last Modified: ${new Date(updatedContact.properties.lastmodifieddate || "").toLocaleString()}`,
        },
      ],
    };
};