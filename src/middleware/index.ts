/**
 * Middleware module barrel export
 */

export { 
  RateLimiter, 
  withRateLimit, 
  parsePeriodToSeconds 
} from "./rate-limit";

export type { 
  RateLimitResult 
} from "./rate-limit"; 