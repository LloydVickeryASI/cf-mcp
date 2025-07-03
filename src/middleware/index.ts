/**
 * Middleware module barrel export
 */

export { 
  RateLimiter, 
  withRateLimit, 
  parsePeriodToSeconds 
} from "./rate-limit";

export { 
  wrapTool,
  setSentryUserContext,
  setSentryTags 
} from "./tool-span";

export type { 
  RateLimitResult 
} from "./rate-limit"; 