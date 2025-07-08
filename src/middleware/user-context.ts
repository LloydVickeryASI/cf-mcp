/**
 * User Context Middleware
 * 
 * Ensures user context is consistently available throughout the application
 * by extracting and validating user information from various authentication sources.
 */

export interface UserContext {
  id: string;
  email: string;
  name: string;
  source: 'oauth' | 'bearer' | 'session';
}

/**
 * Extract user context from request headers and authentication sources
 * Prioritizes established user context headers from main authentication
 */
export async function extractUserContext(request: Request, env?: any): Promise<UserContext | null> {
  // First, check for user context headers set by main authentication
  const userLogin = request.headers.get("X-User-Login");
  const userName = request.headers.get("X-User-Name");
  const userEmail = request.headers.get("X-User-Email");
  
  if (userLogin && userName && userEmail && userLogin !== "anonymous") {
    console.log(`🔍 Extracted user context from headers: ${userLogin}`);
    return {
      id: userLogin,
      email: userEmail,
      name: userName,
      source: 'oauth'
    };
  }

  // Fallback: Check for Authorization header with bearer token
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7); // Remove "Bearer " prefix
    
    // Handle lloyd-{secret} format
    if (token.startsWith("lloyd-")) {
      console.log(`🔍 Extracted user context from bearer token: lloyd`);
      return {
        id: "lloyd",
        email: "lloyd@asi.co.nz",
        name: "Lloyd Vickery",
        source: 'bearer'
      };
    }
    
    // Handle other token formats - extract user part before first dash
    const parts = token.split("-");
    if (parts.length >= 2) {
      const userId = parts[0];
      console.log(`🔍 Extracted user context from bearer token: ${userId}`);
      return {
        id: userId,
        email: `${userId}@example.com`,
        name: `User ${userId}`,
        source: 'bearer'
      };
    }
  }

  // Check for session cookies as final fallback
  if (env?.OAUTH_KV) {
    const cookies = request.headers.get("Cookie");
    const sessionId = cookies
      ?.split(";")
      .find((c) => c.trim().startsWith("user_session="))
      ?.split("=")[1];

    if (sessionId) {
      try {
        console.log(`🔍 Found user_session cookie: ${sessionId}`);
        const sessionData = await env.OAUTH_KV.get(`user_session:${sessionId}`);
        
        if (sessionData) {
          const session = JSON.parse(sessionData);
          
          // Check if session hasn't expired
          if (session.expires && Date.now() < session.expires) {
            console.log(`🔍 Valid session found for user: ${session.userId}`);
            return {
              id: session.userId,
              email: session.email,
              name: session.name,
              source: 'session'
            };
          } else {
            console.log(`⚠️ Session ${sessionId} has expired`);
            // Clean up expired session
            await env.OAUTH_KV.delete(`user_session:${sessionId}`);
          }
        } else {
          console.log(`⚠️ Session ${sessionId} not found in KV`);
        }
      } catch (error) {
        console.error(`❌ Error validating session ${sessionId}:`, error);
      }
    }
  }
  
  console.log(`⚠️ No user context found in request`);
  return null;
}

/**
 * Synchronous version that only checks headers (for compatibility)
 */
export function extractUserContextSync(request: Request): UserContext | null {
  // First, check for user context headers set by main authentication
  const userLogin = request.headers.get("X-User-Login");
  const userName = request.headers.get("X-User-Name");
  const userEmail = request.headers.get("X-User-Email");
  
  if (userLogin && userName && userEmail && userLogin !== "anonymous") {
    console.log(`🔍 Extracted user context from headers: ${userLogin}`);
    return {
      id: userLogin,
      email: userEmail,
      name: userName,
      source: 'oauth'
    };
  }

  // Fallback: Check for Authorization header with bearer token
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7); // Remove "Bearer " prefix
    
    // Handle lloyd-{secret} format
    if (token.startsWith("lloyd-")) {
      console.log(`🔍 Extracted user context from bearer token: lloyd`);
      return {
        id: "lloyd",
        email: "lloyd@asi.co.nz",
        name: "Lloyd Vickery",
        source: 'bearer'
      };
    }
    
    // Handle other token formats - extract user part before first dash
    const parts = token.split("-");
    if (parts.length >= 2) {
      const userId = parts[0];
      console.log(`🔍 Extracted user context from bearer token: ${userId}`);
      return {
        id: userId,
        email: `${userId}@example.com`,
        name: `User ${userId}`,
        source: 'bearer'
      };
    }
  }

  console.log(`⚠️ No user context found in request headers`);
  return null;
}

/**
 * Create enhanced request with user context headers
 * Ensures user context is available to downstream handlers
 */
export function createRequestWithUserContext(
  request: Request, 
  userContext: UserContext
): Request {
  return new Request(request, {
    headers: {
      ...Object.fromEntries(request.headers.entries()),
      "X-User-Login": userContext.id,
      "X-User-Name": userContext.name,
      "X-User-Email": userContext.email,
      "X-User-Source": userContext.source,
    },
  });
}

/**
 * Middleware function to ensure user context is available
 * Can be used as a wrapper for route handlers
 */
export function withUserContext<T extends any[]>(
  handler: (request: Request, userContext: UserContext, ...args: T) => Response | Promise<Response>
) {
  return async (request: Request, ...args: T): Promise<Response> => {
    const userContext = extractUserContextSync(request);
    
    if (!userContext) {
      return new Response(JSON.stringify({
        error: "authentication_required",
        error_description: "User context required but not found in request"
      }), { 
        status: 401,
        headers: { 
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer realm="mcp", error="authentication_required"`
        }
      });
    }

    // Create enhanced request with user context headers
    const enhancedRequest = createRequestWithUserContext(request, userContext);
    
    return handler(enhancedRequest, userContext, ...args);
  };
} 