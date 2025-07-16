/**
 * HubSpot API Client
 * 
 * Low-level REST API wrapper with OAuth authentication
 */

import { wrapOAuth } from "../../observability/tool-span";
import { fetchWithRetry, PROVIDER_RETRY_CONFIGS } from "../../middleware/retry";

const HUBSPOT_API_BASE = "https://api.hubapi.com";

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
    [key: string]: any;
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
    [key: string]: any;
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

export class HubSpotClient {
  private accessToken: string;
  private baseUrl: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
    this.baseUrl = HUBSPOT_API_BASE;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const response = await fetchWithRetry(url, {
      ...options,
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    }, PROVIDER_RETRY_CONFIGS.hubspot);

    if (!response.ok) {
      const errorText = await response.text();
      let error: HubSpotError;
      
      try {
        error = JSON.parse(errorText);
      } catch {
        error = {
          status: "error",
          message: `HTTP ${response.status}: ${errorText}`,
        };
      }

      throw new Error(
        `HubSpot API error: ${error.message} (${response.status})`
      );
    }

    return response.json() as T;
  }

  /**
   * Search for contacts by email or name
   */
  async searchContacts(
    query: string,
    limit: number = 10
  ): Promise<HubSpotContactSearchResponse> {
    return wrapOAuth("hubspot", "search_contacts", async () => {
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

      return this.request<HubSpotContactSearchResponse>(
        "/crm/v3/objects/contacts/search",
        {
          method: "POST",
          body: JSON.stringify(searchBody),
        }
      );
    });
  }

  /**
   * Get a contact by ID
   */
  async getContact(contactId: string): Promise<HubSpotContact> {
    return wrapOAuth("hubspot", "get_contact", async () => {
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

      return this.request<HubSpotContact>(
        `/crm/v3/objects/contacts/${contactId}?properties=${properties.join(",")}`
      );
    });
  }

  /**
   * Create a new contact
   */
  async createContact(
    contactData: HubSpotContactCreateRequest
  ): Promise<HubSpotContact> {
    return wrapOAuth("hubspot", "create_contact", async () => {
      return this.request<HubSpotContact>("/crm/v3/objects/contacts", {
        method: "POST",
        body: JSON.stringify(contactData),
      });
    });
  }

  /**
   * Update an existing contact
   */
  async updateContact(
    contactId: string,
    updates: Partial<HubSpotContactCreateRequest>
  ): Promise<HubSpotContact> {
    return wrapOAuth("hubspot", "update_contact", async () => {
      return this.request<HubSpotContact>(`/crm/v3/objects/contacts/${contactId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    });
  }

  /**
   * Delete a contact
   */
  async deleteContact(contactId: string): Promise<void> {
    return wrapOAuth("hubspot", "delete_contact", async () => {
      await this.request<void>(`/crm/v3/objects/contacts/${contactId}`, {
        method: "DELETE",
      });
    });
  }

  /**
   * Get contact by email address
   */
  async getContactByEmail(email: string): Promise<HubSpotContact | null> {
    return wrapOAuth("hubspot", "get_contact_by_email", async () => {
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
    });
  }

  /**
   * Get all contacts (paginated)
   */
  async getAllContacts(
    limit: number = 100,
    after?: string
  ): Promise<HubSpotContactSearchResponse> {
    return wrapOAuth("hubspot", "get_all_contacts", async () => {
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

      let url = `/crm/v3/objects/contacts?limit=${limit}&properties=${properties.join(",")}`;
      if (after) {
        url += `&after=${after}`;
      }

      return this.request<HubSpotContactSearchResponse>(url);
    });
  }
}