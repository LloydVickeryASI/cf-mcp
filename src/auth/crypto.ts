/**
 * Cryptographic utilities for secure token storage
 * 
 * Uses Web Crypto API to encrypt/decrypt sensitive data like OAuth tokens
 */

export class TokenEncryption {
	private key: CryptoKey | null = null;

	constructor(private encryptionKey: string) {}

	/**
	 * Initialize the encryption key from the environment secret
	 */
	private async getKey(): Promise<CryptoKey> {
		if (this.key) return this.key;

		// Convert hex string to Uint8Array
		const keyData = new Uint8Array(
			this.encryptionKey.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
		);

		// Import the key for AES-GCM encryption
		this.key = await crypto.subtle.importKey(
			'raw',
			keyData,
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt']
		);

		return this.key;
	}

	/**
	 * Encrypt sensitive data
	 */
	async encrypt(data: string): Promise<string> {
		const key = await this.getKey();
		
		// Generate a random IV for each encryption
		const iv = crypto.getRandomValues(new Uint8Array(12));
		
		// Encode the data as UTF-8
		const encoder = new TextEncoder();
		const encodedData = encoder.encode(data);
		
		// Encrypt the data
		const encryptedData = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			key,
			encodedData
		);
		
		// Combine IV and encrypted data
		const combined = new Uint8Array(iv.length + encryptedData.byteLength);
		combined.set(iv, 0);
		combined.set(new Uint8Array(encryptedData), iv.length);
		
		// Return as base64
		return btoa(String.fromCharCode(...combined));
	}

	/**
	 * Decrypt sensitive data
	 */
	async decrypt(encryptedData: string): Promise<string> {
		const key = await this.getKey();
		
		// Decode from base64
		const combined = new Uint8Array(
			atob(encryptedData).split('').map(char => char.charCodeAt(0))
		);
		
		// Extract IV and encrypted data
		const iv = combined.slice(0, 12);
		const data = combined.slice(12);
		
		// Decrypt the data
		const decryptedData = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv },
			key,
			data
		);
		
		// Decode from UTF-8
		const decoder = new TextDecoder();
		return decoder.decode(decryptedData);
	}
}

/**
 * Generate a secure encryption key for first-time setup
 */
export function generateEncryptionKey(): string {
	const key = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(key)
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('');
}