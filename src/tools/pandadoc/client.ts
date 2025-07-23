/**
 * PandaDoc API Client
 * 
 * Low-level REST wrapper for PandaDoc API operations
 * Handles authentication headers and error responses
 */

import { BaseProviderClient, type RequestOptions } from "@/tools/base-client";
import { ToolError } from "@/types";

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
  fields?: Record<string, string | number | boolean>;
}

export interface SendDocumentRequest {
  message?: string;
  subject?: string;
  silent?: boolean;
}

export class PandaDocClient extends BaseProviderClient {
  constructor(accessToken: string) {
    super(accessToken, {
      baseUrl: "https://api.pandadoc.com/public/v1",
      provider: "pandadoc",
      defaultHeaders: {
        "Accept": "application/json",
      },
    });
  }

  /**
   * List all templates available to the user
   */
  async listTemplates(): Promise<PandaDocTemplate[]> {
    const response = await this.get<{ results: PandaDocTemplate[] }>("/templates");
    return response.results || [];
  }

  /**
   * Create a new document from a template
   */
  async createDocument(request: CreateDocumentRequest): Promise<PandaDocDocument> {
    return await this.post<PandaDocDocument>("/documents", request);
  }

  /**
   * Get document details by ID
   */
  async getDocument(documentId: string): Promise<PandaDocDocument> {
    return await this.get<PandaDocDocument>(`/documents/${documentId}`);
  }

  /**
   * Send a document for signature
   */
  async sendDocument(documentId: string, request: SendDocumentRequest = {}): Promise<{ status: string }> {
    try {
      const response = await this.post<{ status: string }>(`/documents/${documentId}/send`, request);
      return response || { status: "success" };
    } catch (error) {
      // Handle 204 No Content as success
      if (error instanceof ToolError && error.statusCode === 204) {
        return { status: "success" };
      }
      throw error;
    }
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
    const response = await this.get<{ results: PandaDocDocument[] }>("/documents", {
      params: {
        status: params.status,
        count: params.count,
        page: params.page,
      },
    });
    return response.results || [];
  }

  /**
   * Override handleErrorResponse to handle PandaDoc-specific error formats
   */
  protected async handleErrorResponse(response: Response): Promise<never> {
    const contentType = response.headers.get("content-type");
    let errorData: ErrorResponse = {};
    
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

    // PandaDoc-specific error handling
    const message = errorData.detail || errorData.message || errorData.error || `PandaDoc API error: ${response.status}`;
    const code = errorData.type || this.extractErrorCode(errorData, response);
    
    throw new ToolError(
      message,
      code,
      response.status,
      "pandadoc"
    );
  }

  /**
   * Override request to handle 204 No Content responses
   */
  protected async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(endpoint, options.params);
    const timeout = options.timeout || 30000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...this.config.defaultHeaders,
          "Authorization": `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      // Handle 204 No Content
      if (response.status === 204) {
        return {} as T;
      }

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      return await response.json() as T;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

} 