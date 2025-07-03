/**
 * Sentry configuration and utilities for MCP server monitoring
 */
import * as Sentry from "@sentry/cloudflare";

/**
 * Get Sentry configuration from environment
 */
export function getSentryConfig(env: Env): Sentry.CloudflareOptions | null {
  if (!env.SENTRY_DSN) {
    return null;
  }

  const sampleRate = env.SENTRY_SAMPLE_RATE 
    ? parseFloat(env.SENTRY_SAMPLE_RATE) 
    : 1.0;

  return {
    dsn: env.SENTRY_DSN,
    tracesSampleRate: sampleRate,
    environment: env.BASE_URL?.includes('localhost') ? 'development' : 'production',
    beforeSend(event: Sentry.ErrorEvent) {
      // Filter out sensitive data from error reports
      if (event.request?.headers) {
        delete event.request.headers.Authorization;
        delete event.request.headers.Cookie;
      }
      
      // Remove secrets from environment context
      if (event.contexts?.runtime?.env) {
        const env = event.contexts.runtime.env as any;
        Object.keys(env).forEach(key => {
          if (key.includes('SECRET') || key.includes('KEY')) {
            delete env[key];
          }
        });
      }
      
      return event;
    },
    integrations: [
      // Add any additional integrations here
    ]
  };
}

/**
 * Helper function to handle errors with Sentry
 */
export function handleError(error: unknown, context?: Record<string, any>): string {
  console.error("Error occurred:", error);
  
  // Set additional context if provided
  if (context) {
    Sentry.setContext("errorContext", context);
  }
  
  const eventId = Sentry.captureException(error);
  
  return [
    "**Error**",
    "There was a problem with your request.",
    `**Event ID**: ${eventId}`,
    "This error has been logged for investigation."
  ].join("\n\n");
}

/**
 * Helper function to add user context to Sentry
 */
export function setSentryUser(user: { id: string; email: string; login: string; name: string }) {
  Sentry.setUser({
    id: user.id,
    username: user.login,
    email: user.email,
    displayName: user.name
  });
}

/**
 * Helper function to extract MCP parameters for tracing
 */
export function extractMcpParameters(args: any): Record<string, any> {
  const params: Record<string, any> = {};
  
  if (args && typeof args === 'object') {
    // Extract non-sensitive parameters for tracing
    Object.keys(args).forEach(key => {
      const value = args[key];
      if (typeof value === 'string' && value.length < 100) {
        // Only include short strings to avoid sensitive data
        params[key] = value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        params[key] = value;
      }
    });
  }
  
  return params;
}

/**
 * Wrapper function to add Sentry tracing to MCP tool execution
 */
export function withSentryTracing<T extends any[], R>(
  toolName: string,
  handler: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    return await Sentry.startNewTrace(async () => {
      return await Sentry.startSpan(
        {
          name: `mcp.tool/${toolName}`,
          attributes: {
            "tool.name": toolName,
            "tool.provider": toolName.split('-')[0],
            ...extractMcpParameters(args[0])
          }
        },
        async (span) => {
          try {
            const result = await handler(...args);
            span.setStatus({ code: 1 }); // OK
            return result;
          } catch (error) {
            span.setStatus({ code: 2 }); // ERROR
            throw error;
          }
        }
      );
    });
  };
}

/**
 * MCP-specific wrapper function to add Sentry tracing to MCP tool execution
 */
export function withMcpSentryTracing(
  toolName: string,
  handler: (args: any) => Promise<any>
): (args: any) => Promise<any> {
  return async (args: any): Promise<any> => {
    return await Sentry.startNewTrace(async () => {
      return await Sentry.startSpan(
        {
          name: `mcp.tool/${toolName}`,
          attributes: {
            "tool.name": toolName,
            "tool.provider": toolName.split('-')[0],
            ...extractMcpParameters(args)
          }
        },
        async (span) => {
          try {
            const result = await handler(args);
            span.setStatus({ code: 1 }); // OK
            return result;
          } catch (error) {
            span.setStatus({ code: 2 }); // ERROR
            throw error;
          }
        }
      );
    });
  };
}

/**
 * Helper function to register a tool with Sentry tracing
 */
export function registerToolWithTracing(
  server: any,
  toolName: string,
  description: string,
  schema: any,
  handler: (args: any) => Promise<any>
) {
  const tracedHandler = withMcpSentryTracing(toolName, handler);
  server.tool(toolName, description, schema, tracedHandler);
}