import { EnvBindings } from "../bindings";
import { getDB } from "../db";
import { stores, products } from "../db/schema";
import { eq, and, ne } from "drizzle-orm";
import { parseUserIntent, parseUserIntentHybrid } from "../helpers/ai-chat";
import { UpstashHelper, StoreProductPointer } from "./upstash";

export interface SearchQuery {
    query: string;
    intent?: {
        category?: string;
        color?: string;
        budget_max?: number;
        location?: {
            city?: string;
            country?: string;
        };
    };
    userLocation?: {
        city?: string;
        country?: string;
    };
    resultLimit?: number;
}

export interface SearchOptions {
    useCache?: boolean;
    useIndexes?: boolean;
}

export class SearchService {
    static async search(
        env: EnvBindings, 
        searchQuery: SearchQuery, 
        options: SearchOptions = { useCache: true, useIndexes: true }
    ) {
        const db = getDB(env);
        const kv = env.BASEKART_AI_SHOP_KV;
        const upstash = new UpstashHelper(env);

        try {
            // 1. Parse intent once (normalized)
            const intent = await parseUserIntentHybrid(searchQuery.query, env);
            console.log(intent, 'intent')
            const normalizedQuery = searchQuery.query.toLowerCase().trim();

            // 2. Build cache key and check cache
            if (options.useCache) {
                const cacheKey = UpstashHelper.generateCacheKey(intent, normalizedQuery);
                const cachedResult = await upstash.getSearchCache(cacheKey);
                if (cachedResult) {
                    console.log(`[SearchService] Cache hit for query: ${normalizedQuery}`);
                    return {
                        type: "search_results",
                        query_context: {
                            original_query: searchQuery.query,
                            parsed_intent: intent
                        },
                        confidence: {
                            data_source: "cache",
                            freshness: "cached",
                            last_global_sync_at: new Date().toISOString(),
                            result_confidence: "high"
                        },
                        results: cachedResult.results,
                        result_limits: {
                            max_results: searchQuery.resultLimit || 10,
                            returned: cachedResult.results.length,
                            excluded_reasons: []
                        },
                        usage_guidelines: {
                            allowed: ["recommend_top_matches", "explain_ranking", "compare_products"],
                            disallowed: ["guarantee_stock", "finalize_purchase"]
                        }
                    };
                }
            }

            // 3. Get active stores from D1 (canonical source)
            const activeStores = await db.select({
                id: stores.id,
                name: stores.name,
                slug: stores.slug,
                plan: stores.plan,
                city: stores.city,
                country: stores.country,
                status: stores.status,
                whatsapp: stores.whatsapp,
                phone: stores.phone,
                lastSyncAt: stores.lastSyncAt,
            }).from(stores).where(eq(stores.status, "active"));

            // 4. Check global indexes to identify candidate stores
            let candidateStoreIds: string[] | null = null;
            
            if (options.useIndexes && (intent.category || intent.tags)) {
                candidateStoreIds = await this.getCandidateStoresFromIndexes(upstash, intent);
                console.log(`[SearchService] Index lookup found ${candidateStoreIds.length} candidate stores`);
            }

            // 5. Filter stores based on index results
            const storesToQuery = candidateStoreIds 
                ? activeStores.filter(store => candidateStoreIds!.includes(store.id))
                : activeStores;

            // 6. Parallel product fetch from KV/D1
            const productFetchResults = await this.fetchProductsInParallel(
                env, 
                storesToQuery, 
                kv, 
                db
            );

            // 7. Score and rank products
            const allResults: any[] = [];
            for (const { store, products, dataSource } of productFetchResults) {
                for (const product of products) {
                    const score = this.calculateRankScore(product, store, intent);
                    if (score > 0.3) { // Lower threshold for more results
                        allResults.push({
                            rank_score: score,
                            match_reasons: this.getMatchReasons(product, store, intent),
                            data_source: dataSource,
                            product: {
                                id: product.id,
                                name: product.name,
                                category: product.category,
                                description: product.description,
                                price: {
                                    currency: product.pricing?.currency || 'NGN',
                                    amount: product.pricing?.amount || 0
                                },
                                inventory: {
                                    in_stock: product.inventory?.in_stock || true,
                                    quantity: product.inventory?.quantity || 0,
                                    availability_confidence: "medium"
                                },
                                images: product.images || [],
                                tags: product.tags || [],
                                variants: product.variants || []
                            },
                            store: {
                                id: store.id,
                                name: store.name,
                                location: store.city || "Unknown",
                                store_plan: store.plan,
                                whatsapp: store.whatsapp,
                                phone: store.phone
                            },
                            freshness: {
                                last_synced_at: store.lastSyncAt?.toISOString() || product.synced_at || new Date().toISOString()
                            }
                        });
                    }
                }
            }

            // 8. Sort and limit results
            const sortedResults = allResults
                .sort((a, b) => b.rank_score - a.rank_score)
                .slice(0, searchQuery.resultLimit || 10);

            // 9. Assign ranks
            sortedResults.forEach((res, idx) => { res.rank = idx + 1; });

            // 10. Cache results
            if (options.useCache && sortedResults.length > 0) {
                const cacheKey = UpstashHelper.generateCacheKey(intent, normalizedQuery);
                await upstash.setSearchCache(cacheKey, {
                    results: sortedResults,
                    intent,
                    createdAt: Date.now()
                });
            }

            // 11. Build confidence metadata
            const confidence = this.buildConfidenceMetadata(
                sortedResults.length,
                activeStores.length,
                productFetchResults.filter(r => r.dataSource === 'kv').length,
                productFetchResults.filter(r => r.dataSource === 'd1_fallback').length,
                intent
            );

            return {
                type: "search_results",
                query_context: {
                    original_query: searchQuery.query,
                    parsed_intent: intent
                },
                confidence,
                results: sortedResults,
                result_limits: {
                    max_results: searchQuery.resultLimit || 10,
                    returned: sortedResults.length,
                    excluded_reasons: this.getExcludedReasons(sortedResults.length, activeStores.length)
                },
                usage_guidelines: {
                    allowed: ["recommend_top_matches", "explain_ranking", "compare_products"],
                    disallowed: ["guarantee_stock", "finalize_purchase"]
                }
            };

        } catch (error) {
            console.error('[SearchService] Search failed:', error);
            return this.buildErrorResponse(searchQuery.query, error);
        }
    }

