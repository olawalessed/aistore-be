import { DurableObject } from "cloudflare:workers";
import { EnvBindings } from "../bindings";
import { AirtableService } from "../services/airtable";
import { CryptoService } from "../services/crypto";
import { TokenManager, EncryptedTokenData, TokenManagerError } from "../services/token-manager";
import { getDB } from "../db";
import { stores, products } from "../db/schema";
import { eq } from "drizzle-orm";
import { getSyncInterval } from "../utils/sync-time";
import { UpstashHelper, StoreProductPointer } from "../services/upstash";

export interface StoreSettings {
    delivery_price: number;
    delivery_regions: string[];
    pickup_available: boolean;
    returnable: boolean;
    return_window_days: number;
    exchange_supported: boolean;
    warranty: string;
    authenticity_claimed: boolean;
}

export interface StoreState {
    storeId: string;
    name: string;
    slug: string;
    baseId: string;
    productTableId: string;
    settingsTableId?: string;
    country?: string;
    city?: string;
    address?: string;
    whatsapp?: string;
    phone?: string;
    lastSyncAt?: string;
    lastSettingsSyncAt?: string;
    settings?: StoreSettings;
    errorState?: string;
    syncRetryCount?: number;
    lastSyncError?: string;
}

export class StoreDO extends DurableObject<EnvBindings> {
    private state: StoreState | null = null;
    private airtable = new AirtableService();
    private isSyncing = false;
    private syncStartTime: number | null = null;
    private readonly SYNC_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes grace period

    constructor(state: DurableObjectState, env: EnvBindings) {
        super(state, env);
    }

    async init(config: StoreState) {
        this.state = config;
        await this.ctx.storage.put("config", config);

        // Schedule first sync
        await this.ctx.storage.setAlarm(Date.now() + 1000);
        return { status: "initialized" };
    }

    /**
     * Check token migration status (legacy support)
     */
    async checkTokenMigration(): Promise<{ status: string }> {
        if (!this.state) {
            throw new Error("Store state not initialized");
        }

        // Check if tokens exist in D1
        const existingTokens = await TokenManager.getTokensFromD1(this.env as EnvBindings, this.state.storeId);
        if (existingTokens) {
            console.log(`[StoreDO ${this.state.storeId}] Tokens found in D1`);
            return { status: "tokens_exist" };
        }

        return { status: "no_tokens" };
    }

    /**
     * Update global indexes in Upstash for fast discovery
     */
    private async updateGlobalIndexes(normalizedProducts: any[], config: StoreState): Promise<void> {

        console.log(normalizedProducts, 'normalizedProducts')

        try {
            const upstash = new UpstashHelper(this.env as EnvBindings);
            const now = Date.now();

            // Group products by category for batch indexing
            const categoryGroups = new Map<string, StoreProductPointer[]>();
            const tagGroups = new Map<string, StoreProductPointer[]>();

            for (const product of normalizedProducts) {
                const pointer: StoreProductPointer = {
                    storeId: config.storeId,
                    productId: product.id,
                    price: product.amount,
                    currency: product.currency || 'NGN',
                    lastSyncAt: now
                };

                // Category indexing
                if (product.category) {
                    if (!categoryGroups.has(product.category)) {
                        categoryGroups.set(product.category, []);
                    }
                    categoryGroups.get(product.category)!.push(pointer);
                }

                // Tag indexing
                if (product.tags && Array.isArray(product.tags)) {
                    for (const tag of product.tags) {
                        if (!tagGroups.has(tag)) {
                            tagGroups.set(tag, []);
                        }
                        tagGroups.get(tag)!.push(pointer);
                    }
                }
            }

            // Batch update category indexes
            const categoryPromises = Array.from(categoryGroups.entries()).map(
                ([category, pointers]) => upstash.addToCategoryIndex(category, pointers)
            );

            // Batch update tag indexes
            const tagPromises = Array.from(tagGroups.entries()).map(
                ([tag, pointers]) => upstash.addToTagIndex(tag, pointers)
            );

            // Execute all index updates in parallel
            await Promise.allSettled([...categoryPromises, ...tagPromises]);

            console.log(`[StoreDO ${config.storeId}] Updated ${categoryGroups.size} category indexes and ${tagGroups.size} tag indexes`);

        } catch (error) {
            console.error(`[StoreDO ${config.storeId}] Failed to update global indexes:`, error);
            // Don't fail the sync - index updates are non-critical
        }
    }

    /**
     * Get valid access token from D1 with auto-refresh
     */
    async getValidAccessToken(): Promise<string> {
        if (!this.state) {
            throw new Error("Store state not initialized");
        }

        // Always get tokens from D1 (canonical storage)
        return await TokenManager.getValidAccessTokenFromD1(
            this.env as EnvBindings,
            this.state.storeId
        );
    }


    async getConfig(): Promise<StoreState | null> {
        if (!this.state) {
            this.state = await this.ctx.storage.get<StoreState>("config") || null;
        }
        return this.state;
    }

