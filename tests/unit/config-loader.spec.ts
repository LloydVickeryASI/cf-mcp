/**
 * Unit tests for configuration loader
 * 
 * Tests the configuration loading and validation logic without external dependencies
 */

import { describe, it, expect } from "vitest";
import { loadConfig, isToolEnabled, isOperationEnabled } from "../../src/config/loader";
import type { SecretsEnv } from "../../src/config/mcp.secrets.schema";

describe("Configuration Loader", () => {
  const mockEnv: SecretsEnv = {
    MICROSOFT_CLIENT_ID: "test-client-id",
    MICROSOFT_CLIENT_SECRET: "test-client-secret", 
    MICROSOFT_TENANT_ID: "test-tenant-id",
    PANDADOC_CLIENT_ID: "pandadoc-client-id",
    PANDADOC_CLIENT_SECRET: "pandadoc-client-secret",
    HUBSPOT_CLIENT_ID: "hubspot-client-id",
    HUBSPOT_CLIENT_SECRET: "hubspot-client-secret",
    COOKIE_ENCRYPTION_KEY: "this-is-a-test-cookie-encryption-key-that-is-32-chars"
  };

  describe("loadConfig", () => {
    it("should load configuration with valid secrets", () => {
      const config = loadConfig(mockEnv);
      
      expect(config).toBeDefined();
      expect(config.oauth.clientId).toBe("test-client-id");
      expect(config.oauth.clientSecret).toBe("test-client-secret");
      expect(config.oauth.tenantId).toBe("test-tenant-id");
      expect(config.tools.pandadoc.clientId).toBe("pandadoc-client-id");
      expect(config.tools.hubspot.clientId).toBe("hubspot-client-id");
    });

    it("should validate required secrets", () => {
      const invalidEnv = { ...mockEnv };
      delete invalidEnv.MICROSOFT_CLIENT_ID;
      
      expect(() => loadConfig(invalidEnv)).toThrow();
    });

    it("should merge defaults with environment secrets", () => {
      const config = loadConfig(mockEnv);
      
      // Should have defaults
      expect(config.oauth.provider).toBe("microsoft");
      expect(config.oauth.scopes).toContain("openid");
      expect(config.tools.pandadoc.enabled).toBe(true);
      
      // Should have environment overrides
      expect(config.oauth.clientId).toBe(mockEnv.MICROSOFT_CLIENT_ID);
    });
  });

  describe("isToolEnabled", () => {
    it("should return true for enabled tools", () => {
      const config = loadConfig(mockEnv);
      expect(isToolEnabled(config, "pandadoc")).toBe(true);
    });

    it("should return false for disabled tools", () => {
      const config = loadConfig(mockEnv);
      expect(isToolEnabled(config, "xero")).toBe(false); // Disabled by default
    });

    it("should return false for non-existent tools", () => {
      const config = loadConfig(mockEnv);
      expect(isToolEnabled(config, "nonexistent" as any)).toBe(false);
    });
  });

  describe("isOperationEnabled", () => {
    it("should return true for enabled operations", () => {
      const config = loadConfig(mockEnv);
      expect(isOperationEnabled(config, "pandadoc", "sendDocument")).toBe(true);
    });

    it("should return false for disabled operations", () => {
      const config = loadConfig(mockEnv);
      expect(isOperationEnabled(config, "pandadoc", "listTemplates")).toBe(false);
    });

    it("should return false if parent tool is disabled", () => {
      const config = loadConfig(mockEnv);
      expect(isOperationEnabled(config, "xero", "createInvoice")).toBe(false);
    });

    it("should default to enabled if operation not specified", () => {
      const config = loadConfig(mockEnv);
      expect(isOperationEnabled(config, "pandadoc", "getStatus")).toBe(true);
    });
  });
});