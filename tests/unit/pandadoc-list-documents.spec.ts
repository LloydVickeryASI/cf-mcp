/**
 * Unit tests for PandaDoc List Documents tool
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PandaDocClient } from "../../src/tools/pandadoc/client";
import mockResponse from "../__recordings__/pandadoc-list-documents.json";

describe("PandaDoc List Documents", () => {
  let client: PandaDocClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock the global fetch function
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    
    // Create client with test token
    client = new PandaDocClient("test-token");
  });

  describe("listDocuments", () => {
    it("should fetch documents successfully", async () => {
      // Setup mock response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse.response.body
      });

      // Call the method
      const result = await client.listDocuments();

      // Verify the request was made correctly
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.pandadoc.com/public/v1/documents",
        {
          method: "GET",
          headers: {
            "Authorization": "Bearer test-token",
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: undefined
        }
      );

      // Verify the response
      expect(result).toEqual(mockResponse.response.body.results);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty("id", "doc_12345");
      expect(result[0]).toHaveProperty("name", "Test Contract");
      expect(result[0]).toHaveProperty("status", "document.draft");
      expect(result[1]).toHaveProperty("id", "doc_67890");
      expect(result[1]).toHaveProperty("status", "document.sent");
    });

    it("should handle status filter parameter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
      });

      await client.listDocuments({ status: "document.sent" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.pandadoc.com/public/v1/documents?status=document.sent",
        expect.objectContaining({
          method: "GET"
        })
      );
    });

    it("should handle count and page parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
      });

      await client.listDocuments({ count: 10, page: 2 });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.pandadoc.com/public/v1/documents?count=10&page=2",
        expect.objectContaining({
          method: "GET"
        })
      );
    });

    it("should handle API errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized"
      });

      await expect(client.listDocuments()).rejects.toThrow(
        "PandaDoc API error: 401 Unauthorized"
      );
    });

    it("should handle empty results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
      });

      const result = await client.listDocuments();
      expect(result).toEqual([]);
    });

    it("should handle missing results field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({})
      });

      const result = await client.listDocuments();
      expect(result).toEqual([]);
    });
  });

  describe("Document structure validation", () => {
    it("should validate document has required fields", () => {
      const documents = mockResponse.response.body.results;
      
      documents.forEach(doc => {
        expect(doc).toHaveProperty("id");
        expect(doc).toHaveProperty("name");
        expect(doc).toHaveProperty("status");
        expect(doc).toHaveProperty("date_created");
        expect(doc).toHaveProperty("date_modified");
        expect(doc).toHaveProperty("recipients");
        expect(Array.isArray(doc.recipients)).toBe(true);
      });
    });

    it("should validate recipient structure", () => {
      const documents = mockResponse.response.body.results;
      
      documents.forEach(doc => {
        doc.recipients.forEach(recipient => {
          expect(recipient).toHaveProperty("email");
          expect(recipient).toHaveProperty("first_name");
          expect(recipient).toHaveProperty("last_name");
          expect(recipient).toHaveProperty("role");
        });
      });
    });

    it("should validate optional fields", () => {
      const documents = mockResponse.response.body.results;
      const sentDoc = documents.find(doc => doc.status === "document.sent");
      
      expect(sentDoc).toHaveProperty("expiration_date");
      expect(sentDoc).toHaveProperty("grand_total");
      expect(sentDoc?.grand_total).toHaveProperty("amount");
      expect(sentDoc?.grand_total).toHaveProperty("currency");
    });
  });
});