    async alarm() {
        const config = await this.getConfig();
        if (!config || config.errorState === "paused") return;

        // 1. Concurrency & Timeout Guard
        if (this.shouldSkipSync(config)) return;

        this.isSyncing = true;
        this.syncStartTime = Date.now();

        try {
            console.log(`[StoreDO ${config.storeId}] Starting sync...`);
            const db = getDB(this.env as EnvBindings);

            // 2. Plan & Interval Resolution
            const syncInterval = await this.resolveSyncInterval(db, config);

            // 3. Credentials & Settings Sync
            const accessToken = await this.getValidAccessToken();
            await this.syncStoreSettings(config, accessToken);

            // 4. Data Fetching & Normalization
            const productRecords = await this.airtable.fetchRecords({
                baseId: config.baseId,
                table: config.productTableId,
                apiKey: accessToken
            });

            const normalizedProducts = productRecords.map(record =>
                this.airtable.normalizeProductForD1(record, config.storeId, config.settings)
            );

            // 5. Database Commit (Batch Transaction)
            await this.commitProductsToD1(db, config, normalizedProducts);

            // 6. Build KV indexes from D1 (after successful commit)
            await this.buildKVIndexes(normalizedProducts, config);

            // 7. Update global indexes in Upstash
            await this.updateGlobalIndexes(normalizedProducts, config);

            // 8. Update DO state
            await this.finalizeSyncState(config);

            console.log(`[StoreDO ${config.storeId}] Sync complete successfully`);

            // 9. Schedule next run
            await this.scheduleNextAlarm(syncInterval);

        } catch (error: any) {
            await this.handleSyncFailure(config, error);
        } finally {
            this.cleanupSyncState();
            await this.ensureReschedule(config);
        }
    }

    /**
 * PRIVATE HELPER METHODS FOR CHUNKING
    */

    private shouldSkipSync(config: any): boolean {
        if (this.isSyncing) {
            const now = Date.now();
            if (this.syncStartTime && (now - this.syncStartTime) > this.SYNC_TIMEOUT_MS) {
                console.warn(`[StoreDO ${config.storeId}] Sync timeout detected, resetting stuck state`);
                this.isSyncing = false;
                this.syncStartTime = null;
                return false; // Don't skip, we just reset it
            }
            console.log(`[StoreDO ${config.storeId}] Sync already in progress, skipping`);
            return true;
        }
        return false;
    }

    private async resolveSyncInterval(db: any, config: any): Promise<number> {
        const storeRecord = await db
            .select({ plan: stores.plan, syncInterval: stores.syncInterval })
            .from(stores)
            .where(eq(stores.id, config.storeId))
            .limit(1);

        if (!storeRecord[0]) throw new Error("Store not found in D1");

        const record = storeRecord[0];
        let syncInterval = record.syncInterval;

        if (!syncInterval) {
            syncInterval = getSyncInterval(record.plan, this.env as EnvBindings);
            await db.update(stores).set({ syncInterval }).where(eq(stores.id, config.storeId));
        }
        return syncInterval;
    }

    private async syncStoreSettings(config: any, accessToken: string) {
        if (config.settingsTableId && (!config.settings || !config.lastSettingsSyncAt)) {
            console.log(`[StoreDO ${config.storeId}] Syncing Store Settings...`);
            const settingsRecords = await this.airtable.fetchRecords({
                baseId: config.baseId,
                table: config.settingsTableId,
                apiKey: accessToken
            });

            if (settingsRecords.length > 0) {
                const s = settingsRecords[0].fields;
                config.settings = {
                    delivery_price: Number(s.delivery_price) || 0,
                    delivery_regions: typeof s.delivery_regions === "string" ? s.delivery_regions.split(",") : (Array.isArray(s.delivery_regions) ? s.delivery_regions : []),
                    pickup_available: !!s.pickup_available,
                    returnable: !!s.returnable,
                    return_window_days: Number(s.return_window_days) || 0,
                    exchange_supported: !!s.exchange_supported,
                    warranty: String(s.warranty || ""),
                    authenticity_claimed: !!s.authenticity_claimed
                };
                config.lastSettingsSyncAt = new Date().toISOString();
                await this.ctx.storage.put("config", config);
            }
        }
    }

    private async commitProductsToD1(db: any, config: any, normalizedProducts: any[]) {
        await db.batch([
            db.delete(products).where(eq(products.storeId, config.storeId)),
            ...normalizedProducts.map(product => db.insert(products).values(product)),
            db.update(stores)
                .set({
                    lastSyncAt: new Date(),
                    syncStatus: "success",
                    productCount: normalizedProducts.length,
                    syncError: null,
                })
                .where(eq(stores.id, config.storeId))
        ]);
    }

    private async finalizeSyncState(config: any) {
        config.lastSyncAt = new Date().toISOString();
        config.errorState = undefined;
        config.syncRetryCount = 0;
        config.lastSyncError = undefined;
        await this.ctx.storage.put("config", config);
    }

