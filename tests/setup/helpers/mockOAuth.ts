/**
 * Mock OAuth2 server for testing
 * 
 * Provides controllable JWTs without external IdP for testing OAuth flows
 */

import { createServer, type Server } from "http";
import { URL } from "url";

export interface MockOAuthServer {
  issuer(): string;
  stop(): Promise<void>;
  generateToken(payload: Record<string, any>): string;
}

export async function startMockOAuthServer(port = 0): Promise<MockOAuthServer> {
  let server: Server;
  let actualPort: number;

  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${actualPort}`);
      
      // Enable CORS
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      
      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      // OAuth endpoints
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({
          issuer: `http://localhost:${actualPort}`,
          authorization_endpoint: `http://localhost:${actualPort}/authorize`,
          token_endpoint: `http://localhost:${actualPort}/token`,
          jwks_uri: `http://localhost:${actualPort}/.well-known/jwks.json`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["openid", "profile", "mcp:tools"]
        }));
        return;
      }

      if (url.pathname === "/.well-known/jwks.json") {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({
          keys: [{
            kty: "RSA",
            use: "sig",
            kid: "test-key",
            n: "test-modulus",
            e: "AQAB"
          }]
        }));
        return;
      }

      if (url.pathname === "/token" && req.method === "POST") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
          const params = new URLSearchParams(body);
          const grantType = params.get("grant_type");
          
          if (grantType === "authorization_code") {
            const accessToken = generateMockToken({
              sub: "test-user",
              aud: "mcp-client",
              scope: "mcp:tools",
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 3600
            });
            
            res.setHeader("Content-Type", "application/json");
            res.writeHead(200);
            res.end(JSON.stringify({
              access_token: accessToken,
              token_type: "Bearer",
              expires_in: 3600,
              scope: "mcp:tools"
            }));
            return;
          }
          
          res.writeHead(400);
          res.end(JSON.stringify({ error: "unsupported_grant_type" }));
        });
        return;
      }

      // Default 404
      res.writeHead(404);
      res.end("Not Found");
    });

    server.listen(port, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        actualPort = address.port;
        
        const mockServer: MockOAuthServer = {
          issuer: () => `http://localhost:${actualPort}`,
          stop: () => new Promise((resolve) => {
            server.close(() => resolve());
          }),
          generateToken: generateMockToken
        };
        
        resolve(mockServer);
      } else {
        reject(new Error("Failed to start mock OAuth server"));
      }
    });

    server.on("error", reject);
  });
}

/**
 * Generate a mock JWT token (not cryptographically signed, for testing only)
 */
function generateMockToken(payload: Record<string, any>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/[+/=]/g, (match) => 
    ({ "+": "-", "/": "_", "=": "" }[match] || match)
  );
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/[+/=]/g, (match) => 
    ({ "+": "-", "/": "_", "=": "" }[match] || match)
  );
  const signature = "mock-signature";
  
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}