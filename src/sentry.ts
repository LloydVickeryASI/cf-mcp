/**
 * Sentry Configuration for Cloudflare Worker
 * 
 * Provides centralized configuration for Sentry monitoring
 * with appropriate sampling and tracing for production use
 */

import * as Sentry from "@sentry/cloudflare";

export interface SentryConfig {
  dsn: string;
  tracesSampleRate: number;
  environment?: string;
  release?: string;
  _experiments?: {
    enableLogs?: boolean;
  };
}

/**
 * Create Sentry configuration from environment variables
 */
export const sentryCfg = (env: Env): SentryConfig | null => {
  if (!env.SENTRY_DSN) {
    return null;
  }
  
  return {
    dsn: env.SENTRY_DSN,
    tracesSampleRate: parseFloat(env.SENTRY_SAMPLE_RATE || "0.1"), // Default 10% sampling
    environment: env.ENVIRONMENT || "development",
    release: env.SENTRY_RELEASE || undefined,
    _experiments: {
      enableLogs: env.SENTRY_ENABLE_LOGS === "true" // Opt-in Sentry Logs (beta)
    },
  };
};

/**
 * Initialize Sentry for the Worker
 */
export const initSentry = (env: Env): SentryConfig | null => {
  if (!env.SENTRY_DSN) {
    console.log("Sentry DSN not configured, skipping initialization");
    return null;
  }

  const config = sentryCfg(env);
  if (!config) {
    return null;
  }
  
  console.log(`Initializing Sentry with environment: ${config.environment}, sampling: ${config.tracesSampleRate}`);
  
  return config;
};

/**
 * Capture exception with context
 */
export const captureException = (error: Error, context?: Record<string, any>) => {
  Sentry.withScope((scope: any) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setContext(key, value);
      });
    }
    Sentry.captureException(error);
  });
};

/**
 * Capture message with level and context
 */
export const captureMessage = (
  message: string, 
  level: "debug" | "info" | "warning" | "error" | "fatal" = "info",
  context?: Record<string, any>
) => {
  Sentry.withScope((scope: any) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setContext(key, value);
      });
    }
    Sentry.captureMessage(message, level);
  });
};

/**
 * Add breadcrumb for tracking user actions
 */
export const addBreadcrumb = (message: string, category?: string, data?: Record<string, any>) => {
  Sentry.addBreadcrumb({
    message,
    category: category || "action",
    level: "info",
    data,
    timestamp: Date.now() / 1000,
  });
};