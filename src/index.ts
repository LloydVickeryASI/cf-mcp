/**
 * Cloudflare Worker - ASI MCP Gateway
 * 
 * Multi-provider MCP server with Microsoft OAuth and per-tool authentication
 */

import { MicrosoftOAuthHandler } from "./auth/microsoft";
import { ModularMCP } from "./mcpServer";
import { createRepositories } from "./db/operations";
import { loadConfig } from "./config/loader";
import "./tools"; // Register all tools

export { ModularMCP as MCP };

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			const url = new URL(request.url);
			
			// Health check
			if (url.pathname === "/health") {
				return new Response("OK", { status: 200 });
			}

			// OAuth routes - Microsoft Azure AD
			if (url.pathname === "/auth") {
				const oauthHandler = new MicrosoftOAuthHandler(env);
				return await oauthHandler.handleAuthorize(request);
			}

			if (url.pathname === "/.auth/callback") {
				const oauthHandler = new MicrosoftOAuthHandler(env);
				return await oauthHandler.handleCallback(request);
			}

			// MCP endpoint - protected by Microsoft OAuth
			if (url.pathname === "/mcp") {
				return await handleMcpRequest(request, env, ctx);
			}

			// Root redirect to MCP
			if (url.pathname === "/") {
				return Response.redirect(new URL("/mcp", url.origin).toString(), 302);
			}

			return new Response("Not Found", { status: 404 });

		} catch (error) {
			console.error("Worker error:", error);
			return new Response("Internal Server Error", { status: 500 });
		}
	},
};

/**
 * Handle MCP requests with session verification
 */
async function handleMcpRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	try {
		// Get session from cookie
		const cookies = request.headers.get("Cookie");
		const sessionToken = cookies
			?.split(";")
			.find((c) => c.trim().startsWith("mcp_session="))
			?.split("=")[1];

		if (!sessionToken) {
			return Response.redirect(new URL("/auth", request.url).toString(), 302);
		}

		// Verify session token
		const session = await MicrosoftOAuthHandler.verifySessionToken(sessionToken);
		if (!session) {
			return Response.redirect(new URL("/auth", request.url).toString(), 302);
		}

		// Create MCP Durable Object
		const mcpId = env.MCP_OBJECT.idFromName("mcp-server");
		const mcpObject = env.MCP_OBJECT.get(mcpId);

		// Forward the request to the MCP Durable Object with user context
		const enhancedRequest = new Request(request, {
			headers: {
				...Object.fromEntries(request.headers.entries()),
				"X-User-Login": session.login,
				"X-User-Name": session.name,
				"X-User-Email": session.email,
			},
		});

		return await mcpObject.fetch(enhancedRequest);

	} catch (error) {
		console.error("MCP request error:", error);
		return new Response("Internal Server Error", { status: 500 });
	}
}

/**
 * Export Durable Object classes for Cloudflare binding
 */
export { ModularMCP } from "./mcpServer";
