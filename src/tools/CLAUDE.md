# Adding New Tools to the MCP Server

This guide explains how to add new tools to the MCP server following established patterns and best practices.

## 1. Directory Structure

Each provider gets its own directory under `src/tools/`:

```
src/tools/
├── your-provider/
│   ├── index.ts          # Tool registration
│   ├── client.ts         # API client wrapper
│   ├── tool-name.ts      # Individual tool implementations
│   └── other-tool.ts     # Additional tools
```

## 2. Create the API Client

Create `src/tools/your-provider/client.ts`:

```typescript
import { wrapOAuth } from "../../observability/tool-span";
import { fetchWithRetry, PROVIDER_RETRY_CONFIGS } from "../../middleware/retry";

const API_BASE = "https://api.your-provider.com";

export interface YourProviderResponse {
  // Define your API response types
}

export class YourProviderClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    
    const response = await fetchWithRetry(url, {
      ...options,
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    }, PROVIDER_RETRY_CONFIGS.yourProvider);

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: `HTTP ${response.status}: ${errorText}` };
      }
      throw new Error(`API error: ${error.message} (${response.status})`);
    }

    return response.json() as T;
  }

  async someOperation(params: any): Promise<YourProviderResponse> {
    return wrapOAuth("your-provider", "some_operation", async () => {
      return this.request<YourProviderResponse>("/endpoint", {
        method: "POST",
        body: JSON.stringify(params),
      });
    });
  }
}
```

## 3. Create Individual Tools

Create `src/tools/your-provider/some-tool.ts`:

```typescript
import { z } from "zod";
import { YourProviderClient } from "./client";
import { wrapTool } from "../../observability/tool-span";

export const someToolSchema = z.object({
  param1: z.string().describe("Description of parameter"),
  param2: z.string().optional().describe("Optional parameter"),
});

export type SomeToolInput = z.infer<typeof someToolSchema>;

export const someToolTool = wrapTool(
  "your-provider-some-tool",
  async (args: SomeToolInput, ctx: any) => {
    const { param1, param2 } = args;
    
    const client = new YourProviderClient(ctx.accessToken);
    const result = await client.someOperation({ param1, param2 });
    
    return {
      content: [
        {
          type: "text",
          text: `Operation completed successfully: ${JSON.stringify(result)}`,
        },
      ],
    };
  }
);
```

## 4. Register Tools

Create `src/tools/your-provider/index.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPConfig } from "../../config/mcp.defaults";
import { isOperationEnabled } from "../../config/loader";
import { withOAuth } from "../../auth/withOAuth";

// Import tool implementations
import { someToolTool, someToolSchema } from "./some-tool";

export function registerTools(server: McpServer, config: MCPConfig) {
  const toolConfig = config.tools.yourProvider;
  
  if (!toolConfig.enabled) {
    return;
  }

  if (isOperationEnabled(config, "yourProvider", "someTool")) {
    server.registerTool(
      "your-provider-some-tool",
      {
        title: "Your Provider Some Tool",
        description: "Description of what this tool does",
        inputSchema: someToolSchema.shape,
      },
      withOAuth("your-provider", someToolTool)
    );
    console.log("🔧 YourProvider someTool tool registered");
  }
}

// Export tool implementations
export { someToolTool } from "./some-tool";
```

## 5. Add Configuration

Update `src/config/mcp.defaults.ts`:

```typescript
export const defaults = {
  // ... existing config
  tools: {
    // ... existing tools
    yourProvider: {
      enabled: true,
      oauth: true,
      rateLimit: { max: 100, period: "1m" },
      operations: {
        someTool: { enabled: true },
        otherTool: { enabled: false },
      }
    },
  },
};
```

Update `src/middleware/retry.ts` to add provider-specific retry config:

```typescript
export const PROVIDER_RETRY_CONFIGS: Record<string, RetryConfig> = {
  // ... existing configs
  yourProvider: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    retryableErrors: ["TIMEOUT", "NETWORK_ERROR", "ECONNRESET"],
  },
};
```

Update `src/middleware/provider-rate-limit.ts` to add provider-specific rate limits:

```typescript
export const PROVIDER_RATE_LIMITS: Record<string, ProviderRateLimitConfig> = {
  // ... existing configs
  yourProvider: {
    requestsPerMinute: 60,
    requestsPerHour: 3600,
    requestsPerDay: 50000,
    burstLimit: 10,
    burstWindow: 10,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 60,
    maxQueueSize: 100,
    queueTimeout: 30000,
  },
};
```

Update `src/config/mcp.secrets.schema.ts`:

