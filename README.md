
# Model Context Protocol (MCP) Server with Microsoft OAuth

This project implements a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) gateway on Cloudflare Workers. It authenticates users via **Microsoft Azure AD** and stores per‑tool credentials in a D1 database.

Deploy it to your own Cloudflare account and create an Azure AD application to obtain a working remote MCP server. Users authenticate with Microsoft before accessing your tools.

You can use this as a reference example for how to integrate other OAuth providers with an MCP server deployed to Cloudflare, using the [`workers-oauth-provider` library](https://github.com/cloudflare/workers-oauth-provider).

The MCP server (powered by [Cloudflare Workers](https://developers.cloudflare.com/workers/)): 

* Acts as OAuth _Server_ to your MCP clients
* Acts as OAuth _Client_ to Microsoft Azure AD

## Getting Started

Clone the repo directly & install dependencies: `pnpm install`.

**Note**: This project uses **pnpm** as the package manager, which matches Cloudflare Pages' default and prevents deployment issues.

Alternatively, you can use the command line below to get the remote MCP Server created on your local machine:
```bash
npm create cloudflare@latest -- my-mcp-server --template=cloudflare/ai/demos/remote-mcp-github-oauth
```

### For Production
Create an **Azure AD Application** and record its client ID, tenant ID and secret. Set the secrets via Wrangler:
```bash
wrangler secret put MICROSOFT_CLIENT_ID
wrangler secret put MICROSOFT_CLIENT_SECRET
wrangler secret put MICROSOFT_TENANT_ID
```
#### Set up a KV namespace
- Create the KV namespace: 
`wrangler kv:namespace create "OAUTH_KV"`
- Update the Wrangler file with the KV ID

#### Deploy & Test
Deploy the MCP server to make it available on your workers.dev domain 
` wrangler deploy`

#### GitHub Actions Setup (Optional)
For automatic PR preview deployments, add these secrets to your GitHub repository (**Settings → Secrets and variables → Actions**):

| Secret | Description | How to get it |
|--------|-------------|---------------|
| `CLOUDFLARE_API_TOKEN` | API token for Wrangler deployments | Cloudflare Dashboard → My Profile → API Tokens → Create Token |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID | Cloudflare Dashboard → Right sidebar |

This enables automatic preview deployments at `https://cf-mcp-pr-<PR_NUMBER>.asi-cloud.workers.dev` for every pull request.

Test the remote server using [Inspector](https://modelcontextprotocol.io/docs/tools/inspector): 

```
npx @modelcontextprotocol/inspector@latest
```
Enter `https://<your-worker>.<your-subdomain>.workers.dev/sse` and hit connect. Once you go through the authentication flow, you'll see the Tools working:

<img width="640" alt="image" src="https://github.com/user-attachments/assets/7973f392-0a9d-4712-b679-6dd23f824287" />

You now have a remote MCP server deployed! 

### Access Control

This MCP server uses Microsoft OAuth for authentication. Tool access can be limited per user through configuration.

### OAuth Setup and MCP Inspector Testing

The MCP server implements OAuth 2.1 with PKCE and is fully compatible with the MCP Inspector's OAuth flow. This allows you to test the complete authentication flow during development.

#### Testing OAuth with MCP Inspector

1. **Start the development server**:
   ```bash
   pnpm dev
   # Server runs on http://localhost:8788
   ```

2. **Test with MCP Inspector's OAuth flow**:
   ```bash
   npx @modelcontextprotocol/inspector
   ```
   
3. **Connect to the server**:
   - Enter URL: `http://localhost:8788/mcp`
   - Click Connect
   - The Inspector will automatically detect OAuth support and guide you through:
     - Metadata Discovery (RFC 9728 & RFC 8414)
     - Dynamic Client Registration (RFC 7591)
     - Authorization Code Flow with PKCE
     - Token Exchange

4. **OAuth Flow Details**:
   - The server implements all required OAuth 2.1 endpoints:
     - `/.well-known/oauth-authorization-server` - Authorization server metadata
     - `/.well-known/oauth-protected-resource/mcp` - Protected resource metadata
     - `/register` - Dynamic client registration
     - `/authorize` - Authorization endpoint (redirects to Microsoft)
     - `/token` - Token exchange endpoint
   - CORS headers are properly configured for all endpoints
   - PKCE is mandatory for all public clients

5. **After successful authentication**:
   - The Inspector will display all available tools
   - You can test tool execution with proper authentication context
   - The server maintains user session state via Durable Objects

#### Troubleshooting OAuth Issues

- **"Failed to fetch" errors**: Ensure all OAuth endpoints have proper CORS headers
- **Authorization failures**: Check that Microsoft OAuth app is properly configured
- **Token errors**: Verify PKCE code verifier matches the challenge
- **Check server logs** for detailed error messages during OAuth flow

### Access the remote MCP server from Claude Desktop

Open Claude Desktop and navigate to Settings -> Developer -> Edit Config. This opens the configuration file that controls which MCP servers Claude can access.

Replace the content with the following configuration. Once you restart Claude Desktop, a browser window will open showing your OAuth login page. Complete the authentication flow to grant Claude access to your MCP server. After you grant access, the tools will become available for you to use. 

```
{
  "mcpServers": {
    "math": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<your-worker>.<your-subdomain>.workers.dev/sse"
      ]
    }
  }
}
```

Once the Tools (under 🔨) show up in the interface, you can ask Claude to use them. For example: "Could you use the math tool to add 23 and 19?". Claude should invoke the tool and show the result generated by the MCP server.

### For Local Development
If you'd like to iterate and test your MCP server locally, create another Azure AD application:
- For the Homepage URL, specify `http://localhost:8788`
- For the Authorization callback URL, specify `http://localhost:8788/callback`
- Note your Client ID, secret and tenant ID.
- Create a `.dev.vars` file in your project root with:
```
MICROSOFT_CLIENT_ID=your_dev_client_id
MICROSOFT_CLIENT_SECRET=your_dev_client_secret
MICROSOFT_TENANT_ID=your_tenant_id
```

#### Develop & Test
Run the server locally to make it available at `http://localhost:8788`
`wrangler dev`

To test the local server, enter `http://localhost:8788/sse` into Inspector and hit connect. Once you follow the prompts, you'll be able to "List Tools". 

#### Using Claude and other MCP Clients

When using Claude to connect to your remote MCP server, you may see some error messages. This is because Claude Desktop doesn't yet support remote MCP servers, so it sometimes gets confused. To verify whether the MCP server is connected, hover over the 🔨 icon in the bottom right corner of Claude's interface. You should see your tools available there.

#### Using Cursor and other MCP Clients

To connect Cursor with your MCP server, choose `Type`: "Command" and in the `Command` field, combine the command and args fields into one (e.g. `npx mcp-remote https://<your-worker-name>.<your-subdomain>.workers.dev/sse`).

Note that while Cursor supports HTTP+SSE servers, it doesn't support authentication, so you still need to use `mcp-remote` (and to use a STDIO server, not an HTTP one).

You can connect your MCP server to other MCP clients like Windsurf by opening the client's configuration file, adding the same JSON that was used for the Claude setup, and restarting the MCP client.

## How does it work? 

#### OAuth Provider
The OAuth Provider library serves as a complete OAuth 2.1 server implementation for Cloudflare Workers. It handles the complexities of the OAuth flow, including token issuance, validation, and management. In this project, it plays the dual role of:

- Authenticating MCP clients that connect to your server
- Managing the connection to Microsoft's OAuth services
- Securely storing tokens in D1 (KV is used only for the OAuth server)

#### Durable MCP
Durable MCP extends the base MCP functionality with Cloudflare's Durable Objects, providing:
- Persistent state management for your MCP server
- Secure storage of authentication context between requests
- Access to authenticated user information via `this.props`
- Support for conditional tool availability based on user identity

#### MCP Remote
The MCP Remote library enables your server to expose tools that can be invoked by MCP clients like the Inspector. It:
- Defines the protocol for communication between clients and your server
- Provides a structured way to define tools
- Handles serialization and deserialization of requests and responses
- Maintains the Server-Sent Events (SSE) connection between clients and your server