    private static async getCandidateStoresFromIndexes(
        upstash: UpstashHelper, 
        intent: any
    ): Promise<string[]> {
        const storeIds = new Set<string>();

        try {
            // Check category index
            if (intent.category) {
                const categoryPointers = await upstash.getCategoryIndex(intent.category);
                categoryPointers.forEach(p => storeIds.add(p.storeId));
            }

            // Check tag indexes (if tags are extracted)
            if (intent.tags && Array.isArray(intent.tags)) {
                for (const tag of intent.tags) {
                    const tagPointers = await upstash.getTagIndex(tag);
                    tagPointers.forEach(p => storeIds.add(p.storeId));
                }
            }
        } catch (error) {
            console.warn('[SearchService] Index lookup failed:', error);
            return []; // Fall back to full scan
        }

        return Array.from(storeIds);
    }

    private static async fetchProductsInParallel(
        env: EnvBindings,
        stores: any[],
        kv: any,
        db: any
    ): Promise<Array<{ store: any; products: any[]; dataSource: string }>> {
        // Batch all KV operations first
        const kvPromises = stores.map(async (store) => {
            try {
                const catalogData = await kv.get(`store:${store.id}:catalog`);
                if (catalogData) {
                    const catalog = JSON.parse(catalogData);
                    return {
                        store,
                        products: catalog.products || [],
                        dataSource: 'kv'
                    };
                }
                return null; // KV miss, will handle in D1 batch
            } catch (error) {
                console.warn(`[SearchService] KV fetch failed for store ${store.id}:`, error);
                return null;
            }
        });

        const kvResults = await Promise.allSettled(kvPromises);
        
        // Identify stores that need D1 fallback
        const storesNeedingD1: any[] = [];
        const successfulResults: Array<{ store: any; products: any[]; dataSource: string }> = [];

        kvResults.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value) {
                successfulResults.push(result.value);
            } else if (result.status === 'fulfilled' && !result.value) {
                // KV miss, add to D1 batch
                storesNeedingD1.push(stores[index]);
            }
            // Rejected promises are logged but don't stop the search
        });

        // Batch D1 operations for KV misses
        if (storesNeedingD1.length > 0) {
            const d1Promises = storesNeedingD1.map(async (store) => {
                try {
                    const d1Products = await db.select({
                        id: products.id,
                        name: products.name,
                        descriptionShort: products.descriptionShort,
                        descriptionLong: products.descriptionLong,
                        category: products.category,
                        tags: products.tags,
                        brand: products.brand,
                        model: products.model,
                        amount: products.amount,
                        currency: products.currency,
                        inStock: products.inStock,
                        stockStatus: products.stockStatus,
                        quantityRange: products.quantityRange,
                        images: products.images,
                        variants: products.variants,
                        syncedAt: products.syncedAt,
                    }).from(products).where(eq(products.storeId, store.id));

                    const normalizedProducts = d1Products.map((p: any) => ({
                        id: p.id,
                        name: p.name,
                        description: p.descriptionShort || p.descriptionLong,
                        category: p.category,
                        pricing: {
                            currency: p.currency || 'NGN',
                            amount: p.amount || 0
                        },
                        inventory: {
                            in_stock: p.inStock || true,
                            quantity: p.quantityRange || 'unknown',
                            stock_status: p.stockStatus || 'available'
                        },
                        images: JSON.parse(p.images as string || '[]'),
                        tags: JSON.parse(p.tags as string || '[]'),
                        variants: JSON.parse(p.variants as string || '[]'),
                        synced_at: p.syncedAt,
                    }));

                    return {
                        store,
                        products: normalizedProducts,
                        dataSource: 'd1_fallback'
                    };
                } catch (error) {
                    console.warn(`[SearchService] D1 fetch failed for store ${store.id}:`, error);
                    return {
                        store,
                        products: [],
                        dataSource: 'd1_failed'
                    };
                }
            });

            const d1Results = await Promise.allSettled(d1Promises);
            d1Results.forEach((result) => {
                if (result.status === 'fulfilled') {
                    successfulResults.push(result.value);
                }
            });
        }

        return successfulResults;
    }

    private static calculateRankScore(product: any, store: any, intent: any): number {
        let score = 0.5;

        // Category match
        if (intent.category && product.category?.toLowerCase().includes(intent.category.toLowerCase())) {
            score += 0.2;
        }

        // Budget match
        if (intent.budget_max) {
            if (product.pricing.amount <= intent.budget_max) {
                score += 0.2;
            } else {
                score -= 0.3;
            }
        }

        // Location match
        if (intent.location?.city && store.city?.toLowerCase() === intent.location.city.toLowerCase()) {
            score += 0.1;
        }

        // Plan boost
        if (store.plan === "premium") score += 0.05;
        if (store.plan === "pro") score += 0.02;

        return Math.min(score, 1.0);
    }

    private static getMatchReasons(product: any, store: any, intent: any): string[] {
        const reasons: string[] = [];
        if (intent.budget_max && product.pricing.amount <= intent.budget_max) reasons.push("within_budget");
        if (intent.category && product.category?.toLowerCase().includes(intent.category.toLowerCase())) reasons.push("exact_category_match");
        if (intent.location?.city && store.city?.toLowerCase() === intent.location.city.toLowerCase()) reasons.push("nearby_store");
        if (store.plan === "premium" || store.plan === "pro") reasons.push("verified_partner");
        return reasons;
    }

    private static buildConfidenceMetadata(
        resultCount: number,
        totalStores: number,
        storesWithKV: number,
        storesWithD1Fallback: number,
        intent: any
    ) {
        const dataSource = storesWithKV > 0 ? 'kv_primary' : 
                         storesWithD1Fallback > 0 ? 'd1_fallback' : 'no_data';
        
        return {
            data_source: dataSource,
            freshness: storesWithKV > 0 ? "realtime" : "cached",
            last_global_sync_at: new Date().toISOString(),
            result_confidence: resultCount > 0 ? "medium" : "low",
            stores_queried: totalStores,
            stores_with_kv_data: storesWithKV,
            stores_with_d1_fallback: storesWithD1Fallback,
            intent_detected: Object.keys(intent).length > 0
        };
    }

    private static getExcludedReasons(resultCount: number, totalStores: number): string[] {
        const reasons = ["low_relevance"];
        if (resultCount === 0 && totalStores > 0) {
            reasons.push("out_of_budget", "no_matching_products");
        }
        return reasons;
    }

    private static buildErrorResponse(query: string, error: any) {
        return {
            type: "search_results",
            query_context: {
                original_query: query,
                parsed_intent: null
            },
            confidence: {
                data_source: "error",
                freshness: "unknown",
                last_global_sync_at: new Date().toISOString(),
                result_confidence: "error",
                error: error.message
            },
            results: [],
            result_limits: {
                max_results: 10,
                returned: 0,
                excluded_reasons: ["search_error"]
            },
            usage_guidelines: {
                allowed: [],
                disallowed: ["all"]
            }
        };
    }
}

