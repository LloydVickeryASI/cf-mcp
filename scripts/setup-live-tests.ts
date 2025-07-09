#!/usr/bin/env tsx
/**
 * Setup script for live API tests
 * 
 * Retrieves OAuth tokens from D1 database for the lloyd-mcp-dev user
 */

import { config } from "dotenv";
import { execSync } from "child_process";
import { writeFileSync } from "fs";

// Load environment variables
config({ path: ".dev.vars" });

interface TestToken {
  accessToken: string;
  expiresAt: string;
  provider: string;
  userId: string;
}

interface ToolCredential {
  id: string;
  user_id: string;
  provider: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scopes?: string;
  created_at: number;
  updated_at: number;
}

async function setupLiveTests() {
  console.log("🚀 Setting up live API test credentials from D1 database...\n");
  
  const userId = "lloyd-mcp-dev"; // Derived from bearer token: lloyd-mcp-dev-c6849b2b7aeb02df
  const provider = "pandadoc";
  
  try {
    // Query D1 database for the user's PandaDoc credentials
    console.log(`🔍 Looking for ${provider} credentials for user: ${userId}`);
    
    const query = `SELECT * FROM tool_credentials WHERE user_id = '${userId}' AND provider = '${provider}'`;
    const command = `wrangler d1 execute MCP_DB --command "${query}" --json`;
    
    console.log(`📊 Executing: ${command}`);
    const result = execSync(command, { encoding: 'utf8' });
    
              let credentials: ToolCredential[] = [];
     try {
       const parsed = JSON.parse(result);
       console.log(`🔍 Raw query result:`, JSON.stringify(parsed, null, 2));
       
       // Handle D1 result format: array of result objects
       if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].results) {
         credentials = parsed[0].results;
       } else {
         credentials = [];
       }
     } catch (parseError) {
       console.error("❌ Failed to parse D1 query result:", parseError);
       console.error("Raw result:", result);
       process.exit(1);
     }
     
     if (!credentials || credentials.length === 0) {
       console.error(`❌ No ${provider} credentials found for user ${userId}`);
       console.error("   Make sure the user has authenticated with PandaDoc through the MCP server");
       console.error("   You can check available credentials with:");
       console.error(`   wrangler d1 execute MCP_DB --command "SELECT user_id, provider FROM tool_credentials"`);
       
       // Show available credentials for debugging
       try {
         const listQuery = "SELECT user_id, provider, created_at FROM tool_credentials ORDER BY created_at DESC";
         const listCommand = `wrangler d1 execute MCP_DB --command "${listQuery}" --json`;
         const listResult = execSync(listCommand, { encoding: 'utf8' });
         const listParsed = JSON.parse(listResult);
         const allCredentials = Array.isArray(listParsed) && listParsed.length > 0 ? listParsed[0].results : [];
         
         if (allCredentials.length > 0) {
           console.error("\n📋 Available credentials in database:");
           allCredentials.forEach((cred: any) => {
             console.error(`   - ${cred.user_id} → ${cred.provider}`);
           });
         } else {
           console.error("   No credentials found in database at all");
         }
       } catch (listError) {
         console.error("   Could not list available credentials:", listError);
       }
       
       process.exit(1);
     }
    
         const credential = credentials[0];
     console.log(`✅ Found ${provider} credentials for ${userId}`);
     
     // Handle timestamp formatting with null checks
     const createdDate = credential.created_at ? new Date(credential.created_at * 1000) : null;
     const updatedDate = credential.updated_at ? new Date(credential.updated_at * 1000) : null;
     
     console.log(`   Created: ${createdDate?.toISOString() || 'Unknown'}`);
     console.log(`   Updated: ${updatedDate?.toISOString() || 'Unknown'}`);
     
     // Check if token is expired
     if (credential.expires_at && credential.expires_at < Math.floor(Date.now() / 1000)) {
       const expiresDate = new Date(credential.expires_at * 1000);
       console.warn(`⚠️  Token appears to be expired (expires_at: ${expiresDate.toISOString()})`);
       console.warn("   The test might fail due to expired credentials");
     }
    
    // Test the token
    console.log("\n🧪 Testing token validity...");
    try {
      const testResponse = await fetch("https://api.pandadoc.com/public/v1/documents?count=1", {
        headers: {
          "Authorization": `Bearer ${credential.access_token}`,
          "Content-Type": "application/json"
        }
      });
      
      if (!testResponse.ok) {
        const errorText = await testResponse.text();
        console.error(`❌ Token test failed: ${testResponse.status} ${errorText}`);
        
        if (testResponse.status === 401) {
          console.error("   Token is likely expired or invalid");
          console.error("   Re-authenticate the user through the MCP server");
        }
        
        process.exit(1);
      }
      
             const testData = await testResponse.json() as { results?: any[] };
       console.log("✅ Token is valid!");
       console.log(`   API returned ${testData.results?.length || 0} documents`);
      
    } catch (error) {
      console.error("❌ Token validation failed:", error);
      process.exit(1);
    }
    
    // Set environment variable for tests
    process.env.PANDADOC_TEST_TOKEN = credential.access_token;
    
    // Save token info for reference
    const tokenData: TestToken = {
      accessToken: credential.access_token,
      expiresAt: credential.expires_at 
        ? new Date(credential.expires_at * 1000).toISOString()
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days default
      provider: credential.provider,
      userId: credential.user_id
    };
    
    writeFileSync(".pandadoc-test-token.json", JSON.stringify(tokenData, null, 2));
    console.log("💾 Token info saved to .pandadoc-test-token.json");
    
    console.log("\n🎉 Live test setup completed successfully!");
    console.log("   PANDADOC_TEST_TOKEN environment variable is set");
    console.log("   Integration tests will now use real API credentials");
    
  } catch (error) {
    console.error("❌ Setup failed:", error);
    
    if (error instanceof Error && error.message.includes("wrangler")) {
      console.error("\n💡 Troubleshooting:");
      console.error("   - Make sure Wrangler CLI is installed and authenticated");
      console.error("   - Check that the D1 database 'MCP_DB' exists and is accessible");
      console.error("   - Verify you're in the correct project directory");
      console.error("   - Try: wrangler d1 execute MCP_DB --command 'SELECT COUNT(*) FROM tool_credentials'");
    }
    
    process.exit(1);
  }
}

// Run setup if called directly
if (require.main === module) {
  setupLiveTests().catch(console.error);
}

export { setupLiveTests };