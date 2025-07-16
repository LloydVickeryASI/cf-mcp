/**
 * CORS configuration for different endpoint types
 */
export interface CorsConfig {
  origin?: string;
  methods: string[];
  headers?: string[];
  maxAge?: number;
}

/**
 * Default CORS configurations for common endpoint types
 */
export const CORS_CONFIGS: Record<string, CorsConfig> = {
  mcp: {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    headers: ["Content-Type", "mcp-session-id", "mcp-protocol-version", "Authorization"],
    maxAge: 86400
  },
  oauth: {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    headers: ["Content-Type"],
    maxAge: 86400
  },
  metadata: {
    origin: "*",
    methods: ["GET", "OPTIONS"],
    headers: ["Content-Type"],
    maxAge: 86400
  },
  register: {
    origin: "*",
    methods: ["POST", "OPTIONS"],
    headers: ["Content-Type"],
    maxAge: 86400
  }
};

/**
 * Handle CORS preflight requests
 * @param config CORS configuration to apply
 * @returns Response with appropriate CORS headers
 */
export function handleCorsPreflightRequest(config: CorsConfig): Response {
  return new Response(null, {
    status: 204, // No Content is more appropriate for preflight
    headers: {
      "Access-Control-Allow-Origin": config.origin || "*",
      "Access-Control-Allow-Methods": config.methods.join(", "),
      ...(config.headers && {
        "Access-Control-Allow-Headers": config.headers.join(", ")
      }),
      ...(config.maxAge && {
        "Access-Control-Max-Age": config.maxAge.toString()
      })
    }
  });
}

/**
 * Add CORS headers to an existing response
 * @param response Original response
 * @param config CORS configuration to apply
 * @returns Response with CORS headers added
 */
export function addCorsHeaders(response: Response, config: Partial<CorsConfig>): Response {
  const headers = new Headers(response.headers);
  
  if (config.origin) {
    headers.set("Access-Control-Allow-Origin", config.origin);
  }
  
  if (config.methods) {
    headers.set("Access-Control-Allow-Methods", config.methods.join(", "));
  }
  
  if (config.headers) {
    headers.set("Access-Control-Allow-Headers", config.headers.join(", "));
  }
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}