# Architecture Improvements: MCP SDK Integration

## Problem Solved

We initially had a conflict between our custom `ToolResponse` interface and the MCP SDK's expected `CallToolResult` format. The MCP SDK has very specific requirements for tool response structures, and trying to maintain our own interface was causing type errors and compatibility issues.

## Solution: Use MCP SDK Types Directly

Instead of fighting against the MCP SDK, we now embrace it fully while keeping all our architectural improvements.

### ✅ What We've Built

1. **MCP Response Helpers** (`src/tools/mcp-response-helpers.ts`)
   - Convenient functions for creating MCP-compliant responses
   - `createTextResponse()`, `createJsonResponse()`, `createErrorResponse()`
   - Handles auth-required scenarios cleanly

2. **Updated withOAuth Wrapper** (`src/auth/withOAuth.ts`)
   - Now returns `CallToolResult` directly
   - Auth-required responses are proper MCP responses with `_meta` fields
   - Full compatibility with MCP Inspector and clients

3. **Base Provider Client** (`src/tools/base-client.ts`)
   - Consistent error handling across all providers
   - Type-safe request/response patterns
   - Token management integration

4. **Enhanced Security**
   - Token encryption with AES-GCM
   - Retry logic with exponential backoff
   - OAuth 2.1 compliance with token rotation

### 🔧 How Tools Work Now

Here's the recommended pattern for implementing tools:

```typescript
// Example: HubSpot search contacts tool
import { withOAuth } from "../../auth/withOAuth";
import { createJsonResponse, createErrorResponse } from "../mcp-response-helpers";
import { HubSpotClient } from "./client";

export const searchContactsSchema = z.object({
  query: z.string().describe("Search query (email, name, etc.)"),
  limit: z.number().optional().describe("Number of results (default: 10)"),
});

// Tool registration
server.registerTool(
  "hubspot-search-contacts",
  {
    title: "Search HubSpot Contacts",
    description: "Search for contacts in HubSpot by email or name",
    inputSchema: searchContactsSchema.shape,
  },
  withOAuth("hubspot", async ({ args, accessToken }) => {
    try {
      const client = new HubSpotClient(accessToken);
      const results = await client.searchContacts(args.query, args.limit);
      
      return createJsonResponse({
        total: results.total,
        contacts: results.results
      });
    } catch (error) {
      if (error instanceof ToolError) {
        return createErrorResponse(error.message, error.code);
      }
      return createErrorResponse("Failed to search contacts");
    }
  }, agentContext)
);
```

### 🏗️ Key Architectural Benefits

1. **MCP Compliance**: All responses are natively compatible with MCP Inspector and clients
2. **Type Safety**: Full TypeScript support with MCP SDK types
3. **Developer Experience**: Helper functions make common patterns easy
4. **Error Handling**: Consistent error responses with proper MCP structure
5. **Auth Integration**: Seamless OAuth flow with proper auth-required responses
6. **Security**: All our token encryption and retry logic remains intact

### 🔄 Migration Path

For existing tools, the migration is straightforward:

**Before:**
```typescript
return {
  content: [{ type: "text", text: JSON.stringify(data) }],
  requiresAuth: false
};
```

**After:**
```typescript
import { createJsonResponse } from "../mcp-response-helpers";
return createJsonResponse(data);
```

### 📋 Implementation Checklist

For each provider, ensure:

- [ ] Client extends `BaseProviderClient`
- [ ] Tools use `withOAuth()` wrapper
- [ ] Responses use MCP helper functions
- [ ] Error handling uses `ToolError` class
- [ ] Integration tests verify MCP compatibility
- [ ] OAuth configuration is complete

### 🎯 Next Steps

1. **Complete HubSpot Implementation**: Convert stub tools to working implementations
2. **Implement Remaining Providers**: Xero, NetSuite, Autotask following the same patterns
3. **Add Integration Tests**: Verify MCP Inspector compatibility
4. **Performance Monitoring**: Add metrics for tool response times

This architecture gives us the best of both worlds: full MCP SDK compatibility with all our security and reliability enhancements intact.