/**
 * Unit tests for OAuth wrapper utility
 */

import { describe, it, expect, vi } from "vitest";
import { requiresAuth } from "../../src/auth/withOAuth";

describe("OAuth Wrapper Utilities", () => {
  describe("requiresAuth", () => {
    it("should detect auth required responses", () => {
      const authResponse = {
        requiresAuth: true,
        provider: "pandadoc",
        authUrl: "https://example.com/auth",
        message: "Please authenticate"
      };

      expect(requiresAuth(authResponse)).toBe(true);
    });

    it("should detect non-auth responses", () => {
      const regularResponse = {
        content: [{ type: "text", text: "Success" }]
      };

      expect(requiresAuth(regularResponse)).toBe(false);
    });

    it("should handle null/undefined responses", () => {
      expect(requiresAuth(null)).toBeFalsy();
      expect(requiresAuth(undefined)).toBeFalsy();
    });

    it("should handle responses with requiresAuth: false", () => {
      const response = {
        requiresAuth: false,
        data: "some data"
      };

      expect(requiresAuth(response)).toBe(false);
    });
  });
});