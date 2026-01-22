import { DurableObject } from "cloudflare:workers";
import { EnvBindings } from "../bindings";
import { AirtableService } from "../services/airtable";

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
    productTable: string;
    settingsTable?: string;
    apiKey: string;
    country?: string;
    city?: string;
    address?: string;
    whatsapp?: string;
    phone?: string;
    lastSyncAt?: string;
    lastSettingsSyncAt?: string;
    settings?: StoreSettings;
    errorState?: string;
}

export class StoreDO extends DurableObject {
    private state: StoreState | null = null;
    private airtable = new AirtableService();

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

    async getConfig(): Promise<StoreState | null> {
        if (!this.state) {
            this.state = await this.ctx.storage.get<StoreState>("config") || null;
        }
        return this.state;
    }

    async alarm() {
        const config = await this.getConfig();
        if (!config || config.errorState === "paused") return;

        try {
            console.log(`[StoreDO ${config.storeId}] Starting sync...`);

            // 1. Check if we need to sync Store Settings (shorthand monthly logic for V0: sync if missing or every 30 days-ish)
            // For now, if settingsTable exists and settings are missing, sync.
            if (config.settingsTable && (!config.settings || !config.lastSettingsSyncAt)) {
                console.log(`[StoreDO ${config.storeId}] Syncing Store Settings...`);
                const settingsRecords = await this.airtable.fetchRecords({
                    baseId: config.baseId,
                    table: config.settingsTable,
                    apiKey: config.apiKey
                });

                console.log(`[StoreDO ${config.storeId}] Fetched ${JSON.stringify(settingsRecords, null, 2)} settings records from Airtable`);

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

            // 2. Fetch from Airtable (Products)
            const productRecords = await this.airtable.fetchRecords({
                baseId: config.baseId,
                table: config.productTable,
                apiKey: config.apiKey
            });

            console.log(`[StoreDO ${config.storeId}] ${JSON.stringify(productRecords)}`);
            console.log(`[StoreDO ${config.storeId}] Fetched ${productRecords.length} records from Airtable`);

            // 3. Normalize
            const normalized = productRecords.map(r => {
                const p = this.airtable.normalizeProduct(r, config.name, config.settings);
                p.id = `${config.storeId}:${r.id}`; // Namespace ID to prevent collisions
                p.store_id = config.storeId;
                return p;
            });

            // 4. Write catalogs to KV
            const catalogSnapshot = {
                store_id: config.storeId,
                updated_at: new Date().toISOString(),
                products: normalized
            };

            const kv = (this.env as EnvBindings).BASEKART_AI_SHOP_KV;
            await kv.put(`store:${config.storeId}:catalog`, JSON.stringify(catalogSnapshot));
            // Also write to :products for user's convenience/consistency
            await kv.put(`store:${config.storeId}:products`, JSON.stringify(normalized));

            // 5. Write individual products to KV for direct access
            for (const product of normalized) {
                await kv.put(`product:${product.id}`, JSON.stringify(product));
            }

            // 6. Write store metadata snapshot (get_store schema)
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

            // 7. Update metadata in storage
            config.lastSyncAt = new Date().toISOString();
            config.errorState = undefined;
            await this.ctx.storage.put("config", config);

            console.log(`[StoreDO ${config.storeId}] Sync complete. ${productRecords.length} records processed.`);

        } catch (error: any) {
            console.error(`[StoreDO ${config.storeId}] Sync failed:`, error.message);
            config.errorState = error.message;
            await this.ctx.storage.put("config", config);
        } finally {
            // Schedule next sync (1 hour)
            await this.ctx.storage.setAlarm(Date.now() + 3600 * 1000);
        }
    }

    async triggerSync() {
        await this.ctx.storage.setAlarm(Date.now());
        return { status: "sync_triggered" };
    }
}
