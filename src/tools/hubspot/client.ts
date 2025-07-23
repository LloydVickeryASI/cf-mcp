/**
 * HubSpot API Client
 * 
 * Low-level REST API wrapper with OAuth authentication
 */

import { BaseProviderClient, type RequestOptions } from "@/tools/base-client";
import { ToolError } from "@/types";

export interface HubSpotContact {
  id: string;
  properties: {
    email?: string;
    firstname?: string;
    lastname?: string;
    phone?: string;
    company?: string;
    jobtitle?: string;
    createdate?: string;
    lastmodifieddate?: string;
    [key: string]: string | number | boolean | undefined;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface HubSpotContactSearchResponse {
  results: HubSpotContact[];
  total: number;
  paging?: {
    next?: {
      after: string;
    };
  };
}

export interface HubSpotContactCreateRequest {
  properties: {
    email: string;
    firstname?: string;
    lastname?: string;
    phone?: string;
    company?: string;
    jobtitle?: string;
    [key: string]: string | number | boolean | undefined;
  };
}

export interface HubSpotError {
  status: string;
  message: string;
  correlationId?: string;
  category?: string;
  errors?: Array<{
    message: string;
    in: string;
    code: string;
  }>;
}

export class HubSpotClient extends BaseProviderClient {
  constructor(accessToken: string) {
    super(accessToken, {
      baseUrl: "https://api.hubapi.com",
      provider: "hubspot",
      defaultHeaders: {
        "Accept": "application/json",
      },
    });
  }

  /**
   * Override handleErrorResponse to handle HubSpot-specific error formats
   */
  protected async handleErrorResponse(response: Response): Promise<never> {
    const contentType = response.headers.get("content-type");
    let errorData: HubSpotError = {} as HubSpotError;
    
    try {
      if (contentType?.includes("application/json")) {
        errorData = await response.json();
      } else {
        const text = await response.text();
        errorData = { message: text || response.statusText };
      }
    } catch {
      errorData = { message: response.statusText };
    }

    // HubSpot-specific error handling
    let message = errorData.message || "HubSpot API error";
    if (errorData.errors && errorData.errors.length > 0) {
      message = errorData.errors.map((e: { message: string }) => e.message).join(", ");
    }
    
    const code = errorData.category || this.extractErrorCode(errorData, response);
    
    throw new ToolError(
      `HubSpot API error: ${message}`,
      code,
      response.status,
      "hubspot"
    );
  }

  /**
   * Search for contacts by email or name
   */
  async searchContacts(
    query: string,
    limit: number = 10
  ): Promise<HubSpotContactSearchResponse> {
    const searchBody = {
      query,
      limit,
      properties: [
        "email",
        "firstname",
        "lastname",
        "phone",
        "company",
        "jobtitle",
        "createdate",
        "lastmodifieddate",
      ],
    };

    return this.post<HubSpotContactSearchResponse>(
      "/crm/v3/objects/contacts/search",
      searchBody
    );
  }

  /**
   * Get a contact by ID
   */
  async getContact(contactId: string): Promise<HubSpotContact> {
    const properties = [
      "email",
      "firstname",
      "lastname",
      "phone",
      "company",
      "jobtitle",
      "createdate",
      "lastmodifieddate",
    ];

    return this.get<HubSpotContact>(
      `/crm/v3/objects/contacts/${contactId}`,
      {
        params: {
          properties: properties.join(","),
        },
      }
    );
  }

  /**
   * Create a new contact
   */
  async createContact(
    contactData: HubSpotContactCreateRequest
  ): Promise<HubSpotContact> {
    return this.post<HubSpotContact>("/crm/v3/objects/contacts", contactData);
  }

  /**
   * Update an existing contact
   */
  async updateContact(
    contactId: string,
    updates: Partial<HubSpotContactCreateRequest>
  ): Promise<HubSpotContact> {
    return this.patch<HubSpotContact>(`/crm/v3/objects/contacts/${contactId}`, updates);
  }

  /**
   * Delete a contact
   */
  async deleteContact(contactId: string): Promise<void> {
    await this.delete<void>(`/crm/v3/objects/contacts/${contactId}`);
  }

  /**
   * Get contact by email address
   */
  async getContactByEmail(email: string): Promise<HubSpotContact | null> {
    try {
      const searchResults = await this.searchContacts(email, 1);
      
      // Find exact email match
      const exactMatch = searchResults.results.find(
        (contact) => contact.properties.email?.toLowerCase() === email.toLowerCase()
      );
      
      return exactMatch || null;
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get all contacts (paginated)
   */
  async getAllContacts(
    limit: number = 100,
    after?: string
  ): Promise<HubSpotContactSearchResponse> {
    const properties = [
      "email",
      "firstname",
      "lastname",
      "phone",
      "company",
      "jobtitle",
      "createdate",
      "lastmodifieddate",
    ];

    const params: Record<string, string | number | boolean> = {
      limit,
      properties: properties.join(","),
    };
    
    if (after) {
      params.after = after;
    }
    
    return this.get<HubSpotContactSearchResponse>(
      `/crm/v3/objects/contacts`,
      { params }
    );
  }
}