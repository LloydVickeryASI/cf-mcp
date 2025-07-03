# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Cloudflare Workers-based MCP (Model Context Protocol) gateway** that provides OAuth-protected access to multiple SaaS provider APIs. It serves as a centralized authentication and tool proxy for AI agents to interact with services like PandaDoc, HubSpot, Xero, NetSuite, and Autotask.

## Development Commands

- **Development server**: `npm run dev` or `wrangler dev` (runs on localhost:8788)
- **Deploy to production**: `npm run deploy` or `wrangler deploy`
- **Type checking**: `npm run type-check`
- **Generate Cloudflare types**: `npm run cf-typegen`

## Architecture Overview

### Core Components

1. **Worker Entry Point** (`src/index.ts`): Main Cloudflare Worker with OAuth 2.1 + PKCE endpoints and RFC 9728/8414 compliance for MCP Inspector compatibility
2. **MCP Server** (`src/mcpServer.ts`): Durable Object that handles MCP protocol messages and tool execution
3. **Authentication Layer** (`src/auth/`): OAuth providers and per-tool token management
4. **Tool Registry** (`src/tools/`): Provider-specific API integrations organized by service
5. **Configuration** (`src/config/`): Type-safe config loading with secrets management

### Authentication Flow

- **Primary OAuth**: Microsoft Azure AD for user authentication (configurable to GitHub via feature flag)
- **Per-tool OAuth**: Individual provider tokens stored in D1 database 
- **Token Management**: Automatic refresh, expiration handling, and secure storage
- **OAuth 2.1 Compliance**: Authorization Code + PKCE flow, refresh token rotation

### Tool Architecture

Each provider has its own directory under `src/tools/` with:
- `index.ts`: Exports all tools for the provider
- `client.ts`: Low-level REST API wrapper with auth headers
- Individual tool files: Business logic for specific operations
- Provider examples: `pandadoc/`, `hubspot/`, `xero/`, `netsuite/`, `autotask/`

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

## Important Notes

- OAuth can be disabled via `config.oauth.enabled = false` for header-based auth
- All tools return `requiresAuth: true` with OAuth URLs when tokens are missing
- Database migrations are handled automatically via Durable Objects
- The server supports both SSE (for MCP Inspector) and standard JSON-RPC over HTTP
- Path aliases are configured in `tsconfig.json` for clean imports (`@auth/*`, `@tools/*`, etc.)