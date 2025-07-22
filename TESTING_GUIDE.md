# MCP Server Testing Guide

## Overview

This guide explains how to test the MCP Gateway using MCP Inspector and other testing tools to verify tool functionality, authentication flows, and API integrations.

## Prerequisites

- Node.js 18+ installed
- pnpm package manager
- MCP Inspector: `npx @modelcontextprotocol/inspector`
- Access to provider OAuth credentials (for full testing)

## Quick Start Testing

### 1. Start the Development Server

```bash
# Start the development server
pnpm dev

# Server will be available on:
# - Main HTTP endpoint: http://localhost:8788
# - SSE endpoint: http://localhost:8788/sse
# - MCP HTTP endpoint: http://localhost:8788/mcp
```

### 2. Basic Health Check

```bash
# Test basic server health
curl http://localhost:8788/health

# Expected response: "OK"
```

### 3. Test Tool Loading with MCP Inspector

```bash
# List all available tools (using SSE transport)
npx @modelcontextprotocol/inspector \
  --cli http://localhost:8788/sse \
  --method tools/list
```

Expected output shows all 9 tools:
- `health` (built-in)
- `userInfo` (built-in)
- `pandadoc-list-documents`, `pandadoc-send-document`, `pandadoc-get-status`
- `hubspot-search-contacts`, `hubspot-create-contact`, `hubspot-get-contact`, `hubspot-update-contact`

## Testing Individual Tools

### Built-in Tools (No Auth Required)

```bash
# Test health tool
npx @modelcontextprotocol/inspector \
  --cli http://localhost:8788/sse \
  --method tools/call \
  --tool-name health

# Test user info tool
npx @modelcontextprotocol/inspector \
  --cli http://localhost:8788/sse \
  --method tools/call \
  --tool-name userInfo
```

### Provider Tools (Auth Required)

When testing provider tools without authentication, you should see auth-required responses:

```bash
# Test PandaDoc tool (will show auth requirement)
npx @modelcontextprotocol/inspector \
  --cli http://localhost:8788/sse \
  --method tools/call \
  --tool-name pandadoc-list-documents
```

Expected response:
```json
{
  "_meta": {
    "requiresAuth": true,
    "provider": "main",
    "authUrl": "https://cf-mcp.asi-cloud.workers.dev/authorize"
  },
  "content": [
    {
      "type": "text",
      "text": "User authentication required. No user ID found in context."
    }
  ],
  "isError": true
}
```

## Testing with OAuth Disabled (Development Mode)

For testing tool schemas and basic functionality without OAuth:

### 1. Disable OAuth

Add to `.dev.vars`:
```env
OAUTH_ENABLED=false
```

### 2. Restart Server

```bash
./scripts/kill-wrangler.sh
pnpm dev
```

### 3. Test Tools

With OAuth disabled, you can test tool registration and schema validation, but provider tools will still require proper user context.

## Testing Authentication Flows

### 1. OAuth Flow Testing

With OAuth enabled (default):

1. **Start server** with OAuth enabled
2. **Visit auth URL** from tool response: `http://localhost:8788/auth/pandadoc?user_id=test-user`
3. **Complete OAuth flow** through provider
4. **Test authenticated tool calls**

### 2. Header-based Authentication

For programmatic testing, you can use header-based auth:

```bash
# Add AUTH_HEADER_SECRET to .dev.vars
echo "AUTH_HEADER_SECRET=test-secret-key" >> .dev.vars

# Test with Authorization header
curl -H "Authorization: Bearer test-user-test-secret-key" \
     -X POST http://localhost:8788/mcp \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Schema Validation Testing

### Test Required Parameters

```bash
# This should fail with validation error
npx @modelcontextprotocol/inspector \
  --cli http://localhost:8788/sse \
  --method tools/call \
  --tool-name hubspot-search-contacts
```

Expected error:
```
Invalid arguments for tool hubspot-search-contacts: [
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": ["query"],
    "message": "Required"
  }
]
```

## Provider-Specific Testing

### PandaDoc Testing

1. **Set up PandaDoc OAuth credentials** in `.dev.vars`
2. **Complete OAuth flow** via browser
3. **Test live API calls**:

```bash
# After authentication, this should work
npx @modelcontextprotocol/inspector \
  --cli http://localhost:8788/sse \
  --method tools/call \
  --tool-name pandadoc-list-documents
```

### HubSpot Testing

1. **Set up HubSpot OAuth credentials**
2. **Note**: HubSpot tools are currently stubs but have full client implementation
3. **Ready for live testing** once OAuth is configured

## Error Testing

### Test Error Handling

1. **Invalid tool names**:
```bash
npx @modelcontextprotocol/inspector \
  --cli http://localhost:8788/sse \
  --method tools/call \
  --tool-name nonexistent-tool
```

2. **Network errors**: Stop external services to test retry logic

3. **Auth token expiration**: Test with expired tokens

## Performance Testing

### Load Testing

```bash
# Install artillery for load testing
npm install -g artillery

# Create test script artillery-config.yml:
# config:
#   target: 'http://localhost:8788'
#   phases:
#     - duration: 60
#       arrivalRate: 10
# scenarios:
#   - name: "Health checks"
#     requests:
#       - get:
#           url: "/health"

artillery run artillery-config.yml
```

### Memory Testing

Monitor server memory usage during extended testing:

```bash
# Monitor process memory
top -p $(pgrep -f "wrangler dev")
```

## Automated Testing

### Run Type Checking

```bash
pnpm type-check
```

### Run Test Suite

```bash
pnpm test
```

### Run with Coverage

```bash
pnpm run coverage
```

## Troubleshooting

### Common Issues

1. **Port 8788 already in use**:
   ```bash
   ./scripts/kill-wrangler.sh
   pnpm dev
   ```

2. **MCP Inspector connection fails**:
   - Check if server is running: `curl http://localhost:8788/health`
   - Use SSE transport: `--cli http://localhost:8788/sse`
   - Check for auth requirements

3. **Tools not loading**:
   - Check server logs for registration errors
   - Verify configuration in `mcp.defaults.ts`
   - Check provider enablement

4. **Auth errors**:
   - Verify OAuth credentials in `.dev.vars`
   - Check token expiration
   - Test with OAuth disabled for debugging

### Debug Logging

Enable verbose logging by checking server console output. Key log patterns:

```
🚀 Initializing MCP Server
📝 Configuration loaded: { enabledTools: [...] }
✅ Tool registration complete
🔍 [withOAuth] Starting OAuth check for provider: pandadoc
```

### Network Issues

Test direct API calls to isolate issues:

```bash
# Test provider APIs directly
curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://api.pandadoc.com/public/v1/templates
```

## Test Checklist

### Basic Functionality
- [ ] Server starts without errors
- [ ] Health endpoint responds
- [ ] All 9 tools register correctly
- [ ] MCP Inspector can list tools
- [ ] Built-in tools execute successfully

### Authentication
- [ ] Auth-required responses formatted correctly
- [ ] OAuth flow completes successfully
- [ ] Token refresh works automatically
- [ ] Token encryption/decryption functional

### Error Handling
- [ ] Schema validation rejects invalid inputs
- [ ] Network errors handled gracefully
- [ ] Provider-specific errors formatted correctly
- [ ] Retry logic works on failures

### Security
- [ ] Tokens stored encrypted
- [ ] Auth headers validated properly
- [ ] Rate limiting functional (if enabled)
- [ ] No secrets in logs

### Performance
- [ ] Response times under 2 seconds
- [ ] Memory usage stable over time
- [ ] Concurrent requests handled properly
- [ ] No memory leaks detected

This testing guide ensures comprehensive validation of all MCP Gateway functionality before deployment.