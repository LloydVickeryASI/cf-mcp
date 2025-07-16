import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";
import type { McpRequest, McpResponse } from "../types";

/**
 * Wraps a tool handler with Sentry tracing
 * Creates a span for each tool invocation for observability
 */
export function wrapTool<T extends z.ZodTypeAny>(
  name: string,
  handler: (args: z.infer<T>, ctx: any) => Promise<McpResponse>
): (args: z.infer<T>, ctx: any) => Promise<McpResponse> {
  return async (args: z.infer<T>, ctx: any): Promise<McpResponse> => {
    return Sentry.startNewTrace(async () => {
      return Sentry.startSpan(
        {
          name: `mcp.tool/${name}`,
          op: "tool.execute",
          attributes: {
            "tool.name": name,
            "tool.args": JSON.stringify(args),
            "user.id": ctx.user?.id,
          },
        },
        async (span) => {
          try {
            const result = await handler(args, ctx);
            span.setStatus({ code: 1 }); // OK
            return result;
          } catch (error) {
            span.setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) }); // ERROR
            Sentry.captureException(error, {
              tags: {
                tool: name,
                userId: ctx.user?.id,
              },
              extra: {
                args,
                toolName: name,
              },
            });
            throw error;
          }
        }
      );
    });
  };
}

/**
 * Create a span for OAuth operations
 */
export function wrapOAuth(
  provider: string,
  operation: string,
  handler: () => Promise<any>
): Promise<any> {
  return Sentry.startSpan(
    {
      name: `mcp.oauth/${provider}`,
      op: "oauth.operation",
      attributes: {
        "oauth.provider": provider,
        "oauth.operation": operation,
      },
    },
    async (span) => {
      try {
        const result = await handler();
        span.setStatus({ code: 1 }); // OK
        return result;
      } catch (error) {
        span.setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) }); // ERROR
        Sentry.captureException(error, {
          tags: {
            oauth_provider: provider,
            oauth_operation: operation,
          },
        });
        throw error;
      }
    }
  );
}