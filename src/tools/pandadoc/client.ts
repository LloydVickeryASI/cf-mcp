/**
 * PandaDoc API Client
 * 
 * Low-level REST wrapper for PandaDoc API operations
 * Handles authentication headers and error responses
 */

export interface PandaDocTemplate {
  id: string;
  name: string;
  date_created: string;
  date_modified: string;
  created_by: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  };
}

export interface PandaDocDocument {
  id: string;
  name: string;
  status: "document.draft" | "document.sent" | "document.viewed" | "document.completed" | "document.declined";
  date_created: string;
  date_modified: string;
  expiration_date?: string;
  recipients: Array<{
    email: string;
    first_name: string;
    last_name: string;
    role: string;
    signing_order?: number;
  }>;
  grand_total?: {
    amount: string;
    currency: string;
  };
}

export interface CreateDocumentRequest {
  name: string;
  template_uuid: string;
  recipients: Array<{
    email: string;
    first_name: string;
    last_name: string;
    role: string;
  }>;
  tokens?: Array<{
    name: string;
    value: string;
  }>;
  fields?: Record<string, any>;
}

export interface SendDocumentRequest {
  message?: string;
  subject?: string;
  silent?: boolean;
}

export class PandaDocClient {
  private baseUrl = "https://api.pandadoc.com/public/v1";

  constructor(private accessToken: string) {}

  /**
   * List all templates available to the user
   */
  async listTemplates(): Promise<PandaDocTemplate[]> {
    const response = await this.request("GET", "/templates");
    return response.results || [];
  }

  /**
   * Create a new document from a template
   */
  async createDocument(request: CreateDocumentRequest): Promise<PandaDocDocument> {
    return await this.request("POST", "/documents", request);
  }

  /**
   * Get document details by ID
   */
  async getDocument(documentId: string): Promise<PandaDocDocument> {
    return await this.request("GET", `/documents/${documentId}`);
  }

  /**
   * Send a document for signature
   */
  async sendDocument(documentId: string, request: SendDocumentRequest = {}): Promise<{ status: string }> {
    return await this.request("POST", `/documents/${documentId}/send`, request);
  }

  /**
   * Get document status
   */
  async getDocumentStatus(documentId: string): Promise<{ status: string; expiration_date?: string }> {
    const doc = await this.getDocument(documentId);
    return {
      status: doc.status,
      expiration_date: doc.expiration_date
    };
  }

  /**
   * List user's documents with optional filtering
   */
  async listDocuments(params: {
    status?: string;
    count?: number;
    page?: number;
  } = {}): Promise<PandaDocDocument[]> {
    const query = new URLSearchParams();
    
    if (params.status) query.set("status", params.status);
    if (params.count) query.set("count", params.count.toString());
    if (params.page) query.set("page", params.page.toString());

    const endpoint = `/documents${query.toString() ? `?${query.toString()}` : ""}`;
    const response = await this.request("GET", endpoint);
    return response.results || [];
  }

  /**
   * Generic request method with error handling
   */
  private async request(method: string, endpoint: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PandaDoc API error: ${response.status} ${errorText}`);
    }

    // Handle 204 No Content responses
    if (response.status === 204) {
      return { status: "success" };
    }

    return await response.json();
  }
} 