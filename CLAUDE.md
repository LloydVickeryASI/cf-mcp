# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Cloudflare Workers-based MCP (Model Context Protocol) gateway** that provides OAuth-protected access to multiple SaaS provider APIs. It serves as a centralized authentication and tool proxy for AI agents to interact with services like PandaDoc, HubSpot, Xero, NetSuite, and Autotask.

## Development Commands

- **Development server**: `pnpm dev` or `wrangler dev` (runs on localhost:8788)
- **Deploy to production**: `pnpm deploy` or `wrangler deploy`
- **Type checking**: `pnpm type-check`
- **Generate Cloudflare types**: `pnpm cf-typegen`
- **Install dependencies**: `pnpm install`

**Package Manager**: This project uses **pnpm** (not npm). Cloudflare Pages uses pnpm by default, and this prevents lockfile sync issues.

## Architecture Overview

### Core Components

1. **Worker Entry Point** (`src/index.ts`): Main Cloudflare Worker with OAuth 2.1 + PKCE endpoints and RFC 9728/8414 compliance for MCP Inspector compatibility
2. **MCP Server** (`src/mcpServer.ts`): Durable Object that handles MCP protocol messages and tool execution
3. **Authentication Layer** (`src/auth/`): OAuth providers and per-tool token management
4. **Tool Registry** (`src/tools/`): Provider-specific API integrations organized by service
5. **Configuration** (`src/config/`): Type-safe config loading with secrets management

### Authentication Flow

- **Primary OAuth**: Microsoft Azure AD for user authentication (configurable to GitHub via feature flag)
- **Header-based Auth**: Can be used instead of OAuth when `config.oauth.enabled = false` (format: `Authorization: Bearer {user}-{secret}`)
- **Per-tool OAuth**: Individual provider tokens stored in D1 database 
- **Token Management**: Automatic refresh, expiration handling, and secure storage
- **OAuth 2.1 Compliance**: Authorization Code + PKCE flow, refresh token rotation

### Tool Architecture

Each provider has its own directory under `src/tools/` with:
- `index.ts`: Exports all tools for the provider
- `client.ts`: Low-level REST API wrapper with auth headers
- Individual tool files: Business logic for specific operations
- Provider examples: `pandadoc/` (fully implemented), `hubspot/` (stubs), `xero/` (stubs), `netsuite/` (stubs), `autotask/` (stubs)

### Database Schema

Uses **D1 SQLite** for persistent storage:
- `user_sessions`: OAuth sessions and refresh tokens
- `tool_credentials`: Per-user, per-provider access tokens
- `audit_logs`: Security and usage tracking

### Configuration Management

- **Non-secret config**: `src/config/mcp.defaults.ts` (committed)
- **Secrets**: Environment variables via `.dev.vars` (local) or `wrangler secret put` (production)
- **Type safety**: `worker-configuration.d.ts` defines Env interface
- **Feature flags**: Enable/disable providers and individual operations

## Key Design Patterns

### OAuth Wrapper Pattern
Use `withOAuth()` HOF for tools requiring authentication:
```typescript
import { withOAuth } from "@auth/withOAuth";

server.registerTool("pandadoc-send", schema, 
  withOAuth("pandadoc", async ({ args, accessToken }) => {
    // Tool implementation with guaranteed valid token
  })
);
```

### Tool Context Pattern
All tools receive standardized context with auth, database, and configuration:
```typescript
interface ToolContext {
  env: Env;
  auth: ToolAuthHelper;
  db: DatabaseHelper;
  config: MCPConfig;
  user: { id: string; email: string; name: string };
}
```

### Configuration Validation
Config uses Zod schemas for runtime validation of environment variables and maintains type safety throughout the application.

## OAuth Provider Configuration

Each provider requires OAuth app setup:

