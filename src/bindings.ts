import { D1Database, KVNamespace, R2Bucket, Ai, DurableObjectNamespace } from "@cloudflare/workers-types";
import type { StoreDO } from "./durable-objects/StoreDO";

export interface EnvBindings {
    BASEKART_AI_SHOP: D1Database;
    BASEKART_AI_SHOP_KV: KVNamespace;
    BASEKART_AI_SHOP_R2: R2Bucket;
    STORE_DO: DurableObjectNamespace<StoreDO>;
    INTERNAL_TOKEN: string;
    AIRTABLE_MASTER_KEY: string;
    OPENROUTER_API_KEY: string;
}