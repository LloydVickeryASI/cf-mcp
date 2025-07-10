#!/usr/bin/env node

/**
 * Verify MCP Testing Setup
 * Quick script to confirm all components are installed and working
 */

console.log('🔍 Verifying MCP Testing Setup...\n');

// Check if packages are installed
try {
  // Check MCP Tester
  const { MCPTestFrameworkAdvanced } = require('@robertdouglass/mcp-tester');
  console.log('✅ @robertdouglass/mcp-tester is installed');
  
  // Check MCP SDK
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  console.log('✅ @modelcontextprotocol/sdk is installed');
  
  // Create test framework instance
  const framework = new MCPTestFrameworkAdvanced({
    verbose: false,
    timeout: 5000,
    outputDir: './test-results'
  });
  console.log('✅ MCPTestFrameworkAdvanced can be instantiated');
  
  // Create in-memory transport
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  console.log('✅ InMemoryTransport can create linked pairs');
  
  console.log('\n🎉 All components are properly installed and working!');
  console.log('\n📝 Summary:');
  console.log('   - MCP Tester framework: Ready');
  console.log('   - MCP SDK components: Ready');
  console.log('   - In-memory transport: Ready');
  console.log('   - Test files created: mcp-basic.spec.ts, mcp-in-memory.spec.ts');
  console.log('\n🚀 You can now run tests with: pnpm test tests/unit/mcp-basic.spec.ts');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}