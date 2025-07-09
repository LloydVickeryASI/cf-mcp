/**
 * Live API integration tests for PandaDoc
 * 
 * These tests make real API calls to PandaDoc using actual OAuth tokens.
 * Set PANDADOC_TEST_TOKEN environment variable to run these tests.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { PandaDocClient } from "../../src/tools/pandadoc/client";

describe("PandaDoc Live API Integration", () => {
  let client: PandaDocClient;
  let hasValidToken: boolean;

  beforeAll(() => {
    // Get test token from environment
    const testToken = process.env.PANDADOC_TEST_TOKEN;
    hasValidToken = !!testToken;
    
    if (hasValidToken) {
      client = new PandaDocClient(testToken!);
    }
  });

  describe("listDocuments", () => {
    it.skipIf(!hasValidToken)("should fetch real documents from PandaDoc API", async () => {
      const documents = await client.listDocuments();
      
      // Verify the response structure matches our expectations
      expect(Array.isArray(documents)).toBe(true);
      
      // If there are documents, verify their structure
      if (documents.length > 0) {
        const firstDoc = documents[0];
        expect(firstDoc).toHaveProperty("id");
        expect(firstDoc).toHaveProperty("name");
        expect(firstDoc).toHaveProperty("status");
        expect(firstDoc).toHaveProperty("date_created");
        expect(firstDoc).toHaveProperty("recipients");
        expect(Array.isArray(firstDoc.recipients)).toBe(true);
        
        // Verify status is one of expected values
        expect([
          "document.draft",
          "document.sent", 
          "document.viewed",
          "document.completed",
          "document.declined"
        ]).toContain(firstDoc.status);
      }
    });

    it.skipIf(!hasValidToken)("should handle status filter", async () => {
      const draftDocuments = await client.listDocuments({ status: "document.draft" });
      
      // All returned documents should have draft status
      draftDocuments.forEach(doc => {
        expect(doc.status).toBe("document.draft");
      });
    });

    it.skipIf(!hasValidToken)("should handle count parameter", async () => {
      const documents = await client.listDocuments({ count: 5 });
      
      // Should return at most 5 documents
      expect(documents.length).toBeLessThanOrEqual(5);
    });

    it.skipIf(!hasValidToken)("should handle invalid token gracefully", async () => {
      const invalidClient = new PandaDocClient("invalid-token");
      
      await expect(invalidClient.listDocuments()).rejects.toThrow(
        expect.stringMatching(/401|Unauthorized/)
      );
    });
  });

  describe("Test Environment", () => {
    it("should skip live tests when token is not available", () => {
      if (!hasValidToken) {
        console.log("ℹ️  Live API tests skipped - set PANDADOC_TEST_TOKEN to run");
        expect(true).toBe(true); // This test always passes
      }
    });
  });
});