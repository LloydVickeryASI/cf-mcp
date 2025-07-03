import { defaults, type MCPConfig } from "./mcp.defaults";
import { secretsSchema, type SecretsEnv } from "./mcp.secrets.schema";

export function loadConfig(env: SecretsEnv): MCPConfig {
  // Validate secrets against schema
  const validatedSecrets = secretsSchema.parse(env);

  return {
    ...defaults,
    oauth: {
      provider: defaults.oauth.provider,
      scopes: [...defaults.oauth.scopes],
      redirectUri: defaults.oauth.redirectUri,
      clientId: validatedSecrets.MICROSOFT_CLIENT_ID,
      clientSecret: validatedSecrets.MICROSOFT_CLIENT_SECRET,
      tenantId: validatedSecrets.MICROSOFT_TENANT_ID,
    },
    tools: {
      ...defaults.tools,
      pandadoc: {
        ...defaults.tools.pandadoc,
        clientId: validatedSecrets.PANDADOC_CLIENT_ID,
        clientSecret: validatedSecrets.PANDADOC_CLIENT_SECRET,
      },
      hubspot: {
        ...defaults.tools.hubspot,
        clientId: validatedSecrets.HUBSPOT_CLIENT_ID,
        clientSecret: validatedSecrets.HUBSPOT_CLIENT_SECRET,
      },
      xero: {
        ...defaults.tools.xero,
        clientId: validatedSecrets.XERO_CLIENT_ID || "",
        clientSecret: validatedSecrets.XERO_CLIENT_SECRET || "",
      },
      netsuite: {
        ...defaults.tools.netsuite,
        clientId: validatedSecrets.NETSUITE_CLIENT_ID || "",
        clientSecret: validatedSecrets.NETSUITE_CLIENT_SECRET || "",
      },
      autotask: {
        ...defaults.tools.autotask,
        clientId: validatedSecrets.AUTOTASK_CLIENT_ID || "",
        clientSecret: validatedSecrets.AUTOTASK_CLIENT_SECRET || "",
      },
    },
  };
}

// Helper function to get a specific tool's config
export function getToolConfig(config: MCPConfig, toolName: keyof MCPConfig["tools"]) {
  const tool = config.tools[toolName];
  if (!tool) {
    throw new Error(`Tool '${toolName}' not found in configuration`);
  }
  return tool;
}

// Helper function to check if a tool is enabled
export function isToolEnabled(config: MCPConfig, toolName: keyof MCPConfig["tools"]): boolean {
  const tool = config.tools[toolName];
  return tool?.enabled ?? false;
}

// Helper function to check if a specific tool operation is enabled
export function isOperationEnabled(
  config: MCPConfig, 
  toolName: keyof MCPConfig["tools"], 
  operationName: string
): boolean {
  const tool = config.tools[toolName];
  if (!tool?.enabled) return false;
  
  const operations = tool.operations as Record<string, { enabled?: boolean }> | undefined;
  const operation = operations?.[operationName];
  return operation?.enabled ?? true; // Default to enabled if not specified
} 