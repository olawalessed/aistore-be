import { Context, Next } from "hono";
import { EnvBindings } from "../bindings";

const RATE_LIMIT_CACHE = new Map<string, { count: number, resetAt: number }>();
const LIMIT = 100; // requests per window
const WINDOW_MS = 60000; // 1 minute

export const rateLimitMiddleware = async (c: Context<{ Bindings: EnvBindings }>, next: Next) => {
    // Basic IP-based rate limiting (conceptual for V0, actual Workers might use KV or DO for distributed RL)
    // Here we use an in-memory map which works per-isolate.
    const ip = c.req.header("cf-connecting-ip") || "anonymous";
    const now = Date.now();

    let record = RATE_LIMIT_CACHE.get(ip);

    if (!record || now > record.resetAt) {
        record = { count: 0, resetAt: now + WINDOW_MS };
    }

    record.count++;
    RATE_LIMIT_CACHE.set(ip, record);

    if (record.count > LIMIT) {
        return c.json({ error: "Too many requests. Please try again later." }, 429);
    }

    await next();
};
