import {
  D1Database,
  KVNamespace,
  R2Bucket,
  Ai,
  DurableObjectNamespace,
} from "@cloudflare/workers-types";
import type { StoreDO } from "./durable-objects/store-do";
import type { SocketDO } from "./durable-objects/socket-do";

export interface EnvBindings {
  BASEKART_AI_SHOP: D1Database;
  BASEKART_AI_SHOP_KV: KVNamespace;
  BASEKART_AI_SHOP_R2: R2Bucket;

  // Durable Objects
  STORE_DO: DurableObjectNamespace<StoreDO>;
  SOCKET_DO: DurableObjectNamespace<SocketDO>;
  RATE_LIMIT_DO: DurableObjectNamespace;

  // AI
  AI: Ai;
  OPENROUTER_API_KEY: string;

  // Upstash Redis
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;

  // System
  FRONTEND_URL?: string;
  NODE_ENV?: string;
  INTERNAL_TOKEN: string;
  JWT_AUTH_SECRET: string;
  // Airtable
  AIRTABLE_MASTER_KEY: string;
  AIRTABLE_CLIENT_ID: string;
  AIRTABLE_CLIENT_SECRET: string;
  OAUTH_REDIRECT_URI: string;
}
