import { Hono, Context, Next } from "hono";
import { EnvBindings } from "../bindings";

export type SessionData = {
    storeId: string;
    email: string;
    name?: string;
    storeName?: string;
    slug?: string;
    plan?: string;
    city?: string;
    country?: string;
    whatsapp?: string;
};

export type AuthContext = Context<{
    Bindings: EnvBindings;
    Variables: {
        session?: SessionData;
    };
}>;

// PKCE Helper Functions
export function generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    // Convert to base64url (allowed chars: a-z, A-Z, 0-9, ., -, _)
    return Array.from(array, byte => byte.toString(36).padStart(2, '0')).join('').substring(0, 43);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    // Convert to base64url encoding (replace + with -, / with _, remove padding =)
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}



// Middleware to handle session authentication for all /stores routes
export const authMiddleware = async (c: AuthContext, next: Next) => {
    // Skip auth for email verification and registration endpoints
    if (c.req.path.includes('/register-email') || c.req.path.includes('/verify-email')) {
        await next();
        return;
    }

    // Get session from cookie
    const cookieHeader = c.req.header("Cookie");
    let sessionCookie = '';
    
    if (cookieHeader) {
        const cookies = cookieHeader.split(';').map(cookie => cookie.trim());
        const sessionCookieObj = cookies.find(cookie => cookie.startsWith('session='));
        if (sessionCookieObj) {
            sessionCookie = sessionCookieObj.substring('session='.length);
        }
    }
    
    if (!sessionCookie) {
        return c.json({ error: "Session required" }, 401);
    }

    // Parse JWT session cookie
    let session;
    try {
        // Import jose for JWT verification
        const { jwtVerify } = await import('jose');
        const secretKey = c.env.JWT_AUTH_SECRET;
        const key = new TextEncoder().encode(secretKey);
        
        const { payload } = await jwtVerify(sessionCookie, key);
        session = payload as SessionData;
    } catch (error) {
        return c.json({ error: "Invalid session" }, 401);
    }

    if (!session.storeId) {
        return c.json({ error: "Invalid session" }, 401);
    }

    // Attach session to context for use in routes
    c.set('session', session);
    await next();
};
