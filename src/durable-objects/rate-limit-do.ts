import { DurableObject } from "cloudflare:workers";
import { EnvBindings } from "../bindings";

export interface RateLimitState {
  requests: number;
  resetTime: number;
  windowStart: number;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export class RateLimitDO {
  private state: DurableObjectState;
  private env: EnvBindings;
  private config: RateLimitConfig;

  constructor(state: DurableObjectState, env: EnvBindings) {
    this.state = state;
    this.env = env;
    this.config = {
      windowMs: 60 * 1000,
      maxRequests: 20
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const clientId = url.searchParams.get('clientId') || this.getClientId(request);
    
    if (!clientId) {
      return new Response(JSON.stringify({ error: 'Client ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const now = Date.now();
    const rateLimitState = await this.state.storage.get<RateLimitState>(clientId) || {
      requests: 0,
      resetTime: now + this.config.windowMs,
      windowStart: now
    };

    if (now > rateLimitState.resetTime) {
      rateLimitState.requests = 0;
      rateLimitState.windowStart = now;
      rateLimitState.resetTime = now + this.config.windowMs;
    }

    if (path === '/check') {
      const remaining = Math.max(0, this.config.maxRequests - rateLimitState.requests);
      const allowed = rateLimitState.requests < this.config.maxRequests;
      
      return new Response(JSON.stringify({
        allowed,
        limit: this.config.maxRequests,
        remaining,
        reset: rateLimitState.resetTime
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': this.config.maxRequests.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
          'X-RateLimit-Reset': rateLimitState.resetTime.toString()
        }
      });
    }

    if (rateLimitState.requests >= this.config.maxRequests) {
      const retryAfter = Math.ceil((rateLimitState.resetTime - now) / 1000);
      
      return new Response(JSON.stringify({
        error: 'Rate limit exceeded',
        retryAfter,
        limit: this.config.maxRequests,
        remaining: 0,
        reset: rateLimitState.resetTime
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': this.config.maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': rateLimitState.resetTime.toString(),
          'Retry-After': retryAfter.toString()
        }
      });
    }

    rateLimitState.requests++;
    await this.state.storage.put(clientId, rateLimitState);

    const remaining = this.config.maxRequests - rateLimitState.requests;
    
    return new Response(JSON.stringify({
      success: true,
      limit: this.config.maxRequests,
      remaining,
      reset: rateLimitState.resetTime
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': this.config.maxRequests.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': rateLimitState.resetTime.toString()
      }
    });
  }

  private getClientId(request: Request): string | null {
    const forwardedFor = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const cfConnectingIp = request.headers.get('cf-connecting-ip');
    
    return cfConnectingIp || realIp || forwardedFor?.split(',')[0] || null;
  }

  async checkLimit(clientId: string): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const now = Date.now();
    const rateLimitState = await this.state.storage.get<RateLimitState>(clientId) || {
      requests: 0,
      resetTime: now + this.config.windowMs,
      windowStart: now
    };

    if (now > rateLimitState.resetTime) {
      return { allowed: true, remaining: this.config.maxRequests, resetTime: now + this.config.windowMs };
    }

    const remaining = Math.max(0, this.config.maxRequests - rateLimitState.requests);
    return {
      allowed: rateLimitState.requests < this.config.maxRequests,
      remaining,
      resetTime: rateLimitState.resetTime
    };
  }
}
