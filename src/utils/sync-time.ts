import { EnvBindings } from "../bindings";

export function getSyncInterval(plan: string, env: EnvBindings): number {
    // Check if we are strictly in production
    // Note: Cloudflare Workers use env.NODE_ENV usually passed via wrangler
    if (env.NODE_ENV === "production") {
        switch (plan.toLowerCase()) {
            case 'premium':
                return 1800;  // 30 mins
            case 'pro':
                return 3600;  // 1 hour
            case 'free':
                return 86400; // 24 hours
            default:
                return 3600;  // Default fallback
        }
    }

    // Default for development (300 seconds = 5 minutes)
    return 300;
}