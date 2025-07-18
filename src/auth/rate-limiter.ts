/**
 * Rate limiter for OAuth endpoints
 * 
 * Implements per-user and per-IP rate limiting using KV storage
 */

export interface RateLimitConfig {
	maxRequests: number;
	windowSeconds: number;
}

export class RateLimiter {
	private config: RateLimitConfig;

	constructor(config?: RateLimitConfig) {
		this.config = config || {
			maxRequests: 100,
			windowSeconds: 60 // 1 minute
		};
	}

	/**
	 * Check if a request should be rate limited
	 */
	async checkLimit(
		env: Env,
		identifier: string,
		customConfig?: RateLimitConfig
	): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
		const config = customConfig || this.config;
		const now = Date.now();
		const window = Math.floor(now / (config.windowSeconds * 1000));
		const key = `ratelimit:${identifier}:${window}`;
		
		// Get current count
		const currentCount = parseInt(await env.OAUTH_KV.get(key) || '0');
		
		if (currentCount >= config.maxRequests) {
			return {
				allowed: false,
				remaining: 0,
				resetAt: (window + 1) * config.windowSeconds * 1000
			};
		}
		
		// Increment count
		await env.OAUTH_KV.put(
			key,
			String(currentCount + 1),
			{ expirationTtl: config.windowSeconds + 60 } // Add buffer for clock skew
		);
		
		return {
			allowed: true,
			remaining: config.maxRequests - currentCount - 1,
			resetAt: (window + 1) * config.windowSeconds * 1000
		};
	}

	/**
	 * Check rate limit for a user
	 */
	async checkUserLimit(env: Env, userId: string): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
		return this.checkLimit(env, `user:${userId}`);
	}

	/**
	 * Check rate limit for an IP address
	 */
	async checkIPLimit(env: Env, request: Request): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
		const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
		return this.checkLimit(env, `ip:${ip}`, {
			maxRequests: 1000, // Higher limit for IPs
			windowSeconds: 60
		});
	}

	/**
	 * Apply rate limiting to a request
	 */
	async limitRequest(
		env: Env,
		request: Request,
		userId?: string
	): Promise<Response | null> {
		// Check IP-based rate limit first
		const ipLimit = await this.checkIPLimit(env, request);
		if (!ipLimit.allowed) {
			return new Response('Rate limit exceeded', {
				status: 429,
				headers: {
					'X-RateLimit-Limit': String(1000),
					'X-RateLimit-Remaining': String(ipLimit.remaining),
					'X-RateLimit-Reset': String(ipLimit.resetAt),
					'Retry-After': String(Math.ceil((ipLimit.resetAt - Date.now()) / 1000))
				}
			});
		}

		// Check user-based rate limit if userId is provided
		if (userId) {
			const userLimit = await this.checkUserLimit(env, userId);
			if (!userLimit.allowed) {
				return new Response('Rate limit exceeded', {
					status: 429,
					headers: {
						'X-RateLimit-Limit': String(this.config.maxRequests),
						'X-RateLimit-Remaining': String(userLimit.remaining),
						'X-RateLimit-Reset': String(userLimit.resetAt),
						'Retry-After': String(Math.ceil((userLimit.resetAt - Date.now()) / 1000))
					}
				});
			}
		}

		// Request is allowed
		return null;
	}

	/**
	 * Get rate limit headers for a successful request
	 */
	async getRateLimitHeaders(
		env: Env,
		identifier: string
	): Promise<Record<string, string>> {
		const now = Date.now();
		const window = Math.floor(now / (this.config.windowSeconds * 1000));
		const key = `ratelimit:${identifier}:${window}`;
		const currentCount = parseInt(await env.OAUTH_KV.get(key) || '0');
		
		return {
			'X-RateLimit-Limit': String(this.config.maxRequests),
			'X-RateLimit-Remaining': String(Math.max(0, this.config.maxRequests - currentCount)),
			'X-RateLimit-Reset': String((window + 1) * this.config.windowSeconds * 1000)
		};
	}
}