```typescript
export const secretsSchema = z.object({
  // ... existing secrets
  YOUR_PROVIDER_CLIENT_ID: z.string().min(1, "Client ID is required"),
  YOUR_PROVIDER_CLIENT_SECRET: z.string().min(1, "Client Secret is required"),
});
```

## 6. Add OAuth Configuration

Update `src/auth/provider-config.ts`:

```typescript
// Add to getProviderScopes()
case Provider.YOUR_PROVIDER:
  return ["scope1", "scope2"];

// Add to getProviderAuthUrl()
case Provider.YOUR_PROVIDER:
  return "https://your-provider.com/oauth/authorize";

// Add to getProviderTokenUrl()
case Provider.YOUR_PROVIDER:
  return "https://api.your-provider.com/oauth/token";
```

Add to `src/types/index.ts`:

```typescript
export enum Provider {
  // ... existing providers
  YOUR_PROVIDER = "your-provider",
}
```

## 7. Register in Main Tools Index

Update `src/tools/index.ts`:

```typescript
import { registerTools as registerYourProviderTools } from "./your-provider";

// In the main registration function
registerYourProviderTools(server, config);
```

## 8. Write Integration Tests

Create `tests/integration/your-provider-api.spec.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { YourProviderClient } from "../../src/tools/your-provider/client";
import { someToolTool } from "../../src/tools/your-provider/some-tool";

const LIVE_ACCESS_TOKEN = "your-live-token-here";

const mockContext = {
  accessToken: LIVE_ACCESS_TOKEN,
  user: { id: "test-user", email: "test@example.com", name: "Test User" },
  env: {},
  request: new Request("https://example.com"),
};

describe("YourProvider API Integration", () => {
  let client: YourProviderClient;

  beforeEach(() => {
    client = new YourProviderClient(LIVE_ACCESS_TOKEN);
  });

  describe("YourProvider Client", () => {
    it("should perform some operation", async () => {
      const result = await client.someOperation({ param1: "test" });
      
      expect(result).toBeDefined();
      // Add your assertions here
    });
  });

  describe("YourProvider Tools", () => {
    it("should execute some tool", async () => {
      const result = await someToolTool(
        { param1: "test", param2: "optional" },
        mockContext
      );
      
      expect(result).toHaveProperty("content");
      expect(result.content[0]).toHaveProperty("type", "text");
    });
  });
});
```

## 9. Record Live API Interactions

1. **Set up environment variables**:
   ```bash
   # Add to .dev.vars
   YOUR_PROVIDER_CLIENT_ID=your_client_id
   YOUR_PROVIDER_CLIENT_SECRET=your_client_secret
   ```

2. **Record live API calls**:
   ```bash
   RECORD=1 pnpm test tests/integration/your-provider-api.spec.ts
   ```

3. **Verify recordings**:
   ```bash
   pnpm test tests/integration/your-provider-api.spec.ts
   ```

## 10. Testing Your Implementation

1. **Run type checking**: `pnpm type-check`
2. **Run tests**: `pnpm test`
3. **Test locally**: `pnpm dev`
4. **Test OAuth flow**: Visit `/auth/your-provider?user_id=test-user`

## Key Patterns to Follow

### ✅ **Do This**
- Use `wrapTool()` for Sentry observability
- Use `wrapOAuth()` for OAuth operations in client
- Use `withOAuth()` for tool registration
- Use `fetchWithRetry()` with provider-specific retry configs
- Add provider-specific rate limiting configurations
- Follow the existing directory structure
- Add comprehensive error handling
- Include type safety with Zod schemas
- Test with live API and record with PollyJS

### ❌ **Don't Do This**
- Don't bypass OAuth wrappers
- Don't use raw `fetch()` - use `fetchWithRetry()`
- Don't hardcode API endpoints
- Don't skip error handling
- Don't commit secrets to git
- Don't skip integration tests
- Don't ignore the configuration system
- Don't forget to add rate limiting configs for new providers

## Environment Variables

When deploying, set these secrets:
```bash
wrangler secret put YOUR_PROVIDER_CLIENT_ID
wrangler secret put YOUR_PROVIDER_CLIENT_SECRET
```

## Troubleshooting

- **OAuth issues**: Check provider configuration in `src/auth/provider-config.ts`
- **Type errors**: Ensure Zod schemas match your API responses
- **Test failures**: Verify live token is valid and re-record if needed
- **Registration issues**: Check that tools are enabled in `mcp.defaults.ts`
- **Rate limiting errors**: Verify provider is configured in `PROVIDER_RETRY_CONFIGS` and `PROVIDER_RATE_LIMITS`
- **Network timeouts**: Check retry configuration and increase delays if needed

This pattern ensures consistency, observability, and maintainability across all tools in the MCP server.