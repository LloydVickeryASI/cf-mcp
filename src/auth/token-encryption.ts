/**
 * Token encryption utilities for secure storage
 * Uses Web Crypto API for AES-GCM encryption
 */

import { ToolError } from "@/types";

/**
 * Derives an encryption key from the provided secret
 */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("mcp-token-salt"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a token using AES-GCM
 */
export async function encryptToken(
  token: string,
  encryptionKey: string
): Promise<string> {
  try {
    const key = await deriveKey(encryptionKey);
    const encoder = new TextEncoder();
    const data = encoder.encode(token);

    // Generate a random IV for each encryption
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encryptedData = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      data
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encryptedData.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encryptedData), iv.length);

    // Return base64-encoded result
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    throw new ToolError(
      "Failed to encrypt token",
      "ENCRYPTION_ERROR",
      500
    );
  }
}

/**
 * Decrypts a token using AES-GCM
 */
export async function decryptToken(
  encryptedToken: string,
  encryptionKey: string
): Promise<string> {
  try {
    const key = await deriveKey(encryptionKey);
    
    // Decode from base64
    const combined = Uint8Array.from(
      atob(encryptedToken),
      (c) => c.charCodeAt(0)
    );

    // Extract IV and encrypted data
    const iv = combined.slice(0, 12);
    const encryptedData = combined.slice(12);

    const decryptedData = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      encryptedData
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedData);
  } catch (error) {
    throw new ToolError(
      "Failed to decrypt token",
      "DECRYPTION_ERROR",
      500
    );
  }
}

/**
 * Validates that an encryption key is properly configured
 */
export function validateEncryptionKey(key: string | undefined): string {
  if (!key) {
    throw new ToolError(
      "COOKIE_ENCRYPTION_KEY environment variable is not set",
      "MISSING_ENCRYPTION_KEY",
      500
    );
  }

  // Key should be at least 32 characters (256 bits)
  if (key.length < 32) {
    throw new ToolError(
      "COOKIE_ENCRYPTION_KEY must be at least 32 characters long",
      "INVALID_ENCRYPTION_KEY",
      500
    );
  }

  return key;
}

/**
 * Token storage wrapper with automatic encryption/decryption
 */
export class EncryptedTokenStorage {
  private encryptionKey: string;

  constructor(encryptionKey: string) {
    this.encryptionKey = validateEncryptionKey(encryptionKey);
  }

  /**
   * Store an encrypted token
   */
  async store(
    db: D1Database,
    userId: string,
    provider: string,
    accessToken: string,
    refreshToken?: string,
    expiresAt?: Date
  ): Promise<void> {
    const encryptedAccess = await encryptToken(accessToken, this.encryptionKey);
    const encryptedRefresh = refreshToken
      ? await encryptToken(refreshToken, this.encryptionKey)
      : null;

    await db
      .prepare(
        `INSERT OR REPLACE INTO tool_credentials 
         (user_id, provider, access_token, refresh_token, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(userId, provider, encryptedAccess, encryptedRefresh, expiresAt?.toISOString() || null)
      .run();
  }

  /**
   * Retrieve and decrypt a token
   */
  async retrieve(
    db: D1Database,
    userId: string,
    provider: string
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  } | null> {
    const result = await db
      .prepare(
        `SELECT access_token, refresh_token, expires_at
         FROM tool_credentials
         WHERE user_id = ? AND provider = ?`
      )
      .bind(userId, provider)
      .first();

    if (!result) {
      return null;
    }

    const accessToken = await decryptToken(
      result.access_token as string,
      this.encryptionKey
    );

    const refreshToken = result.refresh_token
      ? await decryptToken(result.refresh_token as string, this.encryptionKey)
      : undefined;

    return {
      accessToken,
      refreshToken,
      expiresAt: result.expires_at ? new Date(result.expires_at as string) : undefined,
    };
  }

  /**
   * Remove tokens for a user/provider
   */
  async remove(
    db: D1Database,
    userId: string,
    provider: string
  ): Promise<void> {
    await db
      .prepare(
        `DELETE FROM tool_credentials WHERE user_id = ? AND provider = ?`
      )
      .bind(userId, provider)
      .run();
  }
}