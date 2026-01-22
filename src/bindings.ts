import { D1Database, KVNamespace, R2Bucket, Ai, DurableObjectNamespace } from "@cloudflare/workers-types";
import type { StoreDO } from "./durable-objects/StoreDO";

export interface EnvBindings {
    BASEKART_AI_SHOP: D1Database;
    BASEKART_AI_SHOP_KV: KVNamespace;
    BASEKART_AI_SHOP_R2: R2Bucket;
    STORE_DO: DurableObjectNamespace<StoreDO>;
    AIRTABLE_MASTER_KEY: string;
    OPENROUTER_API_KEY: string;
    FRONTEND_URL?: string;
    NODE_ENV?: string;
    INTERNAL_TOKEN: string;
    JWT_AUTH_SECRET: string;
    AIRTABLE_CLIENT_ID: string;
    AIRTABLE_CLIENT_SECRET: string;
    OAUTH_REDIRECT_URI: string;
}