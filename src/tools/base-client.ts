/**
 * Base API client for all tool providers
 * Provides consistent error handling, request/response patterns, and token management
 */

import { ToolError } from "@/types";

export interface BaseClientConfig {
  /**
   * Base URL for the provider's API
   */
  baseUrl: string;
  
  /**
   * Provider name for error messages and logging
   */
  provider: string;
  
  /**
   * Default headers to include in all requests
   */
  defaultHeaders?: Record<string, string>;
  
  /**
   * Request timeout in milliseconds
   */
  timeout?: number;
}

export interface RequestOptions extends RequestInit {
  /**
   * Query parameters to append to the URL
   */
  params?: Record<string, string | number | boolean>;
  
  /**
   * Request timeout override
   */
  timeout?: number;
}

export interface ErrorResponse {
  message?: string;
  error?: string;
  code?: string;
  status?: number;
  [key: string]: unknown;
}

/**
 * Base client class for all provider API integrations
 */
export abstract class BaseProviderClient {
  protected readonly accessToken: string;
  protected readonly config: BaseClientConfig;

  constructor(accessToken: string, config: BaseClientConfig) {
    this.accessToken = accessToken;
    this.config = config;
  }

  /**
   * Make an authenticated API request
   */
  protected async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = this.buildUrl(endpoint, options.params);
    const timeout = options.timeout || this.config.timeout || 30000;

    // Create abort controller for timeout
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

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      return await response.json() as T;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof ToolError) {
        throw error;
      }
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new ToolError(
            `Request to ${this.config.provider} timed out after ${timeout}ms`,
            "TIMEOUT",
            408,
            this.config.provider
          );
        }
        
        throw new ToolError(
          `${this.config.provider} API error: ${error.message}`,
          "NETWORK_ERROR",
          500,
          this.config.provider
        );
      }
      
      throw new ToolError(
        `Unknown error calling ${this.config.provider} API`,
        "UNKNOWN_ERROR",
        500,
        this.config.provider
      );
    }
  }

  /**
   * Build the full URL with query parameters
   */
  protected buildUrl(endpoint: string, params?: Record<string, string | number | boolean>): string {
    const url = new URL(endpoint, this.config.baseUrl);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }
    
    return url.toString();
  }

  /**
   * Handle error responses from the API
   */
  protected async handleErrorResponse(response: Response): Promise<never> {
    const contentType = response.headers.get("content-type");
    let errorData: ErrorResponse = {};
    
    try {
      if (contentType?.includes("application/json")) {
        errorData = await response.json() as ErrorResponse;
      } else {
        const text = await response.text();
        errorData = { message: text || response.statusText };
      }
    } catch {
      errorData = { message: response.statusText };
    }

    const message = this.extractErrorMessage(errorData, response);
    const code = this.extractErrorCode(errorData, response);
    
    throw new ToolError(
      message,
      code,
      response.status,
      this.config.provider
    );
  }

  /**
   * Extract error message from response data
   * Can be overridden by subclasses for provider-specific error formats
   */
  protected extractErrorMessage(data: ErrorResponse, response: Response): string {
    return data.message 
      || data.error 
      || `${this.config.provider} API error: ${response.status} ${response.statusText}`;
  }

  /**
   * Extract error code from response data
   * Can be overridden by subclasses for provider-specific error formats
   */
  protected extractErrorCode(data: ErrorResponse, response: Response): string {
    if (data.code) return String(data.code);
    
    // Map HTTP status codes to error codes
    switch (response.status) {
      case 400: return "BAD_REQUEST";
      case 401: return "UNAUTHORIZED";
      case 403: return "FORBIDDEN";
      case 404: return "NOT_FOUND";
      case 429: return "RATE_LIMITED";
      case 500: return "INTERNAL_ERROR";
      case 502: return "BAD_GATEWAY";
      case 503: return "SERVICE_UNAVAILABLE";
      default: return "HTTP_ERROR";
    }
  }

  /**
   * Helper method for GET requests
   */
  protected get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "GET" });
  }

  /**
   * Helper method for POST requests
   */
  protected post<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Helper method for PUT requests
   */
  protected put<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Helper method for DELETE requests
   */
  protected delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "DELETE" });
  }

  /**
   * Helper method for PATCH requests
   */
  protected patch<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}