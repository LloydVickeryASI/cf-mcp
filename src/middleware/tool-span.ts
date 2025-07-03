/**
 * Tool Span Helper for Sentry Tracing
 * 
 * Wraps each MCP tool handler to create a child span for better observability
 * Every tool invocation appears as a `mcp.tool/<name>` span in Sentry traces
 */

import * as Sentry from "@sentry/cloudflare";
import type { ToolContext, ToolResponse } from "../types";

/**
 * Wrap a tool handler with Sentry tracing
 * 
 * Creates a new trace with a span named `mcp.tool/<toolName>` for each tool call.
 * This provides detailed visibility into tool performance and errors.
 * 
 * @param toolName - The name of the tool (used in span name)
 * @param handler - The tool handler function to wrap
 * @returns Wrapped handler with Sentry instrumentation
 */
export function wrapTool<TArgs = any>(
  toolName: string,
  handler: (args: TArgs, ctx: ToolContext) => Promise<ToolResponse>
) {
  return async (args: TArgs, ctx: ToolContext): Promise<ToolResponse> => {
    return Sentry.startNewTrace(async () => {
      return Sentry.startSpan(
        { 
          name: `mcp.tool/${toolName}`,
          op: "mcp.tool",
          description: `MCP tool execution: ${toolName}`,
          data: {
            tool: toolName,
            user: ctx.user?.id,
            provider: extractProviderFromToolName(toolName),
          }
        }, 
        async () => {
          try {
            // Add breadcrumb for tool invocation
            Sentry.addBreadcrumb({
              message: `Tool call: ${toolName}`,
              category: "mcp.tool",
              level: "info",
              data: {
                tool: toolName,
                user: ctx.user?.id,
                args: truncateArgs(args),
              },
            });

            // Execute the tool handler
            const result = await handler(args, ctx);

            // Add success context
            Sentry.setContext("tool_result", {
              success: true,
              tool: toolName,
              contentLength: result.content?.length || 0,
              hasError: result.isError || false,
              requiresAuth: result.requiresAuth || false,
            });

            return result;

          } catch (error) {
            // Add error context
            Sentry.setContext("tool_error", {
              tool: toolName,
              user: ctx.user?.id,
              error: error instanceof Error ? error.message : String(error),
            });

            // Capture the exception with tool context
            Sentry.captureException(error instanceof Error ? error : new Error(String(error)));

            // Re-throw to maintain normal error handling
            throw error;
          }
        }
      );
    });
  };
}

/**
 * Extract provider name from tool name
 * Assumes tool names follow the pattern: "provider-action" or "provider.action"
 */
function extractProviderFromToolName(toolName: string): string {
  const match = toolName.match(/^([^.-]+)[.-]/);
  return match ? match[1] : "unknown";
}

/**
 * Truncate tool arguments for breadcrumbs to avoid excessive data
 * Limits to essential fields and reasonable sizes
 */
function truncateArgs(args: any): any {
  if (!args || typeof args !== "object") {
    return args;
  }

  const truncated: Record<string, any> = {};
  const maxStringLength = 100;
  const maxArrayLength = 5;

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      truncated[key] = value.length > maxStringLength 
        ? `${value.substring(0, maxStringLength)}...` 
        : value;
    } else if (Array.isArray(value)) {
      truncated[key] = value.length > maxArrayLength
        ? [...value.slice(0, maxArrayLength), "..."]
        : value;
    } else if (typeof value === "object" && value !== null) {
      truncated[key] = "[object]";
    } else {
      truncated[key] = value;
    }
  }

  return truncated;
}

/**
 * Set user context for Sentry
 * Should be called once per request/session
 */
export function setSentryUserContext(user: { id: string; email?: string; name?: string }) {
  Sentry.setUser({
    id: user.id,
    email: user.email,
    username: user.name,
  });
}

/**
 * Set tags for the current Sentry scope
 * Useful for categorizing tool calls by provider, environment, etc.
 */
export function setSentryTags(tags: Record<string, string>) {
  Sentry.withScope((scope: any) => {
    Object.entries(tags).forEach(([key, value]) => {
      scope.setTag(key, value);
    });
  });
}