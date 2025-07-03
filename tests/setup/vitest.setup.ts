/**
 * Vitest setup file
 * 
 * Initializes PollyJS for HTTP recording/replay and mock OAuth server
 */

import { Polly } from "@pollyjs/core";
import FetchAdapter from "@pollyjs/adapter-fetch";
import FSPersister from "@pollyjs/persister-fs";
import { beforeAll, afterAll, afterEach } from "vitest";
import { startMockOAuthServer, type MockOAuthServer } from "./helpers/mockOAuth";

// Register PollyJS adapters
Polly.register(FetchAdapter);
Polly.register(FSPersister);

let polly: Polly;
let oauthServer: MockOAuthServer;

beforeAll(async () => {
  // Start mock OAuth server
  oauthServer = await startMockOAuthServer();
  
  // Set OAuth environment variables for tests
  process.env.OAUTH_ISSUER = oauthServer.issuer();
  process.env.OAUTH_AUDIENCE = "mcp-client";
  process.env.TEST_OAUTH_SERVER = oauthServer.issuer();

  // Initialize PollyJS
  const isRecording = process.env.RECORD === "1";
  
  polly = new Polly("mcp-tool-calls", {
    adapters: ["fetch"],
    mode: isRecording ? "record" : "replay",
    recordIfMissing: isRecording,
    persister: "fs",
    persisterOptions: {
      fs: {
        recordingsDir: "./tests/__recordings__"
      }
    },
    
    // Configure which requests to record/replay
    matchRequestsBy: {
      method: true,
      headers: false, // Don't match on headers to avoid auth issues
      body: true,
      order: true,
      url: {
        protocol: true,
        username: false,
        password: false,
        hostname: true,
        port: true,
        pathname: true,
        query: true,
        hash: false
      }
    },

    // Request and response configuration
    recordFailedRequests: true
  });

  // Configure PollyJS rules
  polly.configure({
    logging: process.env.NODE_ENV === "test" ? false : true
  });

  // Scrub sensitive data before saving recordings
  polly.server.any().on("beforePersist", (req, recording) => {
    // Remove authorization headers
    delete recording.request.headers.authorization;
    delete recording.request.headers.Authorization;
    
    // Remove sensitive query parameters
    if (recording.request.url) {
      const url = new URL(recording.request.url);
      url.searchParams.delete("client_secret");
      url.searchParams.delete("api_key");
      recording.request.url = url.toString();
    }
    
    // Scrub response body for sensitive data
    if (recording.response.content?.text) {
      try {
        const body = JSON.parse(recording.response.content.text);
        if (body.access_token) {
          body.access_token = "REDACTED_ACCESS_TOKEN";
        }
        if (body.refresh_token) {
          body.refresh_token = "REDACTED_REFRESH_TOKEN";
        }
        if (body.client_secret) {
          body.client_secret = "REDACTED_CLIENT_SECRET";
        }
        recording.response.content.text = JSON.stringify(body);
      } catch {
        // Not JSON, leave as-is
      }
    }
  });

  // Pass through requests to mock OAuth server
  polly.server.any(`${oauthServer.issuer()}/*`).passthrough();
  
  // Pass through localhost requests (for development)
  polly.server.any("http://localhost:*").passthrough();
  polly.server.any("https://localhost:*").passthrough();
  
  console.log(`🎬 PollyJS initialized in ${isRecording ? "RECORD" : "REPLAY"} mode`);
  console.log(`🔐 Mock OAuth server running at ${oauthServer.issuer()}`);
});

afterEach(async () => {
  // Flush PollyJS after each test
  if (polly) {
    await polly.flush();
  }
});

afterAll(async () => {
  // Clean up resources
  if (polly) {
    await polly.stop();
  }
  
  if (oauthServer) {
    await oauthServer.stop();
  }
  
  console.log("🧹 Test cleanup completed");
});

// Export for use in tests
export { oauthServer };