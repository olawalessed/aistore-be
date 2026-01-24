import { RateLimitDO } from '../durable-objects/rate-limit-do';

interface RateLimitMiddlewareOptions {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (c: any) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions = {}) {
  const {
    windowMs = 60 * 1000, // 1 minute default
    maxRequests = 10, // 10 requests per minute default
    keyGenerator,
    skipSuccessfulRequests = false,
    skipFailedRequests = false
  } = options;

  return async (c: any, next: () => Promise<void>) => {
    const env = c.env;
    const rateLimitStub = env.RATE_LIMIT_DO.get(env.RATE_LIMIT_DO.idFromName('llm-rate-limit'));
    
    // Generate client key
    const clientId = keyGenerator ? keyGenerator(c) : generateDefaultKey(c);
    
    // Check rate limit first
    const checkUrl = `https://rate-limit/check?clientId=${encodeURIComponent(clientId)}`;
    const checkResponse = await rateLimitStub.fetch(new Request(checkUrl));
    
    if (!checkResponse.ok) {
      const error = await checkResponse.json();
      
      // Set rate limit headers on response
      c.header('X-RateLimit-Limit', error.limit?.toString() || maxRequests.toString());
      c.header('X-RateLimit-Remaining', error.remaining?.toString() || '0');
      c.header('X-RateLimit-Reset', error.reset?.toString() || '');
      c.header('Retry-After', error.retryAfter?.toString() || '');
      
      return c.json({
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please try again later.',
        retryAfter: error.retryAfter
      }, 429);
    }
    
    const checkData = await checkResponse.json();
    
    // If not allowed, return 429
    if (!checkData.allowed) {
      const retryAfter = Math.ceil((checkData.reset - Date.now()) / 1000);
      
      c.header('X-RateLimit-Limit', checkData.limit?.toString() || maxRequests.toString());
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', checkData.reset?.toString() || '');
      c.header('Retry-After', retryAfter.toString());
      
      return c.json({
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please try again later.',
        retryAfter
      }, 429);
    }
    
    // Proceed with the request
    await next();
    
    // Only count the request if it should be counted
    const shouldCount = 
      (skipSuccessfulRequests && c.res.status >= 200 && c.res.status < 300) ||
      (skipFailedRequests && c.res.status >= 400) ||
      (!skipSuccessfulRequests && !skipFailedRequests);
    
    if (shouldCount) {
      // Increment the counter
      const incrementUrl = `https://rate-limit/?clientId=${encodeURIComponent(clientId)}`;
      await rateLimitStub.fetch(new Request(incrementUrl, {
        method: 'POST'
      }));
    }
    
    // Set rate limit headers from check data
    c.header('X-RateLimit-Limit', checkData.limit?.toString() || maxRequests.toString());
    c.header('X-RateLimit-Remaining', checkData.remaining?.toString() || '0');
    c.header('X-RateLimit-Reset', checkData.reset?.toString() || '');
  };
}

function generateDefaultKey(c: any): string {
  // Try different sources for client identification
  const forwardedFor = c.req.header('x-forwarded-for');
  const realIp = c.req.header('x-real-ip');
  const cfConnectingIp = c.req.header('cf-connecting-ip');
  const userAgent = c.req.header('user-agent');
  
  const ip = cfConnectingIp || realIp || forwardedFor?.split(',')[0] || 'unknown';
  
  // Create a hash of IP + User Agent for better uniqueness
  return `${ip}:${userAgent?.substring(0, 50) || 'no-ua'}`;
}

// Preconfigured middleware for different use cases
export const llmRateLimit = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 20, // 20 requests per minute for LLM
  keyGenerator: (c: any) => {
    // Use API key if available, otherwise IP
    const apiKey = c.req.header('authorization')?.replace('Bearer ', '');
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'unknown';
    return apiKey ? `api:${apiKey}` : `ip:${ip}`;
  }
});

export const chatRateLimit = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute  
  maxRequests: 10, // 10 requests per minute for chat
});
