import { Redis } from '@upstash/redis/cloudflare';
import { EnvBindings } from "../bindings";

export interface StoreProductPointer {
  storeId: string;
  productId: string;
  price: number;
  currency: string;
  lastSyncAt: number;
}

export interface SearchCacheEntry {
  results: any[];
  intent: any;
  createdAt: number;
}

export interface StoreMetadata {
  name: string;
  plan: string;
  city: string;
  whatsapp?: string;
  phone?: string;
  lastSyncAt: number;
}

export class UpstashHelper {
  private redis: Redis;

  constructor(env: EnvBindings) {
    this.redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL!,
      token: env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }

  // Direct Redis access for chat storage
  getRedisClient(): Redis {
    return this.redis;
  }

  // Global Index Operations
  async addToCategoryIndex(category: string, pointers: StoreProductPointer[]): Promise<void> {
    const key = `index:category:${category.toLowerCase()}`;
    const members = pointers.map(p => JSON.stringify(p));
    
    if (members.length > 0) {
      await this.redis.sadd(key, members);
    }
  }

  async addToTagIndex(tag: string, pointers: StoreProductPointer[]): Promise<void> {
    const key = `index:tag:${tag.toLowerCase()}`;
    const members = pointers.map(p => JSON.stringify(p));
    
    if (members.length > 0) {
      await this.redis.sadd(key, members);
    }
  }

  async getCategoryIndex(category: string): Promise<StoreProductPointer[]> {
    try {
      const key = `index:category:${category.toLowerCase()}`;
      const result = await this.redis.smembers(key);
      
      return result ? result.map((item: string) => JSON.parse(item)) : [];
    } catch (error) {
      console.warn(`[Upstash] Category index miss for ${category}:`, error);
      return [];
    }
  }

  async getTagIndex(tag: string): Promise<StoreProductPointer[]> {
    try {
      const key = `index:tag:${tag.toLowerCase()}`;
      const result = await this.redis.smembers(key);
      
      return result ? result.map((item: string) => JSON.parse(item)) : [];
    } catch (error) {
      console.warn(`[Upstash] Tag index miss for ${tag}:`, error);
      return [];
    }
  }

  // Search Cache Operations
  async getSearchCache(cacheKey: string): Promise<SearchCacheEntry | null> {
    try {
      const result = await this.redis.get(cacheKey);
      
      if (result) {
        const entry = JSON.parse(result as string);
        // Check TTL (300 seconds)
        if (Date.now() - entry.createdAt < 300000) {
          return entry;
        }
      }
      return null;
    } catch (error) {
      console.warn(`[Upstash] Search cache miss for ${cacheKey}:`, error);
      return null;
    }
  }

  async setSearchCache(cacheKey: string, entry: SearchCacheEntry): Promise<void> {
    await this.redis.setex(cacheKey, 300, JSON.stringify(entry)); // 5 minutes TTL
  }

  // Store Metadata Cache (Optional)
  async getStoreMetadata(storeId: string): Promise<StoreMetadata | null> {
    try {
      const result = await this.redis.get(`cache:store:${storeId}`);
      
      if (result) {
        const metadata = JSON.parse(result as string);
        // Check TTL (600 seconds)
        if (Date.now() - metadata.lastSyncAt < 600000) {
          return metadata;
        }
      }
      return null;
    } catch (error) {
      console.warn(`[Upstash] Store metadata cache miss for ${storeId}:`, error);
      return null;
    }
  }

  async setStoreMetadata(storeId: string, metadata: StoreMetadata): Promise<void> {
    await this.redis.setex(`cache:store:${storeId}`, 600, JSON.stringify(metadata)); // 10 minutes TTL
  }

  // Utility
  static generateCacheKey(intent: any, normalizedQuery: string): string {
    const keyData = {
      intent,
      normalizedQuery,
    };
    return `cache:search:${btoa(JSON.stringify(keyData)).replace(/[^a-zA-Z0-9]/g, '')}`;
  }

  // Index Management (for sync pipeline)
  async clearCategoryIndex(category: string): Promise<void> {
    const key = `index:category:${category.toLowerCase()}`;
    await this.redis.del(key);
  }

  async clearTagIndex(tag: string): Promise<void> {
    const key = `index:tag:${tag.toLowerCase()}`;
    await this.redis.del(key);
  }

  async clearStoreFromIndexes(storeId: string): Promise<void> {
    // This would be called during store deletion or major updates
    // Implementation would require scanning all indexes - expensive operation
    // For now, rely on TTL-based cleanup
    console.warn(`[Upstash] Clearing store ${storeId} from indexes not implemented - relying on TTL`);
  }
}