- **PandaDoc**: `PANDADOC_CLIENT_ID`, `PANDADOC_CLIENT_SECRET`
- **HubSpot**: `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`
- **Xero**: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`
- **NetSuite**: `NETSUITE_CLIENT_ID`, `NETSUITE_CLIENT_SECRET`
- **Autotask**: `AUTOTASK_CLIENT_ID`, `AUTOTASK_CLIENT_SECRET`

Set via `wrangler secret put <SECRET_NAME>` for production.

## Cloudflare Resources

- **Durable Objects**: `ModularMCP` class for stateful MCP server instances
- **D1 Database**: `MCP_DB` binding for persistent token and audit storage
- **KV Storage**: `OAUTH_KV` for OAuth state and session management
- **AI Binding**: Optional `AI` binding for LLM integrations

## Standards Compliance

- **MCP Protocol**: June 18, 2025 specification with SSE transport
- **OAuth 2.1**: Authorization Code + PKCE, refresh token rotation
- **RFC 9728**: OAuth 2.0 Protected Resource Metadata
- **RFC 8414**: OAuth 2.0 Authorization Server Metadata  
- **RFC 7591**: Dynamic Client Registration (for MCP Inspector)

## Security Features

- **PKCE mandatory** for all OAuth flows
- **Token refresh rotation** per OAuth 2.1
- **Audit logging** for all tool calls and auth events
- **Rate limiting** via Cloudflare Workers Rate Limiting API
- **Secrets validation** with Zod schemas

## Testing

### MCP Server Testing with CLI Inspector

**Recommended approach** for testing and troubleshooting the MCP server during development. Production testing should be automated via Vitest. 

1. **Start the development server**:
   ```bash
   pnpm dev
   # Server runs on http://localhost:8788
   ```

2. **Test SSE Transport** (deprecated but functional):
   ```bash
   # List all available tools
   npx @modelcontextprotocol/inspector --cli http://localhost:8788/sse --method tools/list
   
   # Test built-in tools
   npx @modelcontextprotocol/inspector --cli http://localhost:8788/sse --method tools/call --tool-name health
   npx @modelcontextprotocol/inspector --cli http://localhost:8788/sse --method tools/call --tool-name userInfo
   
   # Test provider tools (will show requiresAuth: true if not authenticated)
   npx @modelcontextprotocol/inspector --cli http://localhost:8788/sse --method tools/call --tool-name pandadoc-list-documents
   ```

3. **Test StreamableHttp Transport** (modern, recommended):
   ```bash
   # List all available tools
   npx @modelcontextprotocol/inspector --cli http://localhost:8788/mcp --transport http --method tools/list
   
   # Test built-in tools
   npx @modelcontextprotocol/inspector --cli http://localhost:8788/mcp --transport http --method tools/call --tool-name health
   npx @modelcontextprotocol/inspector --cli http://localhost:8788/mcp --transport http --method tools/call --tool-name userInfo
   
   # Test provider tools
   npx @modelcontextprotocol/inspector --cli http://localhost:8788/mcp --transport http --method tools/call --tool-name pandadoc-list-documents
   ```

4. **Expected Results**:
   - **Health check**: Returns server status, version, and enabled providers
   - **User info**: Returns user context (empty if not authenticated)
   - **Provider tools**: Returns `requiresAuth: true` with OAuth URL if authentication required
   - **Tools list**: Shows all registered tools with proper schemas

5. **Troubleshooting**:
   - Check server logs in terminal for detailed request/response info
   - Verify tool registration in startup logs
   - Test both transport methods to identify transport-specific issues
   - Use `--method tools/list` to verify all tools are registered correctly

### Unit Testing Infrastructure

**Current Status**: Basic testing infrastructure with Vitest in Node environment (not Cloudflare workers pool).

- **Framework**: Vitest with Node environment
- **Coverage**: V8 provider with 85% thresholds configured
- **Unit Tests**: Configuration loader, OAuth wrapper tests
- **Integration Tests**: PandaDoc API tests (need PollyJS recording)
- **Missing**: PollyJS for HTTP recording, mock-oauth2-server, Cloudflare workers pool

**TODO**: Implement PollyJS for HTTP recording/replay and migrate to Cloudflare workers pool testing.

## Deployment & PR Preview URLs

Cloudflare Workers are automatically deployed via GitHub Actions, providing **ephemeral preview URLs for every pull request**.

### GitHub Actions Setup

The project includes a GitHub Actions workflow (`.github/workflows/cloudflare-preview.yml`) that:

1. **Deploys preview environments** for every PR
2. **Comments on PRs** with preview URLs and testing instructions
3. **Runs smoke tests** to verify deployment health
4. **Cleans up** preview deployments when PRs are closed

### Required GitHub Secrets

Set these secrets in your GitHub repository settings (**Settings → Secrets and variables → Actions**):

| Secret | Description | How to get it |
|--------|-------------|---------------|
| `CLOUDFLARE_API_TOKEN` | API token for Wrangler deployments | Cloudflare Dashboard → My Profile → API Tokens → Create Token (use "Custom token" with Zone:Read, Account:Read, User:Read, Worker:Edit permissions) |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID | Cloudflare Dashboard → Right sidebar shows "Account ID" |

### Wrangler Environment Configuration

The `wrangler.jsonc` includes a `preview` environment configuration:

```jsonc
{
  "env": {
    "preview": {
      "name": "cf-mcp-preview",
      "kv_namespaces": [{ "binding": "OAUTH_KV", "id": "..." }],
      "d1_databases": [{ "binding": "MCP_DB", "database_name": "asi-mcp-db-preview" }],
      "vars": { "ENVIRONMENT": "preview" }
    }
  }
}
```

### Preview URL Pattern

Preview deployments follow the pattern:
- **Production**: `https://cf-mcp.asi-cloud.workers.dev`
- **Preview**: `https://cf-mcp-pr-<PR_NUMBER>.asi-cloud.workers.dev`

### PR Comment Features

Each PR automatically receives a comment with:
- **Preview URL** and MCP endpoint URLs
- **Testing commands** for MCP Inspector CLI
- **Deployment status** and commit information
- **Auto-updates** on new commits

### Testing Preview Deployments

The GitHub Actions workflow includes:
- **Health checks** on `/health` endpoint
- **Smoke tests** for MCP endpoints
- **Automatic cleanup** when PRs are closed

### Manual Deployment

For manual deployments:
```bash
# Deploy to preview environment
wrangler deploy --env preview

# Deploy to production
wrangler deploy
```

## Important Notes

- OAuth can be disabled via `config.oauth.enabled = false` for header-based auth
- All tools return `requiresAuth: true` with OAuth URLs when tokens are missing
- Database migrations are handled automatically via Durable Objects
- The server supports both SSE (for MCP Inspector) and standard JSON-RPC over HTTP
- Path aliases are configured in `tsconfig.json` for clean imports (`@auth/*`, `@tools/*`, etc.)