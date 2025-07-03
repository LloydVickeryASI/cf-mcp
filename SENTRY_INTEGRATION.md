# Sentry Integration Implementation

This document outlines the implementation of Sentry monitoring for the ASI MCP Gateway Cloudflare Worker, following the specifications in the overview document.

## Overview

The Sentry integration provides comprehensive observability for the MCP server with:
- Error monitoring and reporting
- Performance tracing with tool-level spans
- User context tracking
- Configurable sampling rates
- Source map support for debugging

## Components Implemented

### 1. Core Sentry Configuration (`src/sentry.ts`)

**Features:**
- Environment-based configuration with fallbacks
- Configurable sampling rates (default 10%)
- Optional Sentry Logs (beta) support
- Helper functions for exception/message capture
- Breadcrumb support for user action tracking

**Configuration:**
```typescript
export interface SentryConfig {
  dsn: string;
  tracesSampleRate: number;
  environment?: string;
  release?: string;
  _experiments?: {
    enableLogs?: boolean;
  };
}
```

### 2. Tool Span Helper (`src/middleware/tool-span.ts`)

**Features:**
- Wraps MCP tool handlers with Sentry tracing
- Creates `mcp.tool/<toolName>` spans for each tool execution
- Automatic error capture with context
- Breadcrumb generation for tool calls
- Argument truncation to avoid excessive data
- User context setting utilities

**Usage:**
```typescript
import { wrapTool } from "./middleware/tool-span";

const handler = wrapTool("pandadoc-send", async (args, ctx) => {
  // Tool implementation
});
```

### 3. Worker Entry Point Integration (`src/index.ts`)

**Features:**
- Conditional Sentry initialization based on DSN presence
- Main handler wrapped with `Sentry.withSentry()`
- Graceful fallback when Sentry is not configured

### 4. Durable Object Instrumentation (`src/mcpServer.ts`)

**Features:**
- MCP Durable Object wrapped with `Sentry.instrumentDurableObjectWithSentry()`
- User context integration with Sentry user tracking
- Error context for MCP protocol errors

### 5. Infrastructure Configuration

**wrangler.jsonc updates:**
- Added `nodejs_als` compatibility flag for AsyncLocalStorage support
- Enabled `upload_source_maps: true` for debugging
- Observability enabled

**package.json updates:**
- Added `@sentry/cloudflare: ^8.46.0` dependency

## Environment Variables

Required environment variables for Sentry integration:

```env
# Core Sentry configuration
SENTRY_DSN=https://your-dsn@sentry.io/project-id

# Optional configuration
SENTRY_SAMPLE_RATE=0.1          # Default: 10% sampling
ENVIRONMENT=development         # Environment tag
SENTRY_RELEASE=v1.0.0          # Release tracking
SENTRY_ENABLE_LOGS=false       # Beta Sentry Logs feature
```

All variables have been added to:
- `worker-configuration.d.ts` (TypeScript types)
- `config.example.env` (development example)

## Features

### Error Monitoring
- Automatic exception capture with context
- Manual error reporting with `captureException()`
- Message logging with `captureMessage()`

### Performance Tracing
- Tool-level spans: `mcp.tool/pandadoc-send`, `mcp.tool/hubspot-create-contact`
- Request-level tracing through Worker and Durable Object
- Performance monitoring for slow tool calls

### User Context
- User ID, email, and name tracking
- OAuth scope and client ID context for API calls
- Provider-specific tagging

### Breadcrumbs
- Tool invocation tracking
- User action breadcrumbs
- Error context breadcrumbs

## Security Considerations

- **Argument Truncation**: Tool arguments are truncated in breadcrumbs to prevent sensitive data leakage
- **Sampling**: Configurable sampling rates to control costs and data volume
- **Optional**: Sentry is completely optional - system works without it
- **Environment Separation**: Different configurations per environment

## Development Setup

1. **Add Sentry DSN to `.dev.vars`:**
   ```env
   SENTRY_DSN=https://your-dsn@sentry.io/project-id
   SENTRY_SAMPLE_RATE=1.0  # 100% sampling for development
   ENVIRONMENT=development
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

## Production Deployment

1. **Set Sentry secrets:**
   ```bash
   wrangler secret put SENTRY_DSN
   wrangler secret put SENTRY_SAMPLE_RATE  # Recommended: 0.1 for 10%
   wrangler secret put ENVIRONMENT
   wrangler secret put SENTRY_RELEASE
   ```

2. **Deploy:**
   ```bash
   npm run deploy
   ```

## Monitoring Dashboard

In Sentry, you'll see:

### Issues
- Worker crashes and exceptions
- Tool-level errors with context
- OAuth and authentication failures

### Performance
- Request duration traces
- Tool execution times
- Slow query identification

### Releases
- Deployment tracking
- Error regression detection
- Performance impact analysis

## Tool Usage Examples

### Wrapping a Tool Handler
```typescript
import { wrapTool } from "./middleware/tool-span";

// Wrap your tool handler
const sendDocument = wrapTool("pandadoc-send", async (args, ctx) => {
  try {
    const result = await pandadocApi.send(args.templateId, args.email);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    // Error is automatically captured by wrapTool
    throw error;
  }
});
```

### Manual Error Reporting
```typescript
import { captureException, captureMessage } from "./sentry";

try {
  // Some operation
} catch (error) {
  captureException(error, {
    tool: "pandadoc-send",
    user: ctx.user.id,
    provider: "pandadoc"
  });
  throw error;
}

// Log important events
captureMessage("Large document processed", "info", {
  documentSize: "10MB",
  processingTime: "5s"
});
```

## Cost Control

- **Sampling**: Default 10% sampling reduces costs while maintaining visibility
- **Argument Truncation**: Prevents excessive data transmission
- **Conditional Initialization**: No overhead when Sentry is disabled
- **Environment-based**: Higher sampling in dev, lower in production

## Troubleshooting

### Sentry Not Working
1. Check `SENTRY_DSN` is set correctly
2. Verify sampling rate isn't too low
3. Check browser console for Sentry initialization logs

### Missing Source Maps
1. Ensure `upload_source_maps: true` in wrangler.jsonc
2. Run `npx @sentry/wizard@latest -i sourcemaps` for advanced setup

### High Error Volume
1. Reduce `SENTRY_SAMPLE_RATE`
2. Add error filtering in Sentry project settings
3. Implement local error handling before Sentry

## Integration with Other Systems

The Sentry integration is designed to work alongside:
- **Rate Limiting**: Tool-level rate limits work with Sentry monitoring
- **OAuth System**: User context flows through to Sentry
- **Database Operations**: DB errors are captured with context
- **External APIs**: API failures include provider context

This implementation provides comprehensive observability while maintaining performance and cost efficiency.