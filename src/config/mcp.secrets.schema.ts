import { z } from "zod";

export const secretsSchema = z.object({
  // Microsoft OAuth secrets
  MICROSOFT_CLIENT_ID: z.string().min(1, "Microsoft Client ID is required"),
  MICROSOFT_CLIENT_SECRET: z.string().min(1, "Microsoft Client Secret is required"),
  MICROSOFT_TENANT_ID: z.string().optional(),

  // PandaDoc secrets
  PANDADOC_CLIENT_ID: z.string().min(1, "PandaDoc Client ID is required"),
  PANDADOC_CLIENT_SECRET: z.string().min(1, "PandaDoc Client Secret is required"),

  // HubSpot secrets
  HUBSPOT_CLIENT_ID: z.string().min(1, "HubSpot Client ID is required"),
  HUBSPOT_CLIENT_SECRET: z.string().min(1, "HubSpot Client Secret is required"),

  // Xero secrets (optional since disabled by default)
  XERO_CLIENT_ID: z.string().optional(),
  XERO_CLIENT_SECRET: z.string().optional(),

  // NetSuite secrets (optional since disabled by default)
  NETSUITE_CLIENT_ID: z.string().optional(),
  NETSUITE_CLIENT_SECRET: z.string().optional(),

  // Autotask secrets (optional since disabled by default)
  AUTOTASK_CLIENT_ID: z.string().optional(),
  AUTOTASK_CLIENT_SECRET: z.string().optional(),

  // Cookie encryption key for session management
  COOKIE_ENCRYPTION_KEY: z.string().min(32, "Cookie encryption key must be at least 32 characters"),

  // Optional: Sentry DSN for error tracking
  SENTRY_DSN: z.string().optional(),
  SENTRY_SAMPLE_RATE: z.string().optional(),

  // Authorization header secret for per-tool auth (when OAuth is disabled)
  AUTH_HEADER_SECRET: z.string().min(8, "Auth header secret must be at least 8 characters").optional(),
});

export type SecretsEnv = z.infer<typeof secretsSchema>; 