    private async handleSyncFailure(config: any, error: any) {
        console.error(`[StoreDO ${config?.storeId}] Sync failed:`, error.message);
        const db = getDB(this.env as EnvBindings);
        await db.update(stores)
            .set({ syncStatus: "failed", syncError: error.message })
            .where(eq(stores.id, config?.storeId));

        if (config) {
            config.errorState = error.message;
            config.lastSyncError = error.message;
            config.syncRetryCount = (config.syncRetryCount || 0) + 1;
            await this.ctx.storage.put("config", config);

            const maxRetries = 5;
            if (config.syncRetryCount <= maxRetries) {
                const backoffMs = Math.min(1000 * Math.pow(2, config.syncRetryCount), 30000);
                await this.ctx.storage.setAlarm(Date.now() + backoffMs);
            }
        }
    }

    private cleanupSyncState() {
        this.isSyncing = false;
        this.syncStartTime = null;
    }

    private async scheduleNextAlarm(interval: number) {
        await this.ctx.storage.setAlarm(Date.now() + interval * 1000);
    }

    private async ensureReschedule(config: any) {
        if (config && (!config.syncRetryCount || config.syncRetryCount === 0)) {
            const db = getDB(this.env as EnvBindings);
            const storeRecord = await db
                .select({ plan: stores.plan })
                .from(stores)
                .where(eq(stores.id, config.storeId))
                .limit(1);

            if (storeRecord[0]) {
                const syncInterval = getSyncInterval(storeRecord[0].plan, this.env as EnvBindings);
                await this.ctx.storage.setAlarm(Date.now() + (syncInterval * 1000));
            }
        }
    }


    /**
     * Build KV indexes from D1 data (after successful transaction)
     */
    private async buildKVIndexes(normalizedProducts: any[], config: StoreState) {
        const kv = (this.env as EnvBindings).BASEKART_AI_SHOP_KV;

        // 1. Store catalog snapshot
        const catalogSnapshot = {
            store_id: config.storeId,
            updated_at: new Date().toISOString(),
            products: normalizedProducts.map(product => ({
                id: product.id,
                store_id: product.storeId,
                name: product.name,
                brand: product.brand,
                model: product.model,
                category: product.category,
                tags: JSON.parse(product.tags || '[]'),
                description: {
                    short: product.descriptionShort,
                    long: product.descriptionLong,
                },
                images: JSON.parse(product.images || '[]'),
                pricing: {
                    currency: product.currency,
                    amount: product.amount,
                    original_amount: product.originalAmount,
                    discount_percentage: product.discountPercentage,
                },
                inventory: {
                    in_stock: product.inStock,
                    stock_status: product.stockStatus,
                    quantity_range: product.quantityRange,
                    variants_tracked: product.variantsTracked,
                },
                variants: JSON.parse(product.variants || '[]'),
                fulfillment: {
                    delivery_available: product.deliveryAvailable,
                    pickup_available: product.pickupAvailable,
                    delivery_price: product.deliveryPrice,
                    delivery_regions: JSON.parse(product.deliveryRegions || '[]'),
                    estimated_delivery_hours: {
                        min: product.deliveryMinHours,
                        max: product.deliveryMaxHours,
                    },
                },
                policies: {
                    returnable: product.returnable,
                    return_window_days: product.returnWindowDays,
                    exchange_supported: product.exchangeSupported,
                },
                compliance: {
                    condition: product.condition,
                    warranty: product.warranty,
                    authenticity_claimed: product.authenticityClaimed,
                },
                updated_at: product.syncedAt,
            }))
        };

        await kv.put(`store:${config.storeId}:catalog`, JSON.stringify(catalogSnapshot));
        await kv.put(`store:${config.storeId}:products`, JSON.stringify(catalogSnapshot.products));

        // 2. Store individual products for direct access
        for (const product of catalogSnapshot.products) {
            await kv.put(`product:${product.id}`, JSON.stringify(product));
        }

        // 3. Store metadata snapshot
        const storeSnapshot = {
            type: "store",
            confidence: {
                data_source: "airtable",
                freshness: "hourly",
                last_synced_at: new Date().toISOString(),
                confidence_score: 0.95
            },
            store: {
                id: config.storeId,
                name: config.name,
                slug: config.slug,
                location: {
                    country: config.country || "NG",
                    city: config.city,
                    address: config.address
                },
                contact: {
                    whatsapp: config.whatsapp,
                    phone: config.phone
                },
                availability_status: "active"
            },
            capabilities: {
                can_checkout: false,
                supports_llm_discovery: true,
                fulfillment: config.settings ? {
                    delivery_available: true,
                    pickup_available: config.settings.pickup_available,
                    delivery_price: config.settings.delivery_price,
                    delivery_regions: config.settings.delivery_regions
                } : undefined
            }
        };
        await kv.put(`store:${config.storeId}:metadata`, JSON.stringify(storeSnapshot));

        console.log(`[StoreDO ${config.storeId}] KV indexes built successfully`);
    }

    async triggerSync() {
        await this.ctx.storage.setAlarm(Date.now() + 1000);
        return { status: "sync_triggered" };
    }
}
