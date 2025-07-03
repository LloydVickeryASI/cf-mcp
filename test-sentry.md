# Testing Sentry Integration

## Setup
1. Create a Sentry project at https://sentry.io/
2. Get your DSN from Project Settings > Client Keys (DSN)
3. Set the DSN as a secret:
   ```bash
   wrangler secret put SENTRY_DSN
   # Paste your DSN when prompted
   ```
4. Optionally set sample rate (0.1 = 10% of transactions):
   ```bash
   wrangler secret put SENTRY_SAMPLE_RATE
   # Enter: 0.1
   ```

## Testing Error Capture
Once configured, you can test error capture by:

1. **Trigger a 500 error**:
   ```bash
   # This should capture the error in Sentry
   curl -X POST https://cf-mcp.asi-cloud.workers.dev/mcp \
     -H "Authorization: Bearer lloyd-invalid" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"invalid/method"}'
   ```

2. **Test tool execution tracing**:
   ```bash
   # This should create performance traces in Sentry
   curl -X POST https://cf-mcp.asi-cloud.workers.dev/mcp \
     -H "Authorization: Bearer lloyd-{your-secret}" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

## What to Look For in Sentry

### Errors Tab
- Server errors with context (pathname, method, user info)
- Sensitive data should be filtered out
- Event IDs should match those returned in error responses

### Performance Tab
- `mcp.tool/*` transactions for tool execution
- Worker startup and execution times
- Span details showing tool parameters (non-sensitive only)

### User Context
- User login, name, email should appear in error context
- Anonymous users for non-authenticated requests

## Environment Detection
- Local development: `environment: "development"`  
- Production: `environment: "production"`
- Based on BASE_URL containing 'localhost'