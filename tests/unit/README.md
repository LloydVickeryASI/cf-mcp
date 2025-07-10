# MCP In-Memory Testing Setup

This directory contains the minimal viable setup for in-memory MCP testing using `@robertdouglass/mcp-tester`.

## Setup Complete ✅

1. **Package Installed**: `@robertdouglass/mcp-tester` v2.1.1 
2. **Test Framework**: MCPTestFrameworkAdvanced is working
3. **Test Files Created**:
   - `mcp-in-memory.spec.ts` - Full example with Client/Server setup (has some type issues)
   - `mcp-basic.spec.ts` - Simpler example demonstrating the patterns

## Key Components

### 1. Test Framework Setup
```javascript
const { MCPTestFrameworkAdvanced } = require("@robertdouglass/mcp-tester");

const framework = new MCPTestFrameworkAdvanced({
  verbose: true,
  timeout: 10000,
  outputDir: './test-results'
});
```

### 2. Test Configuration Pattern
```javascript
const tests = {
  name: "MCP Server Tests",
  testDiscovery: true,      // Test tool discovery
  testStability: false,     // Skip for unit tests
  customTests: [],          // Custom test functions
  toolTests: []            // Tool-specific tests
};
```

### 3. Server Configuration
```javascript
const config = {
  type: 'stdio',           // Transport type
  command: 'node',         // Command to run
  args: ['./server.js']    // Arguments
};
```

### 4. In-Memory Transport (MCP SDK)
```javascript
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
```

## Running Tests

```bash
# Run specific test file
pnpm test tests/unit/mcp-basic.spec.ts

# Run all unit tests
pnpm test:unit
```

## Test Results

When running `mcp-basic.spec.ts`:
- ✅ MCP test framework setup works correctly
- ⚠️ In-memory transport demo has API usage issue (fixable)
- ✅ Test patterns are properly demonstrated

## Next Steps

1. Fix the `setRequestHandler` API usage in the in-memory transport test
2. Create integration tests that actually start the MCP server process
3. Add more comprehensive tool tests for PandaDoc, HubSpot, etc.
4. Set up recording/replay with PollyJS for external API calls

## References

- [MCP Tester Documentation](node_modules/@robertdouglass/mcp-tester/CLAUDE.md)
- [MCP SDK](https://github.com/modelcontextprotocol/sdk)
- Testing pattern from overview.mdc